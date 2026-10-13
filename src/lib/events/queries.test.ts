import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb, createTestUser } from "@/test/setup-db";

const { db } = await setupTestDb();
const { events, campaigns, pageViews, eventAttendees } = await import("@/lib/db/schema");
const { upsertContact } = await import("@/lib/contacts");
const { registerForEvent, markAttendance } = await import("./registration");
const q = await import("./queries");
const { DEFAULT_EVENT_NOTIFICATIONS } = await import("@/lib/types");

const host = await createTestUser();
const HOUR = 3600e3;

async function ev(over: Partial<typeof events.$inferInsert> & { title: string }) {
  const start = over.startsAt ?? new Date(Date.now() + 48 * HOUR);
  const [e] = await db
    .insert(events)
    .values({ status: "scheduled", endsAt: new Date(start.getTime() + HOUR), startsAt: start, notifications: DEFAULT_EVENT_NOTIFICATIONS, hostId: host.id, ...over })
    .returning();
  return e;
}
async function person(email: string) {
  return (await upsertContact({ email, firstName: email.split("@")[0] }, { source: "manual" })).contact;
}

const [camp] = await db.insert(campaigns).values({ name: "Spring" }).returning();
const soon = await ev({ title: "Soon", campaignId: camp.id, type: "webinar", capacity: 10 });
const later = await ev({ title: "Later workshop", startsAt: new Date(Date.now() + 96 * HOUR), type: "workshop" });
const draft = await ev({ title: "Draft thing", status: "draft" });
const past = await ev({ title: "Past one", startsAt: new Date(Date.now() - 5 * HOUR) });
const cancelled = await ev({ title: "Cancelled one", status: "cancelled" });
const meeting = await ev({ title: "1:1 call", kind: "meeting" });

describe("listEvents", () => {
  it("splits events into tabs and hides meetings", async () => {
    const upcoming = await q.listEvents({ tab: "upcoming" });
    expect(upcoming.rows.map((r) => r.event.title)).toEqual(["Soon", "Later workshop"]); // soonest first
    expect((await q.listEvents({ tab: "past" })).rows.map((r) => r.event.title)).toEqual(["Past one"]);
    expect((await q.listEvents({ tab: "drafts" })).rows.map((r) => r.event.id)).toEqual([draft.id]);
    const all = (await q.listEvents({ tab: "all" })).rows.map((r) => r.event.id);
    expect(all).toContain(cancelled.id);
    expect(all).not.toContain(meeting.id);
  });

  it("filters by search, campaign and type", async () => {
    expect((await q.listEvents({ tab: "all", q: "workshop" })).rows.map((r) => r.event.id)).toEqual([later.id]);
    expect((await q.listEvents({ tab: "all", campaignId: camp.id })).rows.map((r) => r.event.id)).toEqual([soon.id]);
    expect((await q.listEvents({ tab: "all", type: "webinar" })).rows.map((r) => r.event.id)).toEqual([soon.id]);
    expect((await q.listEvents({ tab: "all", q: "100%_" })).rows).toHaveLength(0); // wildcards are escaped
  });

  it("counts per tab respecting filters", async () => {
    expect(await q.countEventsByTab({})).toEqual({ upcoming: 2, past: 1, drafts: 1, all: 5 });
    expect(await q.countEventsByTab({ campaignId: camp.id })).toMatchObject({ upcoming: 1, past: 0 });
  });

  it("attaches attendee stats", async () => {
    const a = await person("s1@example.com");
    const b = await person("s2@example.com");
    await registerForEvent({ eventId: soon.id, contactId: a.id, source: "manual" });
    await registerForEvent({ eventId: soon.id, contactId: b.id, source: "manual" });
    const row = (await q.listEvents({ tab: "upcoming" })).rows.find((r) => r.event.id === soon.id)!;
    expect(row.stats.seatsTaken).toBe(2);
    expect(row.stats.attendanceRate).toBe(0);
  });
});

