import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { eventAttendees, events, users, type Event, type EventAttendee } from "@/lib/db/schema";
import { cancelJobsByPrefix, enqueueJob } from "@/lib/jobs/queue";
import type { JobHandler } from "@/lib/jobs/handlers";
import { sendEmail } from "@/lib/email/send";
import { getTemplateOrSystem, type SystemTemplateKey } from "@/lib/email/system-templates";
import { buildMergeContext } from "@/lib/email/context";

// Automatic emails for event registrations and meetings, driven by
// `events.notifications` (see EventNotifications in src/lib/types.ts).
// Jobs use dedupe keys "evt-notif:<attendeeId>:<kind>…" so they can be cancelled/re-planned.

type NotifKind = "confirmation" | "waitlisted" | "reminder" | "follow_up" | "cancellation" | "host";

const keyFor = (event: Event, kind: NotifKind, audience?: string): SystemTemplateKey => {
  const meeting = event.kind === "meeting";
  switch (kind) {
    case "confirmation":
      return meeting ? "meeting_confirmation" : "event_confirmation";
    case "waitlisted":
      return "event_waitlisted";
    case "reminder":
      return meeting ? "meeting_reminder" : "event_reminder";
    case "cancellation":
      return meeting ? "meeting_cancellation" : "event_cancellation";
    case "host":
      return "host_new_registration";
    case "follow_up":
      if (meeting) return "meeting_follow_up";
      return audience === "no_show" ? "event_follow_up_no_show" : "event_follow_up_attended";
  }
};

async function load(attendeeId: string) {
  const [row] = await db
    .select({ attendee: eventAttendees, event: events })
    .from(eventAttendees)
    .innerJoin(events, eq(events.id, eventAttendees.eventId))
    .where(eq(eventAttendees.id, attendeeId));
  return row ?? null;
}

/**
 * Call after an attendee is created or promoted from the waitlist.
 * Queues the confirmation (unless `sendConfirmation: false`), reminders and follow-ups.
 */
export async function scheduleAttendeeNotifications(
  attendeeId: string,
  opts: { sendConfirmation?: boolean } = {},
) {
  const row = await load(attendeeId);
  if (!row) return;
  const { attendee, event } = row;
  if (attendee.status === "cancelled" || event.status === "cancelled") return;
  const n = event.notifications;
  const now = Date.now();
  const startKey = event.startsAt.getTime();

  if (attendee.status === "waitlisted") {
    if (opts.sendConfirmation !== false && n.confirmation.enabled) {
      await enqueueJob("event.notification", { attendeeId, kind: "waitlisted" }, { dedupeKey: `evt-notif:${attendeeId}:waitlisted` });
    }
    return;
  }

  if (opts.sendConfirmation !== false && n.confirmation.enabled) {
    await enqueueJob(
      "event.notification",
      { attendeeId, kind: "confirmation", templateId: n.confirmation.templateId ?? null },
      { dedupeKey: `evt-notif:${attendeeId}:confirmation:${startKey}` },
    );
  }

  for (const r of n.reminders ?? []) {
    const runAt = startKey - r.minutesBefore * 60_000;
    if (runAt <= now + 60_000) continue; // already past (iClosed skips these too)
    await enqueueJob(
      "event.notification",
      { attendeeId, kind: "reminder", reminderId: r.id, startsAt: startKey },
      { runAt: new Date(runAt), dedupeKey: `evt-notif:${attendeeId}:reminder:${r.id}:${startKey}` },
    );
  }

  for (const f of n.followUps ?? []) {
    const runAt = event.endsAt.getTime() + f.minutesAfter * 60_000;
    if (runAt <= now) continue;
    await enqueueJob(
      "event.notification",
      { attendeeId, kind: "follow_up", followUpId: f.id, startsAt: startKey },
      { runAt: new Date(runAt), dedupeKey: `evt-notif:${attendeeId}:follow_up:${f.id}:${startKey}` },
    );
  }
}

/** Cancel all pending reminders/follow-ups for an attendee. */
export async function cancelAttendeeNotifications(attendeeId: string) {
  await cancelJobsByPrefix(`evt-notif:${attendeeId}:reminder:`);
  await cancelJobsByPrefix(`evt-notif:${attendeeId}:follow_up:`);
}

