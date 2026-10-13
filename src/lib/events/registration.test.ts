import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupTestDb, createTestUser } from "@/test/setup-db";

const { db } = await setupTestDb();
const { events, eventAttendees, jobs, messages } = await import("@/lib/db/schema");
const { upsertContact } = await import("@/lib/contacts");
const { registerForEvent, cancelRegistration, markAttendance, EventFullError } = await import("./registration");
const { processDueJobs } = await import("@/lib/jobs/runner");
const { DEFAULT_EVENT_NOTIFICATIONS } = await import("@/lib/types");

async function makeEvent(capacity: number | null, waitlist = false) {
  const host = await createTestUser();
  const start = new Date(Date.now() + 3 * 864e5);
  const [e] = await db
    .insert(events)
    .values({
      title: "Workshop",
      startsAt: start,
      endsAt: new Date(start.getTime() + 3600e3),
      capacity,
      waitlistEnabled: waitlist,
      notifications: DEFAULT_EVENT_NOTIFICATIONS,
      hostId: host.id,
    })
    .returning();
  return e;
}

describe("registration flow", () => {
  it("registers, schedules notifications, sends confirmation via jobs", async () => {
    const e = await makeEvent(10);
    const { contact } = await upsertContact({ email: "Ada@Example.com", firstName: "Ada" }, { source: "manual" });
    expect(contact.email).toBe("ada@example.com");
    const res = await registerForEvent({ eventId: e.id, contactId: contact.id, source: "public" });
    expect(res.created).toBe(true);
    const pending = await db.select().from(jobs).where(eq(jobs.status, "pending"));
    const types = pending.map((j) => `${j.type}:${(j.payload as { kind?: string }).kind ?? ""}`);
    expect(types).toContain("event.notification:confirmation");
    expect(types.filter((t) => t === "event.notification:reminder")).toHaveLength(2);
    await processDueJobs();
    const sent = await db.select().from(messages).where(eq(messages.contactId, contact.id));
    expect(sent.some((m) => m.subject.includes("You're registered: Workshop") && m.status === "simulated")).toBe(true);
  });

  it("enforces capacity with waitlist and promotes on cancel", async () => {
    const e = await makeEvent(1, true);
    const a = (await upsertContact({ email: "a@x.io" }, { source: "manual" })).contact;
    const b = (await upsertContact({ email: "b@x.io" }, { source: "manual" })).contact;
    const ra = await registerForEvent({ eventId: e.id, contactId: a.id, source: "manual" });
    const rb = await registerForEvent({ eventId: e.id, contactId: b.id, source: "manual" });
    expect(rb.waitlisted).toBe(true);
    await cancelRegistration(ra.attendee.id, { by: "staff" });
    const [bRow] = await db
      .select()
      .from(eventAttendees)
      .where(and(eq(eventAttendees.eventId, e.id), eq(eventAttendees.contactId, b.id)));
    expect(bRow.status).toBe("registered");
  });

  it("throws when full without waitlist; marks attendance", async () => {
    const e = await makeEvent(1, false);
    const a = (await upsertContact({ email: "c@x.io" }, { source: "manual" })).contact;
    const b = (await upsertContact({ email: "d@x.io" }, { source: "manual" })).contact;
    const ra = await registerForEvent({ eventId: e.id, contactId: a.id, source: "manual" });
    await expect(registerForEvent({ eventId: e.id, contactId: b.id, source: "manual" })).rejects.toBeInstanceOf(EventFullError);
    const att = await markAttendance(ra.attendee.id, "attended");
    expect(att?.status).toBe("attended");
    expect(att?.checkedInAt).toBeTruthy();
  });
});