describe("needs attendance", () => {
  it("lists past events with unmarked registrations", async () => {
    const a = await person("n1@example.com");
    const b = await person("n2@example.com");
    const ra = await registerForEvent({ eventId: past.id, contactId: a.id, source: "manual", silent: true });
    await registerForEvent({ eventId: past.id, contactId: b.id, source: "manual", silent: true });
    let rows = await q.eventsNeedingAttendance();
    expect(rows.map((r) => [r.event.id, r.pending])).toEqual([[past.id, 2]]);
    await markAttendance(ra.attendee.id, "attended");
    rows = await q.eventsNeedingAttendance();
    expect(rows[0].pending).toBe(1);
    const [bRow] = await db.select().from(eventAttendees).where(eq(eventAttendees.contactId, b.id));
    await markAttendance(bRow.id, "no_show");
    expect(await q.eventsNeedingAttendance()).toHaveLength(0);
  });
});

describe("overview, series and scheduled emails", () => {
  it("computes page views and public conversion", async () => {
    const c = await person("pv1@example.com");
    await registerForEvent({ eventId: later.id, contactId: c.id, source: "public" });
    await db.insert(pageViews).values([
      { kind: "event", targetId: later.id, visitorHash: "a" },
      { kind: "event", targetId: later.id, visitorHash: "a" },
      { kind: "event", targetId: later.id, visitorHash: "b" },
      { kind: "event", targetId: later.id, visitorHash: "c" },
      { kind: "event", targetId: later.id, visitorHash: "d" },
    ]);
    const o = await q.getEventOverview(later.id);
    expect(o.pageViews).toBe(4);
    expect(o.publicRegistrations).toBe(1);
    expect(o.conversion).toBeCloseTo(0.25);
    expect((await q.getEventOverview(draft.id)).conversion).toBeNull();
  });

  it("builds a registration series from the first registration until now", async () => {
    const [first] = await db.select().from(eventAttendees).where(eq(eventAttendees.eventId, later.id));
    await db.update(eventAttendees).set({ registeredAt: new Date(Date.now() - 3 * 24 * HOUR) }).where(eq(eventAttendees.id, first.id));
    const c = await person("series2@example.com");
    await registerForEvent({ eventId: later.id, contactId: c.id, source: "manual" });
    const series = await q.registrationSeries(later, "UTC");
    expect(series.length).toBeGreaterThanOrEqual(4);
    expect(series[0].count).toBe(1);
    expect(series.at(-1)?.total).toBe(2);
    expect(await q.registrationSeries(draft, "UTC")).toEqual([]);
  });

  it("groups pending reminder jobs for the event", async () => {
    const emails = await q.upcomingEventEmails(later.id);
    const reminders = emails.filter((e) => e.kind === "reminder");
    expect(reminders.map((r) => r.reminderId).sort()).toEqual(["r1h", "r24h"]);
    expect(reminders.every((r) => r.recipients === 2)).toBe(true);
    expect(emails.some((e) => e.kind === "follow_up")).toBe(true);
    expect(emails.every((e) => e.kind !== "host")).toBe(true);
    expect(await q.upcomingEventEmails(draft.id)).toEqual([]);
  });
});

describe("attendee listing", () => {
  it("filters by status and search, with check-in rows excluding cancelled/waitlisted", async () => {
    const e = await ev({ title: "People", capacity: 2, waitlistEnabled: true });
    const people = await Promise.all(["Zed Zeta", "Amy Alpha", "Bob Beta"].map((n) => upsertContact({ email: `${n.split(" ")[0].toLowerCase()}@x.io`, firstName: n.split(" ")[0], lastName: n.split(" ")[1], company: "Acme" }, { source: "manual" })));
    const regs = [];
    for (const p of people) regs.push(await registerForEvent({ eventId: e.id, contactId: p.contact.id, source: "manual", silent: true }));
    expect(regs[2].waitlisted).toBe(true);
    expect((await q.listAttendees(e.id)).total).toBe(3);
    expect((await q.listAttendees(e.id, { status: "waitlisted" })).rows.map((r) => r.firstName)).toEqual(["Bob"]);
    expect((await q.listAttendees(e.id, { q: "amy" })).rows.map((r) => r.firstName)).toEqual(["Amy"]);
    expect((await q.listAttendees(e.id, { q: "zed zeta" })).rows).toHaveLength(1);
    expect((await q.listAttendees(e.id, { q: "acme" })).total).toBe(3);
    const rows = await q.listCheckInRows(e.id);
    expect(rows.map((r) => r.firstName)).toEqual(["Amy", "Zed"]); // alphabetical, no waitlisted
  });
});
