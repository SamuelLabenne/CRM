import { and, asc, eq, inArray, lte, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs, type Job } from "@/lib/db/schema";
import { jobHandlers } from "./handlers";
import { setSetting } from "@/lib/settings";

const BATCH = 25;
const STALE_LOCK_MS = 10 * 60 * 1000;

let running: Promise<ProcessResult> | null = null;

export type ProcessResult = { processed: number; failed: number; errors: string[] };

/**
 * Process due jobs. Safe to call concurrently (in-process calls are coalesced and
 * rows are claimed atomically, so separate instances never run the same job).
 */
export function processDueJobs(opts: { maxBatches?: number } = {}): Promise<ProcessResult> {
  if (running) return running;
  running = (async () => {
    const result: ProcessResult = { processed: 0, failed: 0, errors: [] };
    try {
      // Re-queue jobs stuck in "running" (crashed worker).
      await db
        .update(jobs)
        .set({ status: "pending", lockedAt: null })
        .where(and(eq(jobs.status, "running"), lt(jobs.lockedAt, new Date(Date.now() - STALE_LOCK_MS))));

      for (let batch = 0; batch < (opts.maxBatches ?? 8); batch++) {
        const claimed = await claimBatch();
        if (!claimed.length) break;
        for (const job of claimed) {
          await runJob(job, result);
        }
      }
      await setSetting("jobsHeartbeat", { at: new Date().toISOString() });
    } finally {
      running = null;
    }
    return result;
  })();
  return running;
}

async function claimBatch(): Promise<Job[]> {
  const now = new Date();
  const due = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.status, "pending"), lte(jobs.runAt, now)))
    .orderBy(asc(jobs.runAt))
    .limit(BATCH);
  if (!due.length) return [];
  // Atomic claim: only rows still pending are taken.
  return db
    .update(jobs)
    .set({ status: "running", lockedAt: now, attempts: sql`${jobs.attempts} + 1` })
    .where(and(eq(jobs.status, "pending"), inArray(jobs.id, due.map((d) => d.id))))
    .returning();
}

async function runJob(job: Job, result: ProcessResult) {
  const handler = jobHandlers[job.type];
  try {
    if (!handler) throw new Error(`No handler for job type "${job.type}"`);
    await handler(job.payload, job);
    await db.update(jobs).set({ status: "done", completedAt: new Date(), lockedAt: null }).where(eq(jobs.id, job.id));
    result.processed++;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const giveUp = job.attempts >= job.maxAttempts;
    await db
      .update(jobs)
      .set({
        status: giveUp ? "failed" : "pending",
        lastError: message.slice(0, 2000),
        lockedAt: null,
        // Exponential backoff: 1, 4, 9… minutes.
        runAt: giveUp ? job.runAt : new Date(Date.now() + job.attempts * job.attempts * 60_000),
      })
      .where(eq(jobs.id, job.id));
    result.failed++;
    result.errors.push(`${job.type}: ${message}`);
    console.error(`[jobs] ${job.type} (${job.id}) failed:`, err);
  }
}

/** Count of jobs waiting to run (for status displays). */
export async function pendingJobCount() {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(or(eq(jobs.status, "pending"), eq(jobs.status, "running")));
  return row?.n ?? 0;
}
