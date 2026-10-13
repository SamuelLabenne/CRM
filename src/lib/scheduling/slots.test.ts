import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb, createTestUser } from "@/test/setup-db";

const { db } = await setupTestDb();
const { bookingPages, events, users } = await import("@/lib/db/schema");
const { DEFAULT_PAGE_NOTIFICATIONS } = await import("./defaults");
const { getAvailableSlots, getFreeHostsAt, loadHostLoads, loadSlotHosts } = await import("./slots");

// Monday 2026-10-12 00:00 UTC is "now"; the workspace timezone defaults to Australia/Perth (UTC+8, no DST).
const NOW = new Date("2026-10-12T00:00:00Z");

async function makeHost(patch: Partial<typeof users.$inferInsert> = {}) {
  const u = await createTestUser();
  if (Object.keys(patch).length) await db.update(users).set(patch).where(eq(users.id, u.id));
  return u;
}

async function makePage(hostIds: string[], patch: Partial<typeof bookingPages.$inferInsert> = {}) {
  const [p] = await db
    .insert(bookingPages)
    .values({
      slug: `p-${Math.random().toString(36).slice(2, 8)}`,
      title: "Intro call",
      hostIds,
      notifications: DEFAULT_PAGE_NOTIFICATIONS,
      minNoticeMinutes: 0,
      maxDaysAhead: 3,
      ...patch,
    })
    .returning();
  return p;
}

async function makeMeeting(hostId: string, pageId: string | null, start: string, status: "scheduled" | "cancelled" = "scheduled", kind: "meeting" | "event" = "meeting") {
  const startsAt = new Date(start);
  const [e] = await db
    .insert(events)
    .values({
      kind,
      title: "Booked",
      hostId,
      bookingPageId: pageId,
      status,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      notifications: DEFAULT_PAGE_NOTIFICATIONS,
    })
    .returning();
  return e;
}

