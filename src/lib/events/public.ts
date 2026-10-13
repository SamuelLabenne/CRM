import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { contacts, eventAttendees, events, leadCaptures, type Event, type EventAttendee } from "@/lib/db/schema";
import { normalizeEmail } from "@/lib/contacts";
import { applyAnswerMappings, captureLead, updateLeadCapture, validateAnswers } from "@/lib/leads";
import { enqueueJob } from "@/lib/jobs/queue";
import { attendeeIcsPath, attendeeManagePath } from "@/lib/urls";
import { googleCalendarLink } from "@/lib/ics";
import { eventLocationText } from "@/lib/email/context";
import type { AttendeeStatus, Rsvp, Utm } from "@/lib/types";
import { EventFullError, cancelRegistration, registerForEvent, seatsTaken, setRsvp } from "./registration";
import { registrationState, type PublicEventState } from "./utils";

// Logic behind the public pages: registration (/e, /embed/e), attendee self-service (/m).
// The server actions next to the pages are thin wrappers around these functions.

/** The event behind a public registration slug, or null when it must 404 (unknown, not public, draft). */
export async function loadPublicEvent(slug: string): Promise<Event | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const [event] = await db.select().from(events).where(and(eq(events.slug, slug), eq(events.kind, "event")));
  if (!event || !event.isPublic || event.status === "draft") return null;
  return event;
}

export async function publicEventState(event: Event, now = new Date()): Promise<{ state: PublicEventState; seatsTaken: number }> {
  const taken = event.capacity != null ? await seatsTaken(event.id) : 0;
  return { state: registrationState(event, taken, now), seatsTaken: taken };
}

/** Calendar/manage links for a registered attendee (server-computed; client components must not import @/lib/urls). */
export function attendeeLinks(event: Event, manageToken: string) {
  return {
    manage: attendeeManagePath(manageToken),
    ics: attendeeIcsPath(manageToken),
    google: googleCalendarLink({
      title: event.title,
      description: [event.description, event.meetingUrl].filter(Boolean).join("\n\n"),
      location: event.meetingUrl || eventLocationText(event),
      start: event.startsAt,
      end: event.endsAt,
    }),
  };
}

// ---------------------------------------------------------------------------
// Registration form
// ---------------------------------------------------------------------------

const HONEYPOT_CAPTURE = "honeypot";

const stepOneSchema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name").max(80),
  lastName: z.string().trim().max(80).optional(),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200),
  phone: z.string().trim().max(40).optional(),
});

export type StepOneInput = z.input<typeof stepOneSchema> & {
  slug: string;
  utm?: Utm;
  /** Honeypot: real visitors never see or fill this field. */
  website?: string;
};

export type CaptureStepResult =
  | { ok: true; kind: "continue"; captureId: string }
  | { ok: true; kind: "already"; status: AttendeeStatus; resent: boolean }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const CLOSED_MESSAGES: Record<Exclude<PublicEventState, "open" | "waitlist">, string> = {
  full: "Sorry, this event is full.",
  closed: "Registration for this event is closed.",
  past: "This event has already ended.",
  cancelled: "This event has been cancelled.",
};

/** Re-send the confirmation email (at most once per 10 minutes) to the address that is already registered. */
async function resendConfirmation(attendee: EventAttendee, event: Event) {
  if (!event.notifications.confirmation.enabled) return false;
  const bucket = Math.floor(Date.now() / (10 * 60_000));
  await enqueueJob(
    "event.notification",
    {
      attendeeId: attendee.id,
      kind: attendee.status === "waitlisted" ? "waitlisted" : "confirmation",
      templateId: event.notifications.confirmation.templateId ?? null,
    },
    { dedupeKey: `evt-notif:${attendee.id}:resend:${bucket}` },
  );
  return true;
}

/**
 * Step 1 of the public form: validate name/email, upsert the contact and open a lead capture
 * ("potential" lead). Someone who is already registered is told so (and gets the confirmation
 * e-mail again) instead of receiving their private manage link on screen.
 */
export async function captureStep(input: StepOneInput): Promise<CaptureStepResult> {
  if (input.website) return { ok: true, kind: "continue", captureId: HONEYPOT_CAPTURE };
  const event = await loadPublicEvent(input.slug);
  if (!event) return { ok: false, error: "This event is no longer available." };
  const parsed = stepOneSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check your details", fieldErrors };
  }
  const v = parsed.data;
  const email = normalizeEmail(v.email);
  if (!email) return { ok: false, error: "Enter a valid email address", fieldErrors: { email: "Enter a valid email address" } };

  const existing = await findRegistration(event.id, email);
  if (existing) {
    const resent = await resendConfirmation(existing, event);
    return { ok: true, kind: "already", status: existing.status, resent };
  }

  const { state } = await publicEventState(event);
  if (state !== "open" && state !== "waitlist") return { ok: false, error: CLOSED_MESSAGES[state] };

  const { capture } = await captureLead({
    kind: "registration",
    targetId: event.id,
    firstName: v.firstName,
    lastName: v.lastName || null,
    email,
    phone: v.phone || null,
    utm: input.utm,
    label: event.title,
  });
  return { ok: true, kind: "continue", captureId: capture.id };
}

async function findRegistration(eventId: string, email: string) {
  const [row] = await db
    .select({ attendee: eventAttendees })
    .from(eventAttendees)
    .innerJoin(contacts, eq(contacts.id, eventAttendees.contactId))
    .where(and(eq(eventAttendees.eventId, eventId), eq(contacts.email, email), ne(eventAttendees.status, "cancelled")))
    .limit(1);
  return row?.attendee ?? null;
}

