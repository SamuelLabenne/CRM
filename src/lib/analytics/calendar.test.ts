import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "@/test/setup-db";

const { db } = await setupTestDb();
const { NOW, seedWorld, d, mkEvent, mkContact, mkAttendee, mkUser } = await import("./test-utils");
const cal = await import("./calendar");
const feed = await import("./feed");
const { events, jobs, users } = await import("@/lib/db/schema");
const { registerForEvent } = await import("@/lib/events/registration");
const { setSetting } = await import("@/lib/settings");

const ALL = {
  start: new Date("2026-10-01T00:00:00Z"),
  end: new Date("2026-11-01T00:00:00Z"),
  events: true,
  meetings: true,
  campaigns: true,
  broadcasts: true,
  tasks: true,
  cancelled: false,
  types: [] as never[],
  campaignId: null,
  mineUserId: null,
};

type World = Awaited<ReturnType<typeof seedWorld>>;
let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

describe("getCalendarEvents", () => {
  it("returns events, meetings, campaigns, broadcasts and open tasks for the range", async () => {
    const rows = await cal.getCalendarEvents(ALL, NOW);
    const byKind = (k: string) => rows.filter((r) => r.extendedProps.kind === k);
    // Spring Webinar has 3 registrations → count in the title; draft shown, cancelled hidden by default.
    expect(titles(byKind("event"))).toEqual(["Spring Webinar (3)", "Autumn Workshop (1)", "Draft meetup"]);
    expect(byKind("meeting")).toHaveLength(4); // cancelled meeting hidden
    expect(titles(byKind("campaign"))).toEqual(["Spring Webinars"]);
    expect(titles(byKind("broadcast"))).toEqual(["October news", "Upcoming send"]);
    expect(titles(byKind("task")).sort()).toEqual(["Future", "Overdue (mine)", "Overdue (other)", "Overdue (unassigned)"]);
  });

  it("colors events by event color, then campaign color, and meetings sky", async () => {
    const rows = await cal.getCalendarEvents(ALL, NOW);
    const get = (id: string) => rows.find((r) => r.id === `event:${id}`)!;
    expect(get(w.e1.id).color).toBe("#10b981"); // explicit event color wins
    expect(get(w.e2.id).color).toBe("#6366f1"); // campaign color
    expect(get(w.e3.id).color).toBe("var(--primary)"); // fallback
    expect(get(w.m1.id).color).toBe(cal.MEETING_COLOR);
    expect(get(w.e3.id).className).toContain("relay-fc-draft");
    expect(get(w.e3.id).editable).toBe(true);
    expect(get(w.e0.id)).toBeUndefined(); // outside range
  });

  it("includes the contact name for meetings and attendance counts for events", async () => {
    const rows = await cal.getCalendarEvents(ALL, NOW);
    const m3 = rows.find((r) => r.id === `event:${w.m3.id}`)!;
    expect(m3.title).toBe("Intro call with Bob Test"); // already contains the name → not duplicated
    expect(m3.extendedProps.contact?.name).toBe("Bob Test");
    const e1 = rows.find((r) => r.id === `event:${w.e1.id}`)!;
    expect(e1.extendedProps.counts).toMatchObject({ registered: 3, attended: 1, noShow: 1, waitlisted: 0 });
    expect(e1.extendedProps.campaign?.name).toBe("Spring Webinars");
    expect(e1.extendedProps.host?.name).toBe("Sam");
    expect(e1.extendedProps.isPast).toBe(true);
  });

  it("renders campaigns as all-day spans with an exclusive end date", async () => {
    const rows = await cal.getCalendarEvents(ALL, NOW);
    const c = rows.find((r) => r.id === `campaign:${w.campA.id}`)!;
    expect(c).toMatchObject({ start: "2026-10-05", end: "2026-10-21", allDay: true });
    expect(c.extendedProps.campaignInfo).toMatchObject({ events: 3, registrations: 6 });
  });

  it("filters: only mine, kinds, types, campaign, cancelled", async () => {
    const mine = await cal.getCalendarEvents({ ...ALL, mineUserId: w.host2.id }, NOW);
    expect(titles(mine.filter((r) => r.extendedProps.kind === "event"))).toEqual(["Draft meetup"]);
    expect(mine.filter((r) => r.extendedProps.kind === "meeting")).toHaveLength(2); // hosted by Alex
    expect(mine.some((r) => r.extendedProps.kind === "campaign")).toBe(false); // owned by nobody
    expect(titles(mine.filter((r) => r.extendedProps.kind === "task"))).toEqual(["Overdue (other)"]);

    const onlyEvents = await cal.getCalendarEvents({ ...ALL, meetings: false, campaigns: false, broadcasts: false, tasks: false }, NOW);
    expect(onlyEvents.every((r) => r.extendedProps.kind === "event")).toBe(true);

    const webinars = await cal.getCalendarEvents({ ...ALL, types: ["webinar"], meetings: false, campaigns: false, broadcasts: false, tasks: false }, NOW);
    expect(titles(webinars)).toEqual(["Spring Webinar (3)"]);

    const inCampaign = await cal.getCalendarEvents({ ...ALL, campaignId: w.campA.id, tasks: false, broadcasts: false }, NOW);
    expect(inCampaign.filter((r) => r.extendedProps.kind === "event")).toHaveLength(2);

    const withCancelled = await cal.getCalendarEvents({ ...ALL, cancelled: true, campaigns: false, broadcasts: false, tasks: false }, NOW);
    const cancelled = withCancelled.filter((r) => r.className?.includes("relay-fc-cancelled"));
    expect(cancelled).toHaveLength(2); // cancelled class + cancelled meeting
  });

  it("respects the visible range", async () => {
    const rows = await cal.getCalendarEvents({ ...ALL, start: new Date("2026-10-14T00:00:00Z"), end: new Date("2026-10-16T00:00:00Z") }, NOW);
    expect(titles(rows.filter((r) => r.extendedProps.kind === "event" || r.extendedProps.kind === "meeting"))).toEqual([
      "Intro call with Cy Test (2)",
      "Autumn Workshop (1)",
    ]);
    // the campaign (5–20 Oct) spans the window, the broadcast is on the 16th (outside)
    expect(rows.some((r) => r.extendedProps.kind === "campaign")).toBe(true);
    expect(rows.some((r) => r.extendedProps.kind === "broadcast")).toBe(false);
  });
});

