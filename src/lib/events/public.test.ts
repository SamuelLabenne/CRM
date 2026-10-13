import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupTestDb, createTestUser } from "@/test/setup-db";

const { db } = await setupTestDb();
const { events, contacts, eventAttendees, leadCaptures, jobs, messages } = await import("@/lib/db/schema");
const { captureStep, registerPublic, loadPublicEvent, loadAttendeeByToken, rsvpByToken, cancelByToken } = await import("./public");
const { processDueJobs } = await import("@/lib/jobs/runner");
const { DEFAULT_EVENT_NOTIFICATIONS } = await import("@/lib/types");

let n = 0;
async function makeEvent(over: Partial<typeof events.$inferInsert> = {}) {
  const host = await createTestUser();
  const start = new Date(Date.now() + 5 * 864e5);
  n++;
  const [e] = await db
    .insert(events)
    .values({
      title: `Webinar ${n}`,
      slug: `webinar-${n}`,
      isPublic: true,
      status: "scheduled",
      startsAt: start,
      endsAt: new Date(start.getTime() + 3600e3),
      notifications: DEFAULT_EVENT_NOTIFICATIONS,
      hostId: host.id,
      registrationQuestions: [
        { id: "company", label: "Company", type: "text", required: true, mapTo: "company" },
        { id: "size", label: "Team size", type: "select", required: false, options: ["1-5", "6-20"] },
      ],
      ...over,
    })
    .returning();
  return e;
}

const person = (email: string, extra: Record<string, unknown> = {}) => ({ firstName: "Ada", lastName: "Lovelace", email, ...extra });

describe("loadPublicEvent", () => {
  it("returns only public, non-draft events", async () => {
    const live = await makeEvent();
    expect((await loadPublicEvent(live.slug!))?.id).toBe(live.id);
    const draft = await makeEvent({ status: "draft" });
    const hidden = await makeEvent({ isPublic: false });
    expect(await loadPublicEvent(draft.slug!)).toBeNull();
    expect(await loadPublicEvent(hidden.slug!)).toBeNull();
    expect(await loadPublicEvent("nope")).toBeNull();
    expect(await loadPublicEvent("../bad slug")).toBeNull();
  });
});

