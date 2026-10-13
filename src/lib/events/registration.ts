import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, eventAttendees, events, type Event, type EventAttendee } from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { emitTrigger } from "@/lib/automations/triggers";
import { emitWebhook } from "@/lib/webhooks";
import { setLeadStatus } from "@/lib/contacts";
import { notifyUsers } from "@/lib/notify";
import { fullName } from "@/lib/format";
import type { Answers, AttendeeStatus, MeetingOutcome, Rsvp, Utm } from "@/lib/types";
import {
  notifyHostOfRegistration,
  onAttendeeCancelled,
  scheduleAttendeeNotifications,
  cancelAttendeeNotifications,
} from "./notifications";

const ACTIVE: AttendeeStatus[] = ["registered", "confirmed", "attended", "no_show"];

/** Number of seats taken (registered, confirmed, attended, no-show). */
export async function seatsTaken(eventId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(eventAttendees)
    .where(and(eq(eventAttendees.eventId, eventId), inArray(eventAttendees.status, ACTIVE)));
  return row?.n ?? 0;
}

export type RegisterResult = {
  attendee: EventAttendee;
  /** false when the contact was already registered (nothing changed). */
  created: boolean;
  waitlisted: boolean;
};

export class EventFullError extends Error {
  constructor() {
    super("This event is full.");
  }
}

/**
 * Register a contact for an event (or create the invitee of a meeting).
 * Handles capacity/waitlist, re-registration after cancelling, activity,
 * lead status, automations, webhooks and notification emails.
 */
export async function registerForEvent(input: {
  eventId: string;
  contactId: string;
  source: EventAttendee["source"];
  answers?: Answers;
  utm?: Utm;
  actorId?: string | null;
  /** Skip the confirmation email (e.g. bulk imports). Reminders are still scheduled. */
  silent?: boolean;
  /** Staff can exceed capacity. */
  ignoreCapacity?: boolean;
}): Promise<RegisterResult> {
  const [event] = await db.select().from(events).where(eq(events.id, input.eventId));
  if (!event) throw new Error("Event not found");

  const [existing] = await db
    .select()
    .from(eventAttendees)
    .where(and(eq(eventAttendees.eventId, input.eventId), eq(eventAttendees.contactId, input.contactId)));
  if (existing && existing.status !== "cancelled") {
    return { attendee: existing, created: false, waitlisted: existing.status === "waitlisted" };
  }

  let status: AttendeeStatus = "registered";
  if (event.capacity != null && !input.ignoreCapacity) {
    const taken = await seatsTaken(event.id);
    if (taken >= event.capacity) {
      if (!event.waitlistEnabled) throw new EventFullError();
      status = "waitlisted";
    }
  }

  let attendee: EventAttendee;
  if (existing) {
    [attendee] = await db
      .update(eventAttendees)
      .set({
        status,
        cancelledAt: null,
        cancelReason: null,
        rsvp: null,
        source: input.source,
        answers: { ...existing.answers, ...(input.answers ?? {}) },
        registeredAt: new Date(),
      })
      .where(eq(eventAttendees.id, existing.id))
      .returning();
  } else {
    [attendee] = await db
      .insert(eventAttendees)
      .values({
        eventId: event.id,
        contactId: input.contactId,
        status,
        source: input.source,
        answers: input.answers ?? {},
        utm: input.utm ?? {},
      })
      .returning();
  }

  const isMeeting = event.kind === "meeting";
  await logActivity({
    contactId: input.contactId,
    type: isMeeting ? "meeting_booked" : "event_registered",
    title: isMeeting
      ? `Booked “${event.title}”`
      : status === "waitlisted"
        ? `Joined the waitlist for “${event.title}”`
        : `Registered for “${event.title}”`,
    actorId: input.actorId ?? null,
    eventId: event.id,
    meta: { attendeeId: attendee.id, source: input.source },
  });
  await setLeadStatus(input.contactId, isMeeting ? "booked" : "registered");
  await emitTrigger(isMeeting ? "meeting_booked" : "event_registered", input.contactId, {
    eventId: event.id,
    attendeeId: attendee.id,
    bookingPageId: event.bookingPageId ?? undefined,
  });
  await emitWebhook(isMeeting ? "meeting.booked" : "registration.created", {
    attendeeId: attendee.id,
    eventId: event.id,
    eventTitle: event.title,
    contactId: input.contactId,
    status,
    answers: attendee.answers,
  });
  await scheduleAttendeeNotifications(attendee.id, { sendConfirmation: !input.silent });
  if (input.source === "public" || input.source === "booking") {
    await notifyHostOfRegistration(attendee.id);
    const [c] = await db.select().from(contacts).where(eq(contacts.id, input.contactId));
    await notifyUsers({
      to: event.hostId ? [event.hostId] : "admins",
      type: isMeeting ? "meeting_booked" : "registration",
      title: isMeeting ? `New booking: ${fullName(c)}` : `New registration: ${fullName(c)}`,
      body: event.title,
      href: `/events/${event.id}`,
    });
  }
  return { attendee, created: true, waitlisted: status === "waitlisted" };
}

