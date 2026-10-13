import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupTestDb, createTestUser } from "@/test/setup-db";

const { db } = await setupTestDb();
const { bookingPages, contacts, eventAttendees, events, jobs, leadCaptures, messages, users, activities } = await import("@/lib/db/schema");
const { DEFAULT_PAGE_NOTIFICATIONS } = await import("./defaults");
const { createBooking, getRescheduleContext, rescheduleMeeting, startBooking, submitQualification } = await import("./booking");
const { getAvailableSlots } = await import("./slots");
const { cancelRegistration } = await import("@/lib/events/registration");
const { processDueJobs } = await import("@/lib/jobs/runner");

import type { FormQuestion, RuleGroup } from "@/lib/types";

const questions: FormQuestion[] = [
  { id: "company", label: "Company", type: "text", required: true, mapTo: "company" },
  { id: "budget", label: "Budget", type: "select", required: true, options: ["< 1k", "1k–5k", "5k+"] },
];
const rules: RuleGroup[] = [{ id: "g1", combinator: "and", conditions: [{ questionId: "budget", operator: "is", value: ["< 1k"] }] }];

async function makeHost() {
  const u = await createTestUser();
  await db.update(users).set({ timezone: "UTC" }).where(eq(users.id, u.id));
  return u;
}

async function makePage(hostIds: string[], patch: Partial<typeof bookingPages.$inferInsert> = {}) {
  const [p] = await db
    .insert(bookingPages)
    .values({
      slug: `p-${Math.random().toString(36).slice(2, 8)}`,
      title: "Strategy call",
      hostIds,
      notifications: DEFAULT_PAGE_NOTIFICATIONS,
      minNoticeMinutes: 0,
      maxDaysAhead: 21,
      questions,
      disqualifyRules: rules,
      disqualifyMessage: "Not a fit right now.",
      ...patch,
    })
    .returning();
  return p;
}

let n = 0;
async function qualifiedCapture(page: typeof bookingPages.$inferSelect, answers = { company: "Acme", budget: "5k+" }) {
  n++;
  const start = await startBooking(page, { name: `Test Lead${n} Smith`, email: `lead${n}@example.com`, phone: "0400 000 000" });
  const res = await submitQualification(page, start.captureId, answers);
  expect(res).toMatchObject({ ok: true, qualified: true });
  return start;
}

const firstSlots = async (page: typeof bookingPages.$inferSelect, count = 3) => (await getAvailableSlots(page, { now: new Date() })).slice(0, count);

