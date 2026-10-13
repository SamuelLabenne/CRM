import { after } from "next/server";
import { processDueJobs } from "./runner";

/**
 * Process due jobs right after the current response is sent. Call this from
 * server actions / route handlers after enqueueing work that should happen
 * immediately (e.g. confirmation emails). Background cron is the safety net.
 */
export function kickJobs() {
  try {
    after(async () => {
      await processDueJobs({ maxBatches: 2 }).catch((err) => console.error("[jobs] kick failed", err));
    });
  } catch {
    // Outside a request scope (scripts/tests): run inline, best effort.
    void processDueJobs({ maxBatches: 2 }).catch(() => {});
  }
}