/** Cancel a registration/meeting (by the attendee via their manage link, or by staff). */
export async function cancelRegistration(
  attendeeId: string,
  opts: { reason?: string | null; actorId?: string | null; notify?: boolean; by: "attendee" | "staff" },
) {
  const [row] = await db
    .select({ attendee: eventAttendees, event: events })
    .from(eventAttendees)
    .innerJoin(events, eq(events.id, eventAttendees.eventId))
    .where(eq(eventAttendees.id, attendeeId));
  if (!row || row.attendee.status === "cancelled") return null;
  const { event } = row;
  const isMeeting = event.kind === "meeting";
  const [attendee] = await db
    .update(eventAttendees)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelReason: opts.reason ?? null,
      outcome: isMeeting ? ("cancelled" as MeetingOutcome) : row.attendee.outcome,
      markedById: opts.actorId ?? null,
    })
    .where(eq(eventAttendees.id, attendeeId))
    .returning();
  await logActivity({
    contactId: attendee.contactId,
    type: isMeeting ? "meeting_cancelled" : "event_cancelled",
    title: `${opts.by === "attendee" ? "Cancelled" : "Registration cancelled for"} “${event.title}”`,
    body: opts.reason ?? null,
    actorId: opts.actorId ?? null,
    eventId: event.id,
  });
  await emitTrigger(isMeeting ? "meeting_cancelled" : "event_cancelled", attendee.contactId, {
    eventId: event.id,
    attendeeId,
  });
  await emitWebhook(isMeeting ? "meeting.cancelled" : "registration.cancelled", {
    attendeeId,
    eventId: event.id,
    contactId: attendee.contactId,
    by: opts.by,
    reason: opts.reason ?? null,
  });
  await onAttendeeCancelled(attendeeId, { notify: opts.notify });
  if (isMeeting) {
    // A cancelled 1:1 meeting frees the slot; mark the meeting event itself as cancelled.
    await db.update(events).set({ status: "cancelled" }).where(eq(events.id, event.id));
  } else {
    await promoteFromWaitlist(event);
  }
  if (opts.by === "attendee") {
    await notifyUsers({
      to: event.hostId ? [event.hostId] : "admins",
      type: "cancellation",
      title: `Cancellation: ${event.title}`,
      body: opts.reason ?? undefined,
      href: `/events/${event.id}`,
    });
  }
  return attendee;
}

/** Fill free seats from the waitlist (oldest first). */
export async function promoteFromWaitlist(event: Event) {
  if (event.capacity == null) return;
  let free = event.capacity - (await seatsTaken(event.id));
  if (free <= 0) return;
  const waiting = await db
    .select()
    .from(eventAttendees)
    .where(and(eq(eventAttendees.eventId, event.id), eq(eventAttendees.status, "waitlisted")))
    .orderBy(asc(eventAttendees.registeredAt))
    .limit(free);
  for (const w of waiting) {
    if (free-- <= 0) break;
    await db.update(eventAttendees).set({ status: "registered" }).where(eq(eventAttendees.id, w.id));
    await logActivity({
      contactId: w.contactId,
      type: "event_registered",
      title: `Moved off the waitlist for “${event.title}”`,
      eventId: event.id,
    });
    await scheduleAttendeeNotifications(w.id, { sendConfirmation: true });
  }
}

