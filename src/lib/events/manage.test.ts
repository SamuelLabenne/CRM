import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb, createTestUser } from "@/test/setup-db";

const { db } = await setupTestDb();
const { events, eventAttendees, contacts, jobs } = await import("@/lib/db/schema");
const { upsertContact } = await import("@/lib/contacts");
const { registerForEvent } = await import("./registration");
const m = await import("./manage");
const q = await import("./queries");
const { DEFAULT_EVENT_NOTIFICATIONS } = await import("@/lib/types");

const user = await createTestUser();

function form(over: Record<string, unknown> = {}) {
  return {
    title: "Product launch",
    type: "webinar",
    description: "Join us",
    timezone: "Australia/Perth",
    startDate: "2030-03-01",
    startTime: "10:00",
    endDate: "2030-03-01",
    endTime: "11:30",
    locationType: "online",
    location: "",
    meetingUrl: "https://meet.example.com/abc",
    capacity: 50,
    waitlistEnabled: true,
    campaignId: "",
    hostId: user.id,
    color: "#6366f1",
    status: "scheduled",
    isPublic: true,
    slug: "",
    registrationOpen: true,
    coverImageUrl: "",
    registrationQuestions: [{ id: "q1", label: "Company", type: "text", required: false, mapTo: "company" }],
    notifications: DEFAULT_EVENT_NOTIFICATIONS,
    ...over,
  };
}

async function create(over: Record<string, unknown> = {}) {
  const res = await m.saveEvent({ section: "all", values: form(over), actorId: user.id });
  if (!res.ok) throw new Error(res.error);
  return res.event;
}

describe("saveEvent (create)", () => {
  it("converts wall-clock times in the event timezone and generates a unique slug", async () => {
    const a = await create();
    expect(a.startsAt.toISOString()).toBe("2030-03-01T02:00:00.000Z"); // 10:00 Perth (UTC+8)
    expect(a.endsAt.toISOString()).toBe("2030-03-01T03:30:00.000Z");
    expect(a.slug).toBe("product-launch");
    expect(a.status).toBe("scheduled");
    expect(a.kind).toBe("event");
    const b = await create();
    expect(b.slug).toBe("product-launch-2");
  });

  it("validates input with helpful messages", async () => {
    const noTitle = await m.saveEvent({ section: "all", values: form({ title: " " }), actorId: user.id });
    expect(noTitle).toMatchObject({ ok: false, fieldErrors: { title: [expect.any(String)] } });
    const backwards = await m.saveEvent({ section: "all", values: form({ endTime: "09:00" }), actorId: user.id });
    expect(backwards).toMatchObject({ ok: false, error: "The end must be after the start" });
    const badSlug = await m.saveEvent({ section: "all", values: form({ slug: "Bad Slug!" }), actorId: user.id });
    expect(badSlug.ok).toBe(false);
    const noOptions = await m.saveEvent({
      section: "all",
      values: form({ registrationQuestions: [{ id: "q", label: "Pick", type: "select", required: true, options: [] }] }),
      actorId: user.id,
    });
    expect(noOptions).toMatchObject({ ok: false, error: expect.stringContaining("Pick") });
    const badTz = await m.saveEvent({ section: "all", values: form({ timezone: "Mars/Phobos" }), actorId: user.id });
    expect(badTz.ok).toBe(false);
  });

  it("rejects a slug that is already taken", async () => {
    await create({ slug: "taken-slug" });
    const dup = await m.saveEvent({ section: "all", values: form({ slug: "taken-slug" }), actorId: user.id });
    expect(dup).toMatchObject({ ok: false, fieldErrors: { slug: [expect.any(String)] } });
  });
});