describe("two-step public registration", () => {
  it("captures the lead on step 1 and registers on step 2", async () => {
    const e = await makeEvent();
    const step1 = await captureStep({ slug: e.slug!, ...person("Ada@Example.com"), phone: "0400 111 222", utm: { source: "newsletter", campaign: "launch" } });
    expect(step1).toMatchObject({ ok: true, kind: "continue" });
    if (!step1.ok || step1.kind !== "continue") throw new Error("unexpected");

    const [contact] = await db.select().from(contacts).where(eq(contacts.email, "ada@example.com"));
    expect(contact.source).toBe("registration");
    expect(contact.leadStatus).toBe("potential");
    expect(contact.utm).toEqual({ source: "newsletter", campaign: "launch" });
    const [capture] = await db.select().from(leadCaptures).where(eq(leadCaptures.id, step1.captureId));
    expect(capture.status).toBe("partial");
    expect(capture.targetId).toBe(e.id);

    const res = await registerPublic({
      slug: e.slug!,
      captureId: step1.captureId,
      answers: { company: "Analytical Engines", size: "6-20" },
      utm: { source: "newsletter", campaign: "launch" },
    });
    expect(res).toMatchObject({ ok: true, kind: "registered", status: "registered" });
    if (!res.ok || res.kind !== "registered" || !res.links) throw new Error("unexpected");
    expect(res.links.ics).toMatch(/^\/api\/ics\/attendee\//);
    expect(res.links.google).toContain("calendar.google.com");

    const [att] = await db.select().from(eventAttendees).where(and(eq(eventAttendees.eventId, e.id), eq(eventAttendees.contactId, contact.id)));
    expect(att.source).toBe("public");
    expect(att.answers).toEqual({ company: "Analytical Engines", size: "6-20" });
    expect(att.utm).toEqual({ source: "newsletter", campaign: "launch" });
    expect(res.links.manage).toBe(`/m/${att.manageToken}`);

    const [after] = await db.select().from(contacts).where(eq(contacts.id, contact.id));
    expect(after.company).toBe("Analytical Engines");
    expect(after.leadStatus).toBe("registered");
    const [done] = await db.select().from(leadCaptures).where(eq(leadCaptures.id, step1.captureId));
    expect(done.status).toBe("completed");
    expect(done.completedAt).toBeTruthy();

    await processDueJobs();
    const mail = await db.select().from(messages).where(eq(messages.contactId, contact.id));
    expect(mail.some((m) => m.subject.includes("registered") && m.status === "simulated")).toBe(true);
  });

  it("validates step 1 fields and the honeypot creates nothing", async () => {
    const e = await makeEvent();
    const bad = await captureStep({ slug: e.slug!, firstName: "", email: "not-an-email" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.fieldErrors).toMatchObject({ firstName: expect.any(String), email: expect.any(String) });

    const bot = await captureStep({ slug: e.slug!, ...person("bot@spam.test"), website: "http://spam" });
    expect(bot).toMatchObject({ ok: true, kind: "continue", captureId: "honeypot" });
    expect(await db.select().from(contacts).where(eq(contacts.email, "bot@spam.test"))).toHaveLength(0);
    const fake = await registerPublic({ slug: e.slug!, captureId: "honeypot", answers: {} });
    expect(fake).toMatchObject({ ok: true, kind: "registered" });
    expect(await db.select().from(eventAttendees).where(eq(eventAttendees.eventId, e.id))).toHaveLength(0);
  });

  it("rejects missing required answers and a capture from another event", async () => {
    const e = await makeEvent();
    const other = await makeEvent();
    const s1 = await captureStep({ slug: e.slug!, ...person("req@example.com") });
    if (!s1.ok || s1.kind !== "continue") throw new Error("unexpected");
    const res = await registerPublic({ slug: e.slug!, captureId: s1.captureId, answers: { size: "nope" } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(Object.keys(res.fieldErrors ?? {}).sort()).toEqual(["company", "size"]);
    expect(await db.select().from(eventAttendees).where(eq(eventAttendees.eventId, e.id))).toHaveLength(0);

    const crossed = await registerPublic({ slug: other.slug!, captureId: s1.captureId, answers: { company: "X" } });
    expect(crossed).toMatchObject({ ok: false, code: "capture" });
    const garbage = await registerPublic({ slug: e.slug!, captureId: "not-a-uuid", answers: { company: "X" } });
    expect(garbage).toMatchObject({ ok: false, code: "capture" });
  });

  it("skips step 2 for events without questions", async () => {
    const e = await makeEvent({ registrationQuestions: [] });
    const s1 = await captureStep({ slug: e.slug!, ...person("noq@example.com") });
    if (!s1.ok || s1.kind !== "continue") throw new Error("unexpected");
    const res = await registerPublic({ slug: e.slug!, captureId: s1.captureId, answers: {} });
    expect(res).toMatchObject({ ok: true, kind: "registered" });
  });

  it("tells an already-registered visitor their status without leaking the manage link", async () => {
    const e = await makeEvent({ registrationQuestions: [] });
    const first = await captureStep({ slug: e.slug!, ...person("dup@example.com") });
    if (!first.ok || first.kind !== "continue") throw new Error("unexpected");
    await registerPublic({ slug: e.slug!, captureId: first.captureId, answers: {} });
    await processDueJobs();
    const again = await captureStep({ slug: e.slug!, ...person("DUP@example.com") });
    expect(again).toEqual({ ok: true, kind: "already", status: "registered", resent: true });
    expect(JSON.stringify(again)).not.toContain("/m/");
    // One resend per window, even when asked repeatedly.
    await captureStep({ slug: e.slug!, ...person("dup@example.com") });
    const resends = (await db.select().from(jobs)).filter((j) => j.dedupeKey?.includes(":resend:") && j.status === "pending");
    expect(resends.length).toBeLessThanOrEqual(1);
    expect(await db.select().from(eventAttendees).where(eq(eventAttendees.eventId, e.id))).toHaveLength(1);
  });

  it("handles full events with and without a waitlist", async () => {
    const closed = await makeEvent({ capacity: 1, registrationQuestions: [] });
    const a = await captureStep({ slug: closed.slug!, ...person("a@full.test") });
    if (!a.ok || a.kind !== "continue") throw new Error("unexpected");
    await registerPublic({ slug: closed.slug!, captureId: a.captureId, answers: {} });
    const b = await captureStep({ slug: closed.slug!, ...person("b@full.test") });
    expect(b).toMatchObject({ ok: false, error: expect.stringContaining("full") });

    const wl = await makeEvent({ capacity: 1, waitlistEnabled: true, registrationQuestions: [] });
    const c = await captureStep({ slug: wl.slug!, ...person("c@wl.test") });
    const d = await captureStep({ slug: wl.slug!, ...person("d@wl.test") });
    if (!c.ok || c.kind !== "continue" || !d.ok || d.kind !== "continue") throw new Error("unexpected");
    expect(await registerPublic({ slug: wl.slug!, captureId: c.captureId, answers: {} })).toMatchObject({ kind: "registered", status: "registered" });
    expect(await registerPublic({ slug: wl.slug!, captureId: d.captureId, answers: {} })).toMatchObject({ kind: "registered", status: "waitlisted" });
  });

  it("refuses closed, past and cancelled events", async () => {
    const closed = await makeEvent({ registrationOpen: false });
    expect(await captureStep({ slug: closed.slug!, ...person("x@closed.test") })).toMatchObject({ ok: false, error: expect.stringContaining("closed") });
    const past = await makeEvent({ startsAt: new Date(Date.now() - 7200e3), endsAt: new Date(Date.now() - 3600e3) });
    expect(await captureStep({ slug: past.slug!, ...person("x@past.test") })).toMatchObject({ ok: false, error: expect.stringContaining("ended") });
    const cancelled = await makeEvent({ status: "cancelled" });
    expect(await captureStep({ slug: cancelled.slug!, ...person("x@cancel.test") })).toMatchObject({ ok: false, error: expect.stringContaining("cancelled") });
  });
});

describe("attendee self-service", () => {
  async function registered(email: string) {
    const e = await makeEvent({ registrationQuestions: [] });
    const s1 = await captureStep({ slug: e.slug!, ...person(email) });
    if (!s1.ok || s1.kind !== "continue") throw new Error("unexpected");
    const res = await registerPublic({ slug: e.slug!, captureId: s1.captureId, answers: {} });
    if (!res.ok || res.kind !== "registered" || !res.links) throw new Error("unexpected");
    return { event: e, token: res.links.manage.replace("/m/", "") };
  }

  it("loads by token and ignores malformed tokens", async () => {
    const { token, event } = await registered("m1@example.com");
    expect((await loadAttendeeByToken(token))?.event.id).toBe(event.id);
    expect(await loadAttendeeByToken("short")).toBeNull();
    expect(await loadAttendeeByToken("x".repeat(32))).toBeNull();
  });

  it("RSVP yes confirms, maybe keeps status, no cancels", async () => {
    const { token } = await registered("m2@example.com");
    expect(await rsvpByToken(token, "yes")).toMatchObject({ ok: true, status: "confirmed", rsvp: "yes", cancelled: false });
    expect(await rsvpByToken(token, "maybe")).toMatchObject({ ok: true, status: "confirmed", rsvp: "maybe" });
    expect(await rsvpByToken(token, "no")).toMatchObject({ ok: true, status: "cancelled", cancelled: true });
    expect(await rsvpByToken(token, "yes")).toMatchObject({ ok: false });
  });

  it("cancels with a reason, queues the cancellation email, and cannot cancel twice", async () => {
    const { token } = await registered("m3@example.com");
    const res = await cancelByToken(token, "  Clash with another meeting  ");
    expect(res).toMatchObject({ ok: true, cancelled: true });
    const row = await loadAttendeeByToken(token);
    expect(row?.attendee.status).toBe("cancelled");
    expect(row?.attendee.cancelReason).toBe("Clash with another meeting");
    expect((await db.select().from(jobs)).some((j) => (j.payload as { kind?: string }).kind === "cancellation")).toBe(true);
    expect(await cancelByToken(token)).toMatchObject({ ok: false });
  });

  it("blocks changes once the event has ended", async () => {
    const { token, event } = await registered("m4@example.com");
    await db.update(events).set({ startsAt: new Date(Date.now() - 7200e3), endsAt: new Date(Date.now() - 3600e3) }).where(eq(events.id, event.id));
    expect(await rsvpByToken(token, "yes")).toMatchObject({ ok: false, error: expect.stringContaining("ended") });
    expect(await cancelByToken(token)).toMatchObject({ ok: false });
  });
});