describe("contrastFor / wallTimeToDate", () => {
  it("picks readable text colors", () => {
    expect(cal.contrastFor("#ffffff")).toBe("#111827");
    expect(cal.contrastFor("#0f172a")).toBe("#ffffff");
    expect(cal.contrastFor("#10b981")).toBe("#111827");
    expect(cal.contrastFor("#6366f1")).toBe("#ffffff");
    expect(cal.contrastFor("#0284c7")).toBe("#ffffff");
    expect(cal.contrastFor("var(--x)")).toBe("#ffffff");
  });

  it("converts wall-clock times in the workspace timezone to instants", () => {
    expect(cal.wallTimeToDate("2026-10-14T09:00", "Australia/Perth")?.toISOString()).toBe("2026-10-14T01:00:00.000Z");
    expect(cal.wallTimeToDate("2026-10-14T09:00", "UTC")?.toISOString()).toBe("2026-10-14T09:00:00.000Z");
    expect(cal.wallTimeToDate("nonsense", "UTC")).toBeNull();
  });
});

describe("quick create & move", () => {
  it("creates a scheduled event with default notifications hosted by the creator", async () => {
    const start = new Date("2026-11-03T01:00:00Z");
    const ev = await cal.createQuickEvent({ title: "Quick one", type: "workshop", startsAt: start, endsAt: new Date(start.getTime() + 3600e3), hostId: w.owner.id, campaignId: w.campA.id });
    expect(ev).toMatchObject({ status: "scheduled", kind: "event", hostId: w.owner.id, campaignId: w.campA.id, type: "workshop" });
    expect(ev.notifications.reminders).toHaveLength(2);
    expect(ev.notifications.confirmation.enabled).toBe(true);
  });

  it("moves an event and re-plans reminders for its attendees", async () => {
    const start = new Date(Date.now() + 5 * 864e5);
    const ev = await mkEvent({ title: "Movable", startsAt: start, endsAt: new Date(start.getTime() + 3600e3), hostId: w.owner.id });
    const contact = await mkContact("Mover", d("2026-10-01"));
    await registerForEvent({ eventId: ev.id, contactId: contact.id, source: "manual", silent: true });
    const reminders = async () =>
      (await db.select().from(jobs)).filter((j) => j.status === "pending" && (j.payload as { kind?: string }).kind === "reminder");
    const before = await reminders();
    expect(before.length).toBeGreaterThan(0);

    const newStart = new Date(start.getTime() + 2 * 864e5);
    const res = await cal.moveCalendarEvent(ev.id, newStart, new Date(newStart.getTime() + 2 * 3600e3));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.attendees).toBe(1);

    const [row] = await db.select().from(events).where(eq(events.id, ev.id));
    expect(row.startsAt.toISOString()).toBe(newStart.toISOString());
    const after = await reminders();
    const runAts = after.map((j) => j.runAt.getTime());
    // reminders are now planned relative to the new start (24h and 1h before)
    expect(runAts).toContain(newStart.getTime() - 24 * 3600e3);
    expect(runAts).toContain(newStart.getTime() - 3600e3);
    expect(runAts).not.toContain(start.getTime() - 3600e3);
  });

  it("rejects invalid moves", async () => {
    const t = new Date(Date.now() + 864e5);
    expect(await cal.moveCalendarEvent(w.e1.id, t, new Date(t.getTime() - 1))).toMatchObject({ ok: false });
    expect(await cal.moveCalendarEvent(w.e4.id, t, new Date(t.getTime() + 3600e3))).toMatchObject({ ok: false }); // cancelled
    expect(await cal.moveCalendarEvent("00000000-0000-0000-0000-000000000000", t, new Date(t.getTime() + 3600e3))).toMatchObject({ ok: false });
  });
});