describe("qualification", () => {
  it("captures the lead and qualifies pages without questions immediately", async () => {
    const host = await makeHost();
    const page = await makePage([host.id], { questions: [], disqualifyRules: [] });
    const res = await startBooking(page, { name: "Ada Lovelace", email: "Ada@Example.com" });
    expect(res.next).toBe("calendar");
    const [c] = await db.select().from(contacts).where(eq(contacts.id, res.contact.id));
    expect(c).toMatchObject({ email: "ada@example.com", firstName: "Ada", lastName: "Lovelace", leadStatus: "qualified", source: "booking" });
    const [cap] = await db.select().from(leadCaptures).where(eq(leadCaptures.id, res.captureId));
    expect(cap.status).toBe("qualified");
  });

  it("validates answers, then qualifies or screens out on the server", async () => {
    const host = await makeHost();
    const page = await makePage([host.id]);
    const start = await startBooking(page, { name: "Grace Hopper", email: "grace@example.com" });
    expect(start.next).toBe("questions");
    let [c] = await db.select().from(contacts).where(eq(contacts.id, start.contact.id));
    expect(c.leadStatus).toBe("potential");

    const bad = await submitQualification(page, start.captureId, { company: "", budget: "nope" });
    expect(bad).toMatchObject({ ok: false });
    expect((bad as { fieldErrors?: Record<string, string> }).fieldErrors).toMatchObject({ company: expect.any(String), budget: expect.any(String) });

    const blocked = await submitQualification(page, start.captureId, { company: "Tiny Co", budget: "< 1k" });
    expect(blocked).toMatchObject({ ok: true, qualified: false, message: "Not a fit right now." });
    [c] = await db.select().from(contacts).where(eq(contacts.id, start.contact.id));
    expect(c.leadStatus).toBe("disqualified");
    expect(c.company).toBe("Tiny Co"); // mapped answers are kept for follow-up
    let [cap] = await db.select().from(leadCaptures).where(eq(leadCaptures.id, start.captureId));
    expect(cap.status).toBe("disqualified");

    // a disqualified lead cannot book
    const slot = (await firstSlots(page, 1))[0];
    expect(await createBooking({ page, start: new Date(slot.start), captureId: start.captureId })).toEqual({ ok: false, error: "not_qualified" });

    const ok = await submitQualification(page, start.captureId, { company: "Grown Co", budget: "5k+" });
    expect(ok).toMatchObject({ ok: true, qualified: true });
    [cap] = await db.select().from(leadCaptures).where(eq(leadCaptures.id, start.captureId));
    expect(cap.status).toBe("qualified");
    [c] = await db.select().from(contacts).where(eq(contacts.id, start.contact.id));
    expect(c.leadStatus).toBe("qualified");
  });

  it("falls back to a neutral default message and never says 'disqualified'", async () => {
    const host = await makeHost();
    const page = await makePage([host.id], { disqualifyMessage: null });
    const start = await startBooking(page, { name: "Pat Doe", email: "pat@example.com" });
    const res = await submitQualification(page, start.captureId, { company: "X", budget: "< 1k" });
    expect(res).toMatchObject({ ok: true, qualified: false });
    expect((res as { message: string }).message.toLowerCase()).not.toContain("disqualif");
  });
});

