import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, eventAttendees, events, users, type Contact, type Event, type EventAttendee } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings";
import { fullName } from "@/lib/format";
import { googleCalendarLink } from "@/lib/ics";
import {
  absoluteUrl,
  attendeeCancelPath,
  attendeeIcsPath,
  attendeeManagePath,
  attendeeRsvpPath,
  unsubscribePath,
} from "@/lib/urls";
import type { MergeContext } from "./merge-tags";

export function formatEventDate(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: tz }).format(d);
}

export function formatEventTime(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", timeZone: tz, timeZoneName: "short" }).format(d);
}

export function eventLocationText(e: Pick<Event, "locationType" | "location" | "meetingUrl">) {
  if (e.locationType === "in_person") return e.location || "In person";
  if (e.locationType === "phone") return e.location ? `Phone call (${e.location})` : "Phone call";
  return e.location || "Online";
}

export type MergeSources = {
  contact: Contact | null;
  event: Event | null;
  attendee: EventAttendee | null;
};

/** Load everything a merge context needs. Pass the ids you have. */
export async function buildMergeContext(opts: {
  contactId?: string | null;
  contact?: Contact | null;
  eventId?: string | null;
  attendeeId?: string | null;
  extra?: Record<string, unknown>;
}): Promise<{ ctx: MergeContext } & MergeSources> {
  const workspace = await getSetting("workspace");
  let attendee: EventAttendee | null = null;
  if (opts.attendeeId) {
    [attendee] = await db.select().from(eventAttendees).where(eq(eventAttendees.id, opts.attendeeId));
    attendee ??= null;
  }
  const eventId = opts.eventId ?? attendee?.eventId ?? null;
  let event: Event | null = null;
  if (eventId) {
    [event] = await db.select().from(events).where(eq(events.id, eventId));
    event ??= null;
  }
  let contact: Contact | null = opts.contact ?? null;
  const contactId = opts.contactId ?? attendee?.contactId ?? null;
  if (!contact && contactId) {
    [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
    contact ??= null;
  }

  const ctx: MergeContext = {
    workspace: { name: workspace.name, address: workspace.address },
  };

  if (contact) {
    const custom: Record<string, string> = {};
    for (const [k, v] of Object.entries(contact.customFields ?? {})) custom[k] = Array.isArray(v) ? v.join(", ") : String(v ?? "");
    ctx.contact = {
      first_name: contact.firstName,
      last_name: contact.lastName,
      full_name: fullName(contact),
      email: contact.email,
      company: contact.company,
      job_title: contact.jobTitle,
      phone: contact.phone,
    };
    (ctx.contact as Record<string, unknown>).custom = custom;
    ctx.unsubscribe_url = absoluteUrl(unsubscribePath(contact.unsubscribeToken));
  }

  if (event) {
    const tz = event.timezone || workspace.timezone;
    let hostName: string | null = null;
    if (event.hostId) {
      const [host] = await db.select({ name: users.name }).from(users).where(eq(users.id, event.hostId));
      hostName = host?.name ?? null;
    }
    ctx.event = {
      title: event.title,
      date: formatEventDate(event.startsAt, tz),
      time: formatEventTime(event.startsAt, tz),
      end_time: formatEventTime(event.endsAt, tz),
      location: eventLocationText(event),
      join_url: event.meetingUrl,
      host_name: hostName ?? workspace.name,
      description: event.description,
    };
  }

  if (attendee && event) {
    ctx.attendee = {
      manage_url: absoluteUrl(attendeeManagePath(attendee.manageToken)),
      cancel_url: absoluteUrl(attendeeCancelPath(attendee.manageToken)),
      rsvp_yes_url: absoluteUrl(attendeeRsvpPath(attendee.manageToken, "yes")),
      rsvp_no_url: absoluteUrl(attendeeRsvpPath(attendee.manageToken, "no")),
      rsvp_maybe_url: absoluteUrl(attendeeRsvpPath(attendee.manageToken, "maybe")),
      calendar_url: absoluteUrl(attendeeIcsPath(attendee.manageToken)),
      google_calendar_url: googleCalendarLink({
        title: event.title,
        description: [event.description, event.meetingUrl].filter(Boolean).join("\n\n"),
        location: event.meetingUrl || eventLocationText(event),
        start: event.startsAt,
        end: event.endsAt,
      }),
      status: attendee.status,
    };
    const answers: Record<string, string> = {};
    for (const [k, v] of Object.entries(attendee.answers ?? {})) answers[k] = Array.isArray(v) ? v.join(", ") : String(v ?? "");
    ctx.answers = answers;
  }

  Object.assign(ctx, opts.extra ?? {});
  return { ctx, contact, event, attendee };
}
