import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  bookingPages,
  contacts,
  eventAttendees,
  events,
  leadCaptures,
  users,
  type BookingPage,
  type Contact,
  type Event,
  type EventAttendee,
} from "@/lib/db/schema";
import { getSetting } from "@/lib/settings";
import { fullName } from "@/lib/format";
import { logActivity } from "@/lib/activity";
import { notifyUsers } from "@/lib/notify";
import { enqueueJob } from "@/lib/jobs/queue";
import { setLeadStatus, splitName } from "@/lib/contacts";
import { applyAnswerMappings, captureLead, isDisqualified, updateLeadCapture, validateAnswers } from "@/lib/leads";
import { registerForEvent } from "@/lib/events/registration";
import { replanEventNotifications } from "@/lib/events/notifications";
import type { Answers, Utm } from "@/lib/types";
import { getFreeHostsAt, loadHostLoads } from "./slots";
import { pickRoundRobinHost } from "./slots-core";

const MIN = 60_000;

export const DEFAULT_DISQUALIFY_MESSAGE =
  "Thanks so much for your interest. Based on your answers we are not able to offer a call right now, but we will keep you in mind.";

export async function getBookingPageBySlug(slug: string): Promise<BookingPage | null> {
  const [page] = await db.select().from(bookingPages).where(eq(bookingPages.slug, slug)).limit(1);
  return page ?? null;
}

/** Hosts shown on the public page (name & color only – no emails). */
export async function getPublicHosts(hostIds: string[]) {
  if (!hostIds.length) return [];
  const rows = await db.select({ id: users.id, name: users.name, color: users.color, title: users.title, deactivatedAt: users.deactivatedAt }).from(users);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return hostIds
    .map((id) => byId.get(id))
    .filter((u): u is NonNullable<typeof u> => !!u && !u.deactivatedAt)
    .map((u) => ({ name: u.name, color: u.color, title: u.title }));
}

// ---------------------------------------------------------------------------
// Step 1 & 2: lead capture + qualification
// ---------------------------------------------------------------------------

export type StartBookingResult = { contact: Contact; captureId: string; next: "questions" | "calendar" };

/** Step 1: upsert the contact, start (or resume) the lead capture. Pages without questions qualify immediately. */
export async function startBooking(
  page: BookingPage,
  input: { name: string; email: string; phone?: string | null; utm?: Utm },
): Promise<StartBookingResult> {
  const { firstName, lastName } = splitName(input.name);
  const { contact, capture } = await captureLead({
    kind: "booking",
    targetId: page.id,
    firstName,
    lastName,
    email: input.email,
    phone: input.phone ?? null,
    utm: input.utm,
    label: page.title,
  });
  if (!page.questions.length) {
    if (capture.status !== "qualified") {
      await updateLeadCapture(capture.id, { status: "qualified" });
      await setLeadStatus(contact.id, "qualified");
    }
    return { contact, captureId: capture.id, next: "calendar" };
  }
  return { contact, captureId: capture.id, next: capture.status === "qualified" ? "calendar" : "questions" };
}

async function loadCapture(page: BookingPage, captureId: string) {
  const [capture] = await db
    .select()
    .from(leadCaptures)
    .where(and(eq(leadCaptures.id, captureId), eq(leadCaptures.targetId, page.id), eq(leadCaptures.kind, "booking")))
    .limit(1);
  return capture ?? null;
}

export type QualifyResult =
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
  | { ok: true; qualified: true }
  | { ok: true; qualified: false; message: string; redirectUrl: string | null };

/** Step 2: validate answers and evaluate the disqualification rules (server side). */
export async function submitQualification(page: BookingPage, captureId: string, raw: Record<string, unknown>): Promise<QualifyResult> {
  const capture = await loadCapture(page, captureId);
  if (!capture || capture.status === "completed") {
    return { ok: false, error: "This booking session has expired. Please start again." };
  }
  const { answers, errors, valid } = validateAnswers(page.questions, raw);
  if (!valid) return { ok: false, error: "Please check your answers.", fieldErrors: errors };

  await applyAnswerMappings(capture.contactId, page.questions, answers);
  const verdict = isDisqualified(page.disqualifyRules, answers);
  if (verdict.disqualified) {
    await updateLeadCapture(capture.id, { status: "disqualified", answers });
    await setLeadStatus(capture.contactId, "disqualified");
    return {
      ok: true,
      qualified: false,
      message: page.disqualifyMessage?.trim() || DEFAULT_DISQUALIFY_MESSAGE,
      redirectUrl: page.disqualifyRedirectUrl?.trim() || null,
    };
  }
  await updateLeadCapture(capture.id, { status: "qualified", answers });
  await setLeadStatus(capture.contactId, "qualified");
  return { ok: true, qualified: true };
}