/** Call after an attendee cancels / is cancelled: cancels reminders and sends the cancellation email. */
export async function onAttendeeCancelled(attendeeId: string, opts: { notify?: boolean } = {}) {
  await cancelAttendeeNotifications(attendeeId);
  const row = await load(attendeeId);
  if (!row) return;
  if (opts.notify !== false && row.event.notifications.cancellation.enabled) {
    await enqueueJob(
      "event.notification",
      { attendeeId, kind: "cancellation", templateId: row.event.notifications.cancellation.templateId ?? null },
      { dedupeKey: `evt-notif:${attendeeId}:cancellation:${Date.now()}` },
    );
  }
}

/** Call after an event's time or notification settings change: re-plans reminders & follow-ups for everyone. */
export async function replanEventNotifications(eventId: string) {
  const attendees = await db
    .select({ id: eventAttendees.id })
    .from(eventAttendees)
    .where(and(eq(eventAttendees.eventId, eventId), ne(eventAttendees.status, "cancelled")));
  for (const a of attendees) {
    await cancelAttendeeNotifications(a.id);
    await scheduleAttendeeNotifications(a.id, { sendConfirmation: false });
  }
}

/** Call when a whole event is cancelled: cancels reminders and emails every active attendee. */
export async function onEventCancelled(eventId: string, opts: { notify?: boolean } = {}) {
  const attendees = await db
    .select({ id: eventAttendees.id })
    .from(eventAttendees)
    .where(and(eq(eventAttendees.eventId, eventId), ne(eventAttendees.status, "cancelled")));
  for (const a of attendees) await onAttendeeCancelled(a.id, opts);
}

/** Queue the "new registration" email to the event host (if enabled). */
export async function notifyHostOfRegistration(attendeeId: string) {
  const row = await load(attendeeId);
  if (!row || !row.event.notifications.notifyHost || !row.event.hostId) return;
  await enqueueJob("event.notification", { attendeeId, kind: "host" }, { dedupeKey: `evt-notif:${attendeeId}:host` });
}

function followUpMatches(audience: "attended" | "no_show" | "all", attendee: EventAttendee) {
  if (audience === "all") return attendee.status !== "cancelled";
  return attendee.status === audience;
}

export const eventJobHandlers: Record<string, JobHandler> = {
  "event.notification": async (payload) => {
    const attendeeId = String(payload.attendeeId);
    const kind = payload.kind as NotifKind;
    const row = await load(attendeeId);
    if (!row) return;
    const { attendee, event } = row;
    const n = event.notifications;

    if (kind !== "cancellation") {
      if (attendee.status === "cancelled" || event.status === "cancelled" || event.status === "draft") return;
    }

    let templateId: string | null | undefined = (payload.templateId as string | null | undefined) ?? null;
    let audience: string | undefined;
    if (kind === "reminder" || kind === "follow_up") {
      // Skip if the event moved since this job was planned (replan creates new jobs).
      if (payload.startsAt && Number(payload.startsAt) !== event.startsAt.getTime()) return;
      if (attendee.status === "waitlisted") return;
    }
    if (kind === "reminder") {
      const r = n.reminders.find((x) => x.id === payload.reminderId);
      if (!r) return;
      templateId = r.templateId ?? null;
      if (event.startsAt.getTime() < Date.now()) return;
    }
    if (kind === "follow_up") {
      const f = n.followUps.find((x) => x.id === payload.followUpId);
      if (!f || !followUpMatches(f.audience, attendee)) return;
      templateId = f.templateId ?? null;
      audience = f.audience;
    }

    const template = await getTemplateOrSystem(templateId, keyFor(event, kind, audience));

    if (kind === "host") {
      const [host] = event.hostId ? await db.select().from(users).where(eq(users.id, event.hostId)) : [];
      if (!host) return;
      const { ctx } = await buildMergeContext({ attendeeId });
      await sendEmail({
        to: host.email,
        toName: host.name,
        subject: template.subject,
        html: template.contentHtml,
        kind: "notification",
        marketing: false,
        context: ctx,
        eventId: event.id,
        templateId: template.id,
        track: false,
        silent: true,
      });
      return;
    }

    const res = await sendEmail({
      contactId: attendee.contactId,
      attendeeId,
      eventId: event.id,
      subject: template.subject,
      html: template.contentHtml,
      preheader: template.preheader,
      kind: "notification",
      marketing: kind === "follow_up",
      templateId: template.id,
    });
    if (res.status === "failed") throw new Error(res.error);
  },
};