describe("saveEvent (update)", () => {
  it("re-plans reminders when the time changes", async () => {
    const e = await create({ title: "Replan me", startDate: "2030-06-01", endDate: "2030-06-01" });
    const { contact } = await upsertContact({ email: "replan@example.com" }, { source: "manual" });
    const reg = await registerForEvent({ eventId: e.id, contactId: contact.id, source: "manual" });
    const before = (await db.select().from(jobs)).filter((j) => (j.payload as { startsAt?: number }).startsAt === e.startsAt.getTime() && j.status === "pending");
    expect(before.length).toBeGreaterThan(0);

    const res = await m.saveEvent({
      id: e.id,
      section: "details",
      values: form({ title: "Replan me", startDate: "2030-06-02", endDate: "2030-06-02" }),
      actorId: user.id,
    });
    if (!res.ok) throw new Error(res.error);
    const jobsNow = await db.select().from(jobs);
    const pendingOld = jobsNow.filter((j) => j.status === "pending" && (j.payload as { startsAt?: number }).startsAt === e.startsAt.getTime());
    const pendingNew = jobsNow.filter(
      (j) => j.status === "pending" && (j.payload as { startsAt?: number; attendeeId?: string }).startsAt === res.event.startsAt.getTime() && (j.payload as { attendeeId?: string }).attendeeId === reg.attendee.id,
    );
    expect(pendingOld).toHaveLength(0);
    expect(pendingNew.length).toBeGreaterThan(0);
  });

  it("only touches the fields of the saved section", async () => {
    const e = await create({ title: "Sections" });
    const res = await m.saveEvent({
      id: e.id,
      section: "registration",
      values: { isPublic: false, slug: e.slug, registrationOpen: false, coverImageUrl: "https://img.example.com/a.png", registrationQuestions: [] },
      actorId: user.id,
    });
    if (!res.ok) throw new Error(res.error);
    expect(res.event.title).toBe("Sections");
    expect(res.event.isPublic).toBe(false);
    expect(res.event.registrationOpen).toBe(false);
    expect(res.event.registrationQuestions).toEqual([]);
    expect(res.event.coverImageUrl).toBe("https://img.example.com/a.png");
    expect(res.event.slug).toBe(e.slug); // kept even when the page is switched off
    expect(res.event.startsAt.getTime()).toBe(e.startsAt.getTime());
  });

  it("saves notifications and keeps a cancelled event cancelled", async () => {
    const e = await create({ title: "Notif" });
    const next = { ...DEFAULT_EVENT_NOTIFICATIONS, reminders: [{ id: "r2d", minutesBefore: 2880, templateId: null }], notifyHost: false };
    const res = await m.saveEvent({ id: e.id, section: "notifications", values: { notifications: next }, actorId: user.id });
    if (!res.ok) throw new Error(res.error);
    expect(res.event.notifications.reminders).toHaveLength(1);
    expect(res.event.notifications.notifyHost).toBe(false);
    await m.setEventStatus(e.id, "cancelled");
    const details = await m.saveEvent({ id: e.id, section: "details", values: form({ title: "Notif renamed", status: "scheduled" }), actorId: user.id });
    if (!details.ok) throw new Error(details.error);
    expect(details.event.status).toBe("cancelled");
  });
});

describe("status, duplicate, delete", () => {
  it("cancelling emails attendees; reopening re-plans", async () => {
    const e = await create({ title: "To cancel", startDate: "2030-07-01", endDate: "2030-07-01" });
    const { contact } = await upsertContact({ email: "cx@example.com" }, { source: "manual" });
    const reg = await registerForEvent({ eventId: e.id, contactId: contact.id, source: "manual" });
    await m.setEventStatus(e.id, "cancelled");
    const all = await db.select().from(jobs);
    expect(all.some((j) => (j.payload as { kind?: string; attendeeId?: string }).kind === "cancellation" && (j.payload as { attendeeId?: string }).attendeeId === reg.attendee.id)).toBe(true);
    expect(all.filter((j) => j.status === "pending" && (j.payload as { kind?: string; attendeeId?: string }).kind === "reminder" && (j.payload as { attendeeId?: string }).attendeeId === reg.attendee.id)).toHaveLength(0);
    await m.setEventStatus(e.id, "scheduled");
    const again = await db.select().from(jobs);
    expect(again.filter((j) => j.status === "pending" && (j.payload as { kind?: string; attendeeId?: string }).kind === "reminder" && (j.payload as { attendeeId?: string }).attendeeId === reg.attendee.id).length).toBeGreaterThan(0);
  });

  it("duplicates as a draft with a new slug and no attendees", async () => {
    const e = await create({ title: "Original" });
    const { contact } = await upsertContact({ email: "dup@example.com" }, { source: "manual" });
    await registerForEvent({ eventId: e.id, contactId: contact.id, source: "manual" });
    const copy = await m.duplicateEvent(e.id, user.id);
    expect(copy?.title).toBe("Copy of Original");
    expect(copy?.status).toBe("draft");
    expect(copy?.slug).not.toBe(e.slug);
    expect(await db.select().from(eventAttendees).where(eq(eventAttendees.eventId, copy!.id))).toHaveLength(0);
  });

  it("deletes an event with its attendees", async () => {
    const e = await create({ title: "Delete me" });
    const { contact } = await upsertContact({ email: "del@example.com" }, { source: "manual" });
    await registerForEvent({ eventId: e.id, contactId: contact.id, source: "manual" });
    expect(await m.deleteEvent(e.id)).toBe(true);
    expect(await db.select().from(events).where(eq(events.id, e.id))).toHaveLength(0);
    expect(await db.select().from(eventAttendees).where(eq(eventAttendees.eventId, e.id))).toHaveLength(0);
    expect(await m.deleteEvent(e.id)).toBe(false);
  });
});

