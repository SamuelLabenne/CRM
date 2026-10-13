import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings";

export type FailedJobRow = { id: string; type: string; error: string | null; attempts: number; at: Date };

export type SystemStatus = {
  /** Last time the job runner finished a pass (ISO string) or null. */
  heartbeatAt: string | null;
  pending: number;
  running: number;
  /** Pending jobs that should have run more than 5 minutes ago. */
  overdue: number;
  failed: number;
  failedJobs: FailedJobRow[];
};

const OVERDUE_MS = 5 * 60 * 1000;

export async function getSystemStatus(): Promise<SystemStatus> {
  const [hb, counts, overdueRow, failedJobs] = await Promise.all([
    getSetting("jobsHeartbeat"),
    db.select({ status: jobs.status, n: sql<number>`count(*)::int` }).from(jobs).groupBy(jobs.status),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(jobs)
      .where(and(eq(jobs.status, "pending"), lt(jobs.runAt, new Date(Date.now() - OVERDUE_MS)))),
    db
      .select({ id: jobs.id, type: jobs.type, error: jobs.lastError, attempts: jobs.attempts, at: jobs.createdAt })
      .from(jobs)
      .where(eq(jobs.status, "failed"))
      .orderBy(desc(jobs.createdAt))
      .limit(5),
  ]);
  const n = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
  return {
    heartbeatAt: hb.at,
    pending: n("pending"),
    running: n("running"),
    overdue: overdueRow[0]?.n ?? 0,
    failed: n("failed"),
    failedJobs,
  };
}

/** Put every failed job back in the queue with a fresh attempt budget. Returns how many. */
export async function retryFailedJobs(): Promise<number> {
  const rows = await db
    .update(jobs)
    .set({ status: "pending", attempts: 0, lastError: null, runAt: new Date(), lockedAt: null })
    .where(eq(jobs.status, "failed"))
    .returning({ id: jobs.id });
  return rows.length;
}

export type Heartbeat = "healthy" | "stale" | "never";

export function heartbeatHealth(at: string | null, now = Date.now()): Heartbeat {
  if (!at) return "never";
  return now - new Date(at).getTime() <= OVERDUE_MS ? "healthy" : "stale";
}
