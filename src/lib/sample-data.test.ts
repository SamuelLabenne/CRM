import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { setupTestDb, createTestUser } from "@/test/setup-db";

const { db } = await setupTestDb();
const schema = await import("@/lib/db/schema");
const { loadSampleData } = await import("./sample-data");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const count = async (table: any) => {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table as typeof schema.contacts);
  return row.n;
};

describe("loadSampleData", () => {
  it("creates a realistic dataset and records ids", async () => {
    const owner = await createTestUser();
    await loadSampleData(owner.id);
    expect(await count(schema.contacts)).toBe(60);
    expect(await count(schema.events)).toBeGreaterThan(15);
    expect(await count(schema.eventAttendees)).toBeGreaterThan(100);
    expect(await count(schema.messages)).toBeGreaterThan(5);
    const [setting] = await db.select().from(schema.settings).where(eq(schema.settings.key, "sampleData"));
    const ids = (setting.value as { ids: Record<string, string[]> }).ids;
    expect(ids.contacts).toHaveLength(60);
    expect(ids.events.length).toBeGreaterThan(15);
    // No-shows and attended were recorded on the past masterclass.
    const statuses = await db.select({ s: schema.eventAttendees.status, n: sql<number>`count(*)::int` }).from(schema.eventAttendees).groupBy(schema.eventAttendees.status);
    expect(statuses.find((r) => r.s === "attended")?.n).toBeGreaterThan(20);
    expect(statuses.find((r) => r.s === "waitlisted")?.n).toBe(3);
  });
});