describe("attendee operations", () => {
  it("adds a brand-new contact, exceeding capacity, and marks attended", async () => {
    const e = await create({ title: "Full house", capacity: 1, waitlistEnabled: false });
    const a = await m.addAttendee({ eventId: e.id, newContact: { name: "Grace Hopper", email: "grace@example.com" }, actorId: user.id });
    const b = await m.addAttendee({ eventId: e.id, newContact: { name: "Alan Turing", email: "alan@example.com" }, markAttended: true, actorId: user.id });
    expect(a.ok && b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.attendee.status).toBe("attended");
    expect((await q.eventStatsMap([e.id])).get(e.id)?.seatsTaken).toBe(2);
    const [c] = await db.select().from(contacts).where(eq(contacts.email, "grace@example.com"));
    expect(c.firstName).toBe("Grace");
    expect(c.lastName).toBe("Hopper");
    expect(await m.addAttendee({ eventId: e.id, newContact: { name: "", email: "" }, actorId: user.id })).toMatchObject({ ok: false });
    expect(await m.addAttendee({ eventId: e.id, newContact: { name: "X", email: "nope" }, actorId: user.id })).toMatchObject({ ok: false });
  });

  it("walk-ins are registered silently and checked in; repeats are idempotent", async () => {
    const e = await create({ title: "Walk-in" });
    const first = await m.walkIn({ eventId: e.id, name: "Walk In", email: "walk@example.com", actorId: user.id });
    const again = await m.walkIn({ eventId: e.id, name: "Walk In", email: "walk@example.com", actorId: user.id });
    expect(first).toMatchObject({ ok: true, created: true });
    expect(again).toMatchObject({ ok: true, created: false });
    if (!first.ok) return;
    expect(first.attendee.status).toBe("attended");
    expect(first.attendee.checkedInAt).toBeTruthy();
    const confirmations = (await db.select().from(jobs)).filter((j) => (j.payload as { kind?: string; attendeeId?: string }).kind === "confirmation" && (j.payload as { attendeeId?: string }).attendeeId === first.attendee.id);
    expect(confirmations).toHaveLength(0);
    // Walk-in without an email is fine too.
    expect(await m.walkIn({ eventId: e.id, name: "No Email", actorId: user.id })).toMatchObject({ ok: true });
  });

  it("removing an attendee promotes the waitlist", async () => {
    const e = await create({ title: "Waitlist promo", capacity: 1, waitlistEnabled: true });
    const { contact: c1 } = await upsertContact({ email: "w1@example.com" }, { source: "manual" });
    const { contact: c2 } = await upsertContact({ email: "w2@example.com" }, { source: "manual" });
    const r1 = await registerForEvent({ eventId: e.id, contactId: c1.id, source: "manual" });
    const r2 = await registerForEvent({ eventId: e.id, contactId: c2.id, source: "manual" });
    expect(r2.waitlisted).toBe(true);
    expect(await m.removeAttendee(r1.attendee.id, user.id)).toBe(true);
    const [row] = await db.select().from(eventAttendees).where(eq(eventAttendees.id, r2.attendee.id));
    expect(row.status).toBe("registered");
    expect(await m.removeAttendee(r1.attendee.id, user.id)).toBe(false);
  });

  it("bulk-marks attendance (skipping cancelled/waitlisted) and marks the remaining as no-show", async () => {
    const e = await create({ title: "Bulk", capacity: 2, waitlistEnabled: true });
    const people = await Promise.all(["b1", "b2", "b3"].map((n) => upsertContact({ email: `${n}@example.com` }, { source: "manual" })));
    const regs = [];
    for (const p of people) regs.push(await registerForEvent({ eventId: e.id, contactId: p.contact.id, source: "manual" }));
    expect(regs[2].waitlisted).toBe(true);
    expect(await m.bulkMarkAttendance(regs.map((r) => r.attendee.id), "attended", user.id)).toBe(2);
    expect(await m.markRemainingNoShow(e.id, user.id)).toBe(0);
    await m.bulkMarkAttendance([regs[1].attendee.id], "registered", user.id);
    expect(await m.markRemainingNoShow(e.id, user.id)).toBe(1);
    const stats = (await q.eventStatsMap([e.id])).get(e.id)!;
    expect(stats).toMatchObject({ attended: 1, noShow: 1, waitlisted: 1 });
  });
});

describe("attendees CSV", () => {
  it("includes answer columns and neutralises spreadsheet formulas", async () => {
    const e = await create({ title: "CSV", registrationQuestions: [{ id: "q1", label: "Company", type: "text", required: false }] });
    const { contact } = await upsertContact({ email: "csv@example.com", firstName: "=HYPERLINK(1)" }, { source: "manual" });
    await registerForEvent({ eventId: e.id, contactId: contact.id, source: "public", answers: { q1: "ACME, Inc." } });
    const out = await m.attendeesCsv(e.id, "Australia/Perth");
    expect(out).not.toBeNull();
    const lines = out!.csv.split("\r\n");
    expect(lines[0]).toContain("First name,Last name,Email");
    expect(lines[0]).toContain("Company");
    expect(lines[1]).toContain("'=HYPERLINK(1)");
    expect(lines[1]).toContain('"ACME, Inc."');
    expect(lines[1]).toContain("registered");
    expect(await m.attendeesCsv("00000000-0000-4000-8000-000000000000", "UTC")).toBeNull();
  });
});