export type RegisterPublicInput = {
  slug: string;
  captureId: string;
  /** Raw answers keyed by question id (see answersFromFormData). */
  answers: Record<string, unknown>;
  utm?: Utm;
  website?: string;
};

export type RegisterPublicResult =
  | {
      ok: true;
      kind: "registered";
      status: "registered" | "waitlisted";
      /** null only for honeypot hits (bots). */
      links: { manage: string; ics: string; google: string } | null;
    }
  | { ok: true; kind: "already"; status: AttendeeStatus; resent: boolean }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; code?: "full" | "closed" | "capture" };

/** Step 2 (or the only step when there are no questions): validate answers and register. */
export async function registerPublic(input: RegisterPublicInput): Promise<RegisterPublicResult> {
  if (input.website || input.captureId === HONEYPOT_CAPTURE) {
    return { ok: true, kind: "registered", status: "registered", links: null };
  }
  const event = await loadPublicEvent(input.slug);
  if (!event) return { ok: false, error: "This event is no longer available.", code: "closed" };
  if (!z.uuid().safeParse(input.captureId).success) return { ok: false, error: "Your session expired – please start again.", code: "capture" };

  const [capture] = await db.select().from(leadCaptures).where(eq(leadCaptures.id, input.captureId));
  if (!capture || capture.kind !== "registration" || capture.targetId !== event.id) {
    return { ok: false, error: "Your session expired – please start again.", code: "capture" };
  }

  const { answers, errors, valid } = validateAnswers(event.registrationQuestions, input.answers ?? {});
  if (!valid) return { ok: false, error: "Please fix the highlighted answers.", fieldErrors: errors };

  const [contact] = await db.select().from(contacts).where(eq(contacts.id, capture.contactId));
  if (!contact) return { ok: false, error: "Your session expired – please start again.", code: "capture" };

  const [existing] = await db
    .select()
    .from(eventAttendees)
    .where(and(eq(eventAttendees.eventId, event.id), eq(eventAttendees.contactId, contact.id), ne(eventAttendees.status, "cancelled")));
  if (existing) {
    const resent = await resendConfirmation(existing, event);
    await updateLeadCapture(capture.id, { status: "completed", answers });
    return { ok: true, kind: "already", status: existing.status, resent };
  }

  const { state } = await publicEventState(event);
  if (state !== "open" && state !== "waitlist") {
    return { ok: false, error: CLOSED_MESSAGES[state], code: state === "full" ? "full" : "closed" };
  }

  try {
    const res = await registerForEvent({
      eventId: event.id,
      contactId: contact.id,
      source: "public",
      answers,
      utm: input.utm ?? capture.utm,
    });
    await applyAnswerMappings(contact.id, event.registrationQuestions, answers);
    await updateLeadCapture(capture.id, { status: "completed", answers });
    return {
      ok: true,
      kind: "registered",
      status: res.waitlisted ? "waitlisted" : "registered",
      links: attendeeLinks(event, res.attendee.manageToken),
    };
  } catch (err) {
    if (err instanceof EventFullError) return { ok: false, error: CLOSED_MESSAGES.full, code: "full" };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Attendee self-service (/m/[token])
// ---------------------------------------------------------------------------

export async function loadAttendeeByToken(token: string) {
  if (!/^[a-zA-Z0-9]{16,64}$/.test(token)) return null;
  const [row] = await db
    .select({ attendee: eventAttendees, event: events, contact: contacts })
    .from(eventAttendees)
    .innerJoin(events, eq(events.id, eventAttendees.eventId))
    .innerJoin(contacts, eq(contacts.id, eventAttendees.contactId))
    .where(eq(eventAttendees.manageToken, token));
  return row ?? null;
}

export type SelfServiceResult =
  | { ok: true; status: AttendeeStatus; rsvp: Rsvp | null; cancelled: boolean }
  | { ok: false; error: string };

function selfServiceBlocked(row: NonNullable<Awaited<ReturnType<typeof loadAttendeeByToken>>>): string | null {
  if (row.attendee.status === "cancelled") return "This registration has already been cancelled.";
  if (row.event.status === "cancelled") return "This event has been cancelled.";
  if (row.event.endsAt.getTime() <= Date.now()) return "This event has already ended.";
  return null;
}

/** RSVP from the manage page. "no" cancels the registration. */
export async function rsvpByToken(token: string, rsvp: Rsvp): Promise<SelfServiceResult> {
  if (!["yes", "no", "maybe"].includes(rsvp)) return { ok: false, error: "Unknown response." };
  const row = await loadAttendeeByToken(token);
  if (!row) return { ok: false, error: "We couldn't find this registration." };
  const blocked = selfServiceBlocked(row);
  if (blocked) return { ok: false, error: blocked };
  const updated = await setRsvp(row.attendee.id, rsvp);
  if (!updated) return { ok: false, error: "We couldn't update your response." };
  return { ok: true, status: updated.status, rsvp: updated.rsvp, cancelled: updated.status === "cancelled" };
}

export async function cancelByToken(token: string, reason?: string | null): Promise<SelfServiceResult> {
  const row = await loadAttendeeByToken(token);
  if (!row) return { ok: false, error: "We couldn't find this registration." };
  const blocked = selfServiceBlocked(row);
  if (blocked) return { ok: false, error: blocked };
  const cancelled = await cancelRegistration(row.attendee.id, { by: "attendee", reason: reason?.trim().slice(0, 500) || null });
  if (!cancelled) return { ok: false, error: "We couldn't cancel this registration." };
  return { ok: true, status: cancelled.status, rsvp: cancelled.rsvp, cancelled: true };
}
