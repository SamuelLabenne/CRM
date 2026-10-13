import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";
import { jobs } from "@/lib/db/schema";

export type EnqueueOptions = {
  /** When to run (default: now). */
  runAt?: Date;
  /** Unique key – if a job with this key already exists, nothing is enqueued. */
  dedupeKey?: string;
  maxAttempts?: number;
};

/**
 * Enqueue a background job. Job types are dispatched by src/lib/jobs/handlers.ts.
 * Jobs are processed every minute by /api/cron (and on a timer in local dev).
 */
export async function enqueueJob(
  type: string,
  payload: Record<string, unknown>,
  opts: EnqueueOptions = {},
  tx: Tx = db,
) {
  const rows = await tx
    .insert(jobs)
    .values({
      type,
      payload,
      runAt: opts.runAt ?? new Date(),
      dedupeKey: opts.dedupeKey ?? null,
      maxAttempts: opts.maxAttempts ?? 3,
    })
    .onConflictDoNothing({ target: jobs.dedupeKey })
    .returning({ id: jobs.id });
  return rows[0]?.id ?? null;
}

/** Cancel pending jobs whose dedupe key starts with `prefix` (e.g. "evt-notif:<attendeeId>:"). */
export async function cancelJobsByPrefix(prefix: string, tx: Tx = db) {
  await tx
    .update(jobs)
    .set({ status: "cancelled", dedupeKey: sql`${jobs.dedupeKey} || ':cancelled:' || ${jobs.id}` })
    .where(and(eq(jobs.status, "pending"), like(jobs.dedupeKey, `${prefix.replace(/[%_]/g, "\\$&")}%`)));
}

/** Cancel specific pending jobs by id. */
export async function cancelJobs(ids: string[], tx: Tx = db) {
  if (!ids.length) return;
  await tx.update(jobs).set({ status: "cancelled" }).where(and(eq(jobs.status, "pending"), inArray(jobs.id, ids)));
}