describe("ICS feed", () => {
  it("creates a calendar token once and can rotate it", async () => {
    const t1 = await feed.ensureCalendarToken(w.owner.id);
    expect(t1.length).toBeGreaterThan(20);
    expect(await feed.ensureCalendarToken(w.owner.id)).toBe(t1);
    const t2 = await feed.rotateCalendarToken(w.owner.id);
    expect(t2).not.toBe(t1);
    const [u] = await db.select().from(users).where(eq(users.id, w.owner.id));
    expect(u.calendarToken).toBe(t2);
  });

  it("includes the user's events in a −30…+180 day window and skips cancelled/draft", async () => {
    await setSetting("workspace", { name: "Acme", timezone: "UTC" });
    const member = await mkUser("Mia", "member", "mia@test.local");
    const mine = await mkEvent({ title: "Mia's workshop", hostId: member.id, startsAt: d("2026-10-20T01:00:00Z") });
    await mkEvent({ title: "Mia's draft", hostId: member.id, status: "draft", startsAt: d("2026-10-21T01:00:00Z") });
    await mkEvent({ title: "Mia's cancelled", hostId: member.id, status: "cancelled", startsAt: d("2026-10-22T01:00:00Z") });
    await mkEvent({ title: "Too far ahead", hostId: member.id, startsAt: new Date(NOW.getTime() + 200 * 864e5) });
    await mkEvent({ title: "Too old", hostId: member.id, startsAt: new Date(NOW.getTime() - 40 * 864e5) });
    const contact = await mkContact("Reg", d("2026-10-01"));
    await mkAttendee({ eventId: mine.id, contactId: contact.id, status: "registered", registeredAt: d("2026-10-02") });

    const ics = await feed.buildCalendarFeed(member, NOW);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("X-WR-CALNAME:Acme – Mia");
    expect(ics).toContain(`UID:${mine.id}@relay`);
    expect(ics).toContain("SUMMARY:Mia's workshop");
    expect(ics).toContain("Registered: 1");
    for (const hidden of ["Mia's draft", "Mia's cancelled", "Too far ahead", "Too old", "Spring Webinar"]) expect(ics).not.toContain(hidden);

    // admins see everyone's events
    const adminIcs = await feed.buildCalendarFeed(w.owner, NOW);
    expect(adminIcs).toContain("SUMMARY:Spring Webinar");
    expect(adminIcs).toContain("SUMMARY:Mia's workshop");
    expect(adminIcs).not.toContain("Draft meetup");
  });
});