describe("booking", () => {
  it("creates the meeting, registers the invitee and completes the lead capture", async () => {
    const host = await makeHost();
    const page = await makePage([host.id], { meetingUrl: "https://meet.example.com/abc", campaignId: null });
    const start = await qualifiedCapture(page);
    const slot = (await firstSlots(page, 1))[0];

    const res = await createBooking({ page, start: new Date(slot.start), captureId: start.captureId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.event).toMatchObject({
      kind: "meeting",
      status: "scheduled",
      bookingPageId: page.id,
      hostId: host.id,
      meetingUrl: "https://meet.example.com/abc",
      timezone: "UTC",
    });
    expect(res.event.title).toBe(`Strategy call with ${start.contact.firstName} ${start.contact.lastName}`);
    expect(res.event.endsAt.getTime() - res.event.startsAt.getTime()).toBe(30 * 60_000);
    expect(res.event.notifications).toEqual(DEFAULT_PAGE_NOTIFICATIONS);
    expect(res.attendee).toMatchObject({ source: "booking", status: "registered", answers: { company: "Acme", budget: "5k+" } });

    const [cap] = await db.select().from(leadCaptures).where(eq(leadCaptures.id, start.captureId));
    expect(cap.status).toBe("completed");
    const [c] = await db.select().from(contacts).where(eq(contacts.id, start.contact.id));
    expect(c.leadStatus).toBe("booked");
    expect(c.company).toBe("Acme");
    const acts = await db.select().from(activities).where(eq(activities.contactId, c.id));
    expect(acts.some((a) => a.type === "meeting_booked")).toBe(true);

    const pending = await db.select().from(jobs).where(eq(jobs.status, "pending"));
    const kinds = pending.map((j) => (j.payload as { kind?: string; attendeeId?: string }).kind + ":" + (j.payload as { attendeeId?: string }).attendeeId);
    expect(kinds).toContain(`confirmation:${res.attendee.id}`);
    expect(kinds.filter((k) => k === `reminder:${res.attendee.id}`).length).toBeGreaterThanOrEqual(1);

    await processDueJobs();
    const sent = await db.select().from(messages).where(eq(messages.contactId, c.id));
    expect(sent.length).toBeGreaterThan(0);

    // booking the same capture twice is rejected
    const slot2 = (await firstSlots(page, 2))[1];
    expect(await createBooking({ page, start: new Date(slot2.start), captureId: start.captureId })).toEqual({ ok: false, error: "already_booked" });
  });

  it("re-checks the slot: a taken, past or invented time is refused", async () => {
    const host = await makeHost();
    const page = await makePage([host.id]);
    const a = await qualifiedCapture(page);
    const b = await qualifiedCapture(page);
    const slot = (await firstSlots(page, 1))[0];
    expect((await createBooking({ page, start: new Date(slot.start), captureId: a.captureId })).ok).toBe(true);
    expect(await createBooking({ page, start: new Date(slot.start), captureId: b.captureId })).toEqual({ ok: false, error: "slot_unavailable" });
    expect(await createBooking({ page, start: new Date("2020-01-06T09:00:00Z"), captureId: b.captureId })).toEqual({ ok: false, error: "slot_unavailable" });
    const offGrid = new Date(new Date(slot.start).getTime() + 7 * 60_000);
    expect(await createBooking({ page, start: offGrid, captureId: b.captureId })).toEqual({ ok: false, error: "slot_unavailable" });
  });

  it("refuses inactive pages and unknown capture sessions", async () => {
    const host = await makeHost();
    const page = await makePage([host.id], { isActive: false });
    const slot = new Date(Date.now() + 5 * 864e5);
    expect(await createBooking({ page, start: slot, captureId: "00000000-0000-4000-8000-000000000000" })).toEqual({ ok: false, error: "inactive" });
    const active = await makePage([host.id]);
    expect(await createBooking({ page: active, start: slot, captureId: "00000000-0000-4000-8000-000000000000" })).toEqual({ ok: false, error: "session_expired" });
  });

  it("assigns hosts round-robin and never double-books a host", async () => {
    const a = await makeHost();
    const b = await makeHost();
    const page = await makePage([a.id, b.id]);
    const slots = await getAvailableSlots(page, { now: new Date() });
    const first = slots[0];
    expect(first.hostIds).toEqual([a.id, b.id]);

    const l1 = await qualifiedCapture(page);
    const l2 = await qualifiedCapture(page);
    const l3 = await qualifiedCapture(page);
    const l4 = await qualifiedCapture(page);

    const r1 = await createBooking({ page, start: new Date(first.start), captureId: l1.captureId });
    const r2 = await createBooking({ page, start: new Date(first.start), captureId: l2.captureId });
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.hostId).toBe(a.id); // nobody assigned yet → page order
    expect(r2.hostId).toBe(b.id); // A is busy at that time
    expect(await createBooking({ page, start: new Date(first.start), captureId: l3.captureId })).toEqual({ ok: false, error: "slot_unavailable" });

    // another time, both free: B was assigned last-but-A-earlier → A has the oldest last meeting
    const later = slots.find((s) => s.start !== first.start && s.hostIds.length === 2 && new Date(s.start).getTime() - new Date(first.start).getTime() > 60 * 60_000)!;
    const r4 = await createBooking({ page, start: new Date(later.start), captureId: l4.captureId });
    expect(r4.ok && r4.hostId).toBe(a.id);
  });

  it("frees the slot when a meeting is cancelled", async () => {
    const host = await makeHost();
    const page = await makePage([host.id]);
    const a = await qualifiedCapture(page);
    const b = await qualifiedCapture(page);
    const slot = (await firstSlots(page, 1))[0];
    const r = await createBooking({ page, start: new Date(slot.start), captureId: a.captureId });
    if (!r.ok) throw new Error("booking failed");
    expect((await firstSlots(page, 1))[0].start).not.toBe(slot.start);
    await cancelRegistration(r.attendee.id, { by: "staff" });
    expect((await firstSlots(page, 1))[0].start).toBe(slot.start);
    expect((await createBooking({ page, start: new Date(slot.start), captureId: b.captureId })).ok).toBe(true);
  });
});