// ---------------------------------------------------------------------------
// Step 3: create the meeting
// ---------------------------------------------------------------------------

export type BookingFailure = "inactive" | "slot_unavailable" | "no_host" | "session_expired" | "not_qualified" | "already_booked";

export type CreateBookingResult =
  | { ok: true; event: Event; attendee: EventAttendee; hostId: string; hostName: string; contact: Contact }
  | { ok: false; error: BookingFailure };

export const BOOKING_ERRORS: Record<BookingFailure, string> = {
  inactive: "This booking page is not available right now.",
  slot_unavailable: "Sorry, that time was just taken. Please pick another time.",
  no_host: "There is nobody available to take this meeting right now.",
  session_expired: "This booking session has expired. Please start again.",
  not_qualified: "Please answer the questions first.",
  already_booked: "This meeting is already booked.",
};

/**
 * Create the meeting for a qualified lead. Re-checks the slot under a lock (so two visitors can't
 * book the same time), picks the host round-robin, then registers the contact (emails, reminders,
 * activity, automations) and completes the lead capture.
 */
export async function createBooking(input: {
  page: BookingPage;
  start: Date;
  captureId: string;
  now?: Date;
}): Promise<CreateBookingResult> {
  const { page, start } = input;
  const now = input.now ?? new Date();
  if (!page.isActive) return { ok: false, error: "inactive" };
  const capture = await loadCapture(page, input.captureId);
  if (!capture) return { ok: false, error: "session_expired" };
  if (capture.status === "completed") return { ok: false, error: "already_booked" };
  if (capture.status !== "qualified") return { ok: false, error: "not_qualified" };
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, capture.contactId));
  if (!contact) return { ok: false, error: "session_expired" };

  const workspace = await getSetting("workspace");
  const end = new Date(start.getTime() + page.durationMinutes * MIN);

  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('relay-booking'))`);
    const [fresh] = await tx.select({ status: leadCaptures.status }).from(leadCaptures).where(eq(leadCaptures.id, capture.id));
    if (fresh?.status === "completed") return "already_booked" as const;
    const { hostIds: free, hosts } = await getFreeHostsAt(page, start, { now, tx, workspaceTimezone: workspace.timezone });
    if (!free.length) return hosts.length ? ("slot_unavailable" as const) : ("no_host" as const);
    const loads = await loadHostLoads(page.id, free, now, tx);
    const hostId = pickRoundRobinHost(free, loads) ?? free[0];
    const host = hosts.find((h) => h.id === hostId);
    const [event] = await tx
      .insert(events)
      .values({
        kind: "meeting",
        bookingPageId: page.id,
        campaignId: page.campaignId,
        title: `${page.title} with ${fullName(contact)}`,
        description: page.description,
        type: "meeting",
        locationType: page.locationType,
        location: page.location,
        meetingUrl: page.meetingUrl,
        startsAt: start,
        endsAt: end,
        timezone: host?.timezone ?? workspace.timezone,
        status: "scheduled",
        isPublic: false,
        registrationOpen: false,
        notifications: page.notifications,
        color: page.color,
        hostId,
      })
      .returning();
    return { event, hostId };
  });
  if (typeof created === "string") return { ok: false, error: created };

  const { event, hostId } = created;
  let attendee: EventAttendee;
  try {
    const reg = await registerForEvent({
      eventId: event.id,
      contactId: contact.id,
      source: "booking",
      answers: capture.answers as Answers,
      utm: capture.utm,
    });
    attendee = reg.attendee;
  } catch (err) {
    await db.delete(events).where(eq(events.id, event.id));
    throw err;
  }
  await applyAnswerMappings(contact.id, page.questions, capture.answers as Answers);
  await updateLeadCapture(capture.id, { status: "completed" });
  const [host] = await db.select({ name: users.name }).from(users).where(eq(users.id, hostId));
  return { ok: true, event, attendee, hostId, hostName: host?.name ?? "Your host", contact };
}

// ---------------------------------------------------------------------------
// Reschedule
// ---------------------------------------------------------------------------

export type RescheduleContext = {
  attendee: EventAttendee;
  event: Event;
  contact: Contact;
  page: BookingPage;
};

export type RescheduleLookup =
  | { ok: true; ctx: RescheduleContext }
  | { ok: false; reason: "not_found" | "not_a_meeting" | "cancelled" | "past" | "no_page" };

/** Resolve a manage token to a reschedulable meeting. */
export async function getRescheduleContext(token: string, now: Date = new Date()): Promise<RescheduleLookup> {
  const [row] = await db
    .select({ attendee: eventAttendees, event: events, contact: contacts })
    .from(eventAttendees)
    .innerJoin(events, eq(events.id, eventAttendees.eventId))
    .innerJoin(contacts, eq(contacts.id, eventAttendees.contactId))
    .where(eq(eventAttendees.manageToken, token))
    .limit(1);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.event.kind !== "meeting") return { ok: false, reason: "not_a_meeting" };
  if (row.attendee.status === "cancelled" || row.event.status === "cancelled") return { ok: false, reason: "cancelled" };
  if (row.event.endsAt.getTime() < now.getTime() || row.event.status === "completed") return { ok: false, reason: "past" };
  if (!row.event.bookingPageId) return { ok: false, reason: "no_page" };
  const [page] = await db.select().from(bookingPages).where(eq(bookingPages.id, row.event.bookingPageId)).limit(1);
  if (!page) return { ok: false, reason: "no_page" };
  return { ok: true, ctx: { ...row, page } };
}

export type RescheduleResult =
  | { ok: true; event: Event; attendee: EventAttendee; hostId: string; hostName: string; previousStart: Date; hostChanged: boolean }
  | { ok: false; error: "unavailable" | "slot_unavailable" | "no_host" };

/** Move a booked meeting to another slot of the same page. Keeps the host when free, else round robin. */
export async function rescheduleMeeting(input: { token: string; start: Date; now?: Date; actorId?: string | null }): Promise<RescheduleResult> {
  const now = input.now ?? new Date();
  const lookup = await getRescheduleContext(input.token, now);
  if (!lookup.ok) return { ok: false, error: "unavailable" };
  const { event: before, attendee, page, contact } = lookup.ctx;
  const workspace = await getSetting("workspace");
  const end = new Date(input.start.getTime() + page.durationMinutes * MIN);

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('relay-booking'))`);
    const { hostIds: free, hosts } = await getFreeHostsAt(page, input.start, {
      now,
      tx,
      excludeEventId: before.id,
      workspaceTimezone: workspace.timezone,
    });
    if (!free.length) return hosts.length ? ("slot_unavailable" as const) : ("no_host" as const);
    let hostId: string | null = before.hostId && free.includes(before.hostId) ? before.hostId : null;
    if (!hostId) {
      const loads = await loadHostLoads(page.id, free, now, tx);
      hostId = pickRoundRobinHost(free, loads) ?? free[0];
    }
    const host = hosts.find((h) => h.id === hostId);
    const [updated] = await tx
      .update(events)
      .set({ startsAt: input.start, endsAt: end, hostId, timezone: host?.timezone ?? before.timezone, status: "scheduled" })
      .where(and(eq(events.id, before.id), ne(events.status, "cancelled")))
      .returning();
    return { updated, hostId };
  });
  if (typeof result === "string") return { ok: false, error: result };

  const { updated, hostId } = result;
  if (!updated) return { ok: false, error: "unavailable" };
  const hostChanged = before.hostId !== hostId;

  await replanEventNotifications(updated.id);
  if (updated.notifications.confirmation.enabled) {
    // A fresh confirmation for the new time (the dedupe key contains the start time).
    await enqueueJob(
      "event.notification",
      { attendeeId: attendee.id, kind: "confirmation", templateId: updated.notifications.confirmation.templateId ?? null },
      { dedupeKey: `evt-notif:${attendee.id}:confirmation:${updated.startsAt.getTime()}` },
    );
  }
  await logActivity({
    contactId: attendee.contactId,
    type: "meeting_booked",
    title: `Rescheduled “${updated.title}”`,
    body: `From ${before.startsAt.toISOString()} to ${updated.startsAt.toISOString()}`,
    actorId: input.actorId ?? null,
    eventId: updated.id,
    meta: { rescheduled: true, from: before.startsAt.toISOString(), to: updated.startsAt.toISOString(), attendeeId: attendee.id },
  });
  const recipients = [hostId, before.hostId].filter((x): x is string => !!x);
  await notifyUsers({
    to: [...new Set(recipients)],
    type: "meeting_rescheduled",
    title: `Meeting rescheduled: ${fullName(contact)}`,
    body: updated.title,
    href: "/meetings",
  });
  const [host] = await db.select({ name: users.name }).from(users).where(eq(users.id, hostId));
  return { ok: true, event: updated, attendee, hostId, hostName: host?.name ?? "Your host", previousStart: before.startsAt, hostChanged };
}