/** Record attendance (attended / no_show), or reset to registered. */
export async function markAttendance(
  attendeeId: string,
  status: "attended" | "no_show" | "registered" | "confirmed",
  opts: { actorId?: string | null } = {},
) {
  const [row] = await db
    .select({ attendee: eventAttendees, event: events })
    .from(eventAttendees)
    .innerJoin(events, eq(events.id, eventAttendees.eventId))
    .where(eq(eventAttendees.id, attendeeId));
  if (!row || row.attendee.status === status) return row?.attendee ?? null;
  const { event } = row;
  const [attendee] = await db
    .update(eventAttendees)
    .set({
      status,
      checkedInAt: status === "attended" ? (row.attendee.checkedInAt ?? new Date()) : null,
      outcome: status === "no_show" && event.kind === "meeting" ? "no_show" : row.attendee.outcome,
      markedById: opts.actorId ?? null,
    })
    .where(eq(eventAttendees.id, attendeeId))
    .returning();
  if (status === "attended" || status === "no_show") {
    await logActivity({
      contactId: attendee.contactId,
      type: status === "attended" ? "event_attended" : "event_no_show",
      title: status === "attended" ? `Attended “${event.title}”` : `No-show for “${event.title}”`,
      actorId: opts.actorId ?? null,
      eventId: event.id,
    });
    await emitTrigger(status === "attended" ? "event_attended" : "event_no_show", attendee.contactId, {
      eventId: event.id,
      attendeeId,
    });
    await emitWebhook("attendance.recorded", {
      attendeeId,
      eventId: event.id,
      contactId: attendee.contactId,
      status,
    });
  }
  return attendee;
}

/** Store an RSVP from an email link. "no" cancels the registration. */
export async function setRsvp(attendeeId: string, rsvp: Rsvp) {
  const [row] = await db
    .select({ attendee: eventAttendees, event: events })
    .from(eventAttendees)
    .innerJoin(events, eq(events.id, eventAttendees.eventId))
    .where(eq(eventAttendees.id, attendeeId));
  if (!row || row.attendee.status === "cancelled") return null;
  if (rsvp === "no") {
    await db.update(eventAttendees).set({ rsvp }).where(eq(eventAttendees.id, attendeeId));
    return cancelRegistration(attendeeId, { by: "attendee", reason: "RSVP: no" });
  }
  const [attendee] = await db
    .update(eventAttendees)
    .set({ rsvp, status: rsvp === "yes" && row.attendee.status === "registered" ? "confirmed" : row.attendee.status })
    .where(eq(eventAttendees.id, attendeeId))
    .returning();
  await logActivity({
    contactId: attendee.contactId,
    type: "rsvp",
    title: `RSVP “${rsvp}” for “${row.event.title}”`,
    eventId: row.event.id,
  });
  return attendee;
}

/** Log an outcome on a meeting (iClosed-style call outcome). */
export async function setMeetingOutcome(
  attendeeId: string,
  input: { outcome: MeetingOutcome; objection?: string | null; notes?: string | null; dealValue?: number | null },
  opts: { actorId?: string | null } = {},
) {
  const [row] = await db
    .select({ attendee: eventAttendees, event: events })
    .from(eventAttendees)
    .innerJoin(events, eq(events.id, eventAttendees.eventId))
    .where(eq(eventAttendees.id, attendeeId));
  if (!row) return null;
  const status: AttendeeStatus =
    input.outcome === "no_show" ? "no_show" : input.outcome === "cancelled" ? "cancelled" : "attended";
  const [attendee] = await db
    .update(eventAttendees)
    .set({
      outcome: input.outcome,
      objection: input.objection ?? null,
      outcomeNotes: input.notes ?? null,
      dealValue: input.dealValue ?? null,
      status,
      checkedInAt: status === "attended" ? (row.attendee.checkedInAt ?? new Date()) : row.attendee.checkedInAt,
      markedById: opts.actorId ?? null,
    })
    .where(eq(eventAttendees.id, attendeeId))
    .returning();
  if (status === "cancelled") await cancelAttendeeNotifications(attendeeId);
  await logActivity({
    contactId: attendee.contactId,
    type: "meeting_outcome",
    title: `Outcome for “${row.event.title}”: ${input.outcome.replace("_", " ")}`,
    body: input.notes ?? null,
    actorId: opts.actorId ?? null,
    eventId: row.event.id,
    meta: { outcome: input.outcome, objection: input.objection, dealValue: input.dealValue },
  });
  if (input.outcome === "won" && input.dealValue != null) {
    await db.update(contacts).set({ dealValue: input.dealValue }).where(eq(contacts.id, attendee.contactId));
  }
  await emitTrigger("meeting_outcome", attendee.contactId, {
    eventId: row.event.id,
    attendeeId,
    outcome: input.outcome,
  });
  await emitWebhook("meeting.outcome", {
    attendeeId,
    eventId: row.event.id,
    contactId: attendee.contactId,
    outcome: input.outcome,
    objection: input.objection ?? null,
    dealValue: input.dealValue ?? null,
  });
  return attendee;
}