describe("slot loader", () => {
  it("falls back to the workspace timezone and default Mon–Fri hours", async () => {
    const host = await makeHost();
    const page = await makePage([host.id], { maxDaysAhead: 0 });
    const hosts = await loadSlotHosts([host.id]);
    expect(hosts[0].timezone).toBe("Australia/Perth");
    const slots = await getAvailableSlots(page, { now: NOW });
    // now = Mon 08:00 Perth → 09:00 Perth is 01:00Z
    expect(slots[0].start).toBe("2026-10-12T01:00:00.000Z");
    expect(slots).toHaveLength(16);
  });

  it("uses the host's own timezone, weekly hours and date overrides", async () => {
    const host = await makeHost({
      timezone: "Europe/Brussels",
      availability: { "0": [], "1": [{ start: "10:00", end: "11:00" }], "2": [], "3": [], "4": [], "5": [], "6": [] },
      dateOverrides: [{ date: "2026-10-12", slots: [{ start: "14:00", end: "15:00" }] }],
    });
    const page = await makePage([host.id], { maxDaysAhead: 8 });
    const slots = await getAvailableSlots(page, { now: NOW });
    expect(slots.map((s) => s.start)).toEqual([
      "2026-10-12T12:00:00.000Z", // override 14:00 CEST (+2)
      "2026-10-12T12:30:00.000Z",
      "2026-10-19T08:00:00.000Z", // next Monday 10:00 CEST
      "2026-10-19T08:30:00.000Z",
    ]);
  });

  it("blocks time for scheduled meetings and events but not for cancelled ones", async () => {
    const host = await makeHost({ timezone: "UTC" });
    const page = await makePage([host.id], { maxDaysAhead: 0 });
    await makeMeeting(host.id, page.id, "2026-10-12T09:00:00Z");
    await makeMeeting(host.id, page.id, "2026-10-12T10:00:00Z", "cancelled");
    await makeMeeting(host.id, null, "2026-10-12T11:00:00Z", "scheduled", "event");
    const starts = (await getAvailableSlots(page, { now: NOW })).map((s) => s.start.slice(11, 16));
    expect(starts).not.toContain("09:00");
    expect(starts).toContain("10:00"); // cancelled meeting does not block
    expect(starts).not.toContain("11:00"); // a non-meeting event blocks too
    expect(starts).toContain("09:30");
  });

  it("can ignore one event (rescheduling)", async () => {
    const host = await makeHost({ timezone: "UTC" });
    const page = await makePage([host.id], { maxDaysAhead: 0 });
    const m = await makeMeeting(host.id, page.id, "2026-10-12T09:00:00Z");
    expect((await getAvailableSlots(page, { now: NOW })).map((s) => s.start.slice(11, 16))).not.toContain("09:00");
    expect((await getAvailableSlots(page, { now: NOW, excludeEventId: m.id })).map((s) => s.start.slice(11, 16))).toContain("09:00");
  });

  it("applies buffers against existing meetings and the daily limit", async () => {
    const host = await makeHost({ timezone: "UTC" });
    const page = await makePage([host.id], { maxDaysAhead: 1, bufferBeforeMinutes: 30, bufferAfterMinutes: 30, dailyLimit: 2 });
    await makeMeeting(host.id, page.id, "2026-10-12T09:00:00Z");
    const day1 = (await getAvailableSlots(page, { now: NOW })).filter((s) => s.start.startsWith("2026-10-12")).map((s) => s.start.slice(11, 16));
    expect(day1.slice(0, 2)).toEqual(["10:00", "10:30"]); // the meeting ends 09:30; a 30 min buffer keeps 09:30 free
    await makeMeeting(host.id, page.id, "2026-10-12T14:00:00Z");
    const after = await getAvailableSlots(page, { now: NOW });
    expect(after.some((s) => s.start.startsWith("2026-10-12"))).toBe(false); // limit of 2 reached
    expect(after.some((s) => s.start.startsWith("2026-10-13"))).toBe(true);
  });

  it("ignores deactivated hosts and unions several hosts", async () => {
    const a = await makeHost({ timezone: "UTC", availability: { "0": [], "1": [{ start: "09:00", end: "10:00" }], "2": [], "3": [], "4": [], "5": [], "6": [] } });
    const b = await makeHost({ timezone: "UTC", availability: { "0": [], "1": [{ start: "09:30", end: "11:00" }], "2": [], "3": [], "4": [], "5": [], "6": [] } });
    const gone = await makeHost({ timezone: "UTC", deactivatedAt: new Date() });
    const page = await makePage([a.id, b.id, gone.id], { maxDaysAhead: 0 });
    const slots = await getAvailableSlots(page, { now: NOW });
    expect(slots.map((s) => `${s.start.slice(11, 16)}:${s.hostIds.length}`)).toEqual(["09:00:1", "09:30:2", "10:00:1", "10:30:1"]);
    const free = await getFreeHostsAt(page, new Date("2026-10-12T09:30:00Z"), { now: NOW });
    expect(free.hostIds.sort()).toEqual([a.id, b.id].sort());
  });

  it("loads round-robin stats: last assignment from the page, upcoming meetings overall", async () => {
    const a = await makeHost({ timezone: "UTC" });
    const b = await makeHost({ timezone: "UTC" });
    const page = await makePage([a.id, b.id]);
    const other = await makePage([a.id]);
    await makeMeeting(a.id, page.id, "2030-01-01T09:00:00Z");
    await makeMeeting(a.id, other.id, "2030-01-02T09:00:00Z");
    await makeMeeting(a.id, page.id, "2030-01-03T09:00:00Z", "cancelled");
    const loads = await loadHostLoads(page.id, [a.id, b.id], NOW);
    expect(loads[a.id].lastAssignedAt).toBeInstanceOf(Date);
    expect(loads[a.id].upcoming).toBe(2); // cancelled ones do not count
    expect(loads[b.id]).toEqual({ lastAssignedAt: null, upcoming: 0 });
  });
});
