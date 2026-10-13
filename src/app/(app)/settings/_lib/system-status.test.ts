import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "@/test/setup-db";

const { db } = await setupTestDb();
const { jobs } = await import("@/lib/db/schema");
const { setSetting } = await import("@/lib/settings");
const { getSystemStatus, retryFailedJobs, heartbeatHealth } = await import("./system-status");

describe("system status", () => {
  it("counts jobs by state and lists failures", async () => {
    await db.insert(jobs).values([
      { type: "a", status: "pending", runAt: new Date(Date.now() + 60_000) },
      { type: "b", status: "pending", runAt: new Date(Date.now() - 3600_000) },
      { type: "c", status: "failed", lastError: "boom", attempts: 3 },
      { type: "d", status: "done" },
    ]);
    await setSetting("jobsHeartbeat", { at: new Date().toISOString() });
    const s = await getSystemStatus();
    expect(s).toMatchObject({ pending: 2, overdue: 1, failed: 1, running: 0 });
    expect(s.failedJobs[0]).toMatchObject({ type: "c", error: "boom" });
    expect(heartbeatHealth(s.heartbeatAt)).toBe("healthy");
  });

  it("retries failed jobs", async () => {
    expect(await retryFailedJobs()).toBe(1);
    const [row] = await db.select().from(jobs).where(eq(jobs.type, "c"));
    expect(row).toMatchObject({ status: "pending", attempts: 0, lastError: null });
    expect((await getSystemStatus()).failed).toBe(0);
  });

  it("classifies the heartbeat", () => {
    const now = Date.now();
    expect(heartbeatHealth(null, now)).toBe("never");
    expect(heartbeatHealth(new Date(now - 60_000).toISOString(), now)).toBe("healthy");
    expect(heartbeatHealth(new Date(now - 3600_000).toISOString(), now)).toBe("stale");
  });
});