describe("rescheduling", () => {
  it("moves the meeting, keeps the host when free and re-plans notifications", async () => {
    const host = await makeHost();
    const page = await makePage([host.id]);
    const lead = await qualifiedCapture(page);
    const [s1, s2] = await firstSlots(page, 2);
    const booked = await createBooking({ page, start: new Date(s1.start), captureId: lead.captureId });
    if (!booked.ok) throw new Error("booking failed");
    const token = booked.attendee.manageToken;

    const ctx = await getRescheduleContext(token);
    expect(ctx.ok).toBe(true);

    // the current slot is free for this meeting itself, others are normal
    const slotsForResched = await getAvailableSlots(page, { now: new Date(), excludeEventId: booked.event.id });
    expect(slotsForResched[0].start).toBe(s1.start);

    const later = (await firstSlots(page, 20)).find((s) => new Date(s.start).getTime() > new Date(s2.start).getTime() + 3 * 3600_000)!;
    const res = await rescheduleMeeting({ token, start: new Date(later.start) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.hostChanged).toBe(false);
    expect(res.event.startsAt.toISOString()).toBe(later.start);
    expect(res.event.endsAt.getTime() - res.event.startsAt.getTime()).toBe(30 * 60_000);

    // old slot is bookable again, new one is not
    const starts = (await firstSlots(page, 50)).map((s) => s.start);
    expect(starts).toContain(s1.start);
    expect(starts).not.toContain(later.start);

    // reminders were re-planned for the new time (old ones cancelled)
    const pending = await db.select().from(jobs).where(and(eq(jobs.status, "pending"), eq(jobs.type, "event.notification")));
    const mine = pending.filter((j) => (j.payload as { attendeeId?: string }).attendeeId === booked.attendee.id);
    const startsInJobs = new Set(mine.filter((j) => (j.payload as { startsAt?: number }).startsAt != null).map((j) => (j.payload as { startsAt: number }).startsAt));
    expect([...startsInJobs]).toEqual([new Date(later.start).getTime()]);
    expect(mine.some((j) => (j.payload as { kind?: string }).kind === "confirmation" && j.dedupeKey?.endsWith(`:${new Date(later.start).getTime()}`))).toBe(true);

    const acts = await db.select().from(activities).where(eq(activities.eventId, booked.event.id));
    expect(acts.some((a) => (a.meta as { rescheduled?: boolean }).rescheduled)).toBe(true);

    // taking a time that is busy fails
    const other = await qualifiedCapture(page);
    const taken = await createBooking({ page, start: new Date(s2.start), captureId: other.captureId });
    expect(taken.ok).toBe(true);
    expect(await rescheduleMeeting({ token, start: new Date(s2.start) })).toEqual({ ok: false, error: "slot_unavailable" });
  });

  it("cannot reschedule cancelled meetings and unknown tokens", async () => {
    const host = await makeHost();
    const page = await makePage([host.id]);
    const lead = await qualifiedCapture(page);
    const [slot] = await firstSlots(page, 1);
    const booked = await createBooking({ page, start: new Date(slot.start), captureId: lead.captureId });
    if (!booked.ok) throw new Error("booking failed");
    await cancelRegistration(booked.attendee.id, { by: "attendee" });
    expect(await getRescheduleContext(booked.attendee.manageToken)).toEqual({ ok: false, reason: "cancelled" });
    expect(await getRescheduleContext("does-not-exist")).toEqual({ ok: false, reason: "not_found" });
    expect(await rescheduleMeeting({ token: "does-not-exist", start: new Date() })).toEqual({ ok: false, error: "unavailable" });
    const [row] = await db.select().from(eventAttendees).where(eq(eventAttendees.id, booked.attendee.id));
    expect(row.status).toBe("cancelled");
    const [ev] = await db.select().from(events).where(eq(events.id, booked.event.id));
    expect(ev.status).toBe("cancelled");
  });
});
