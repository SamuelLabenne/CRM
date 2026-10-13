import { and, asc, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, customFieldDefs, emailTemplates, users, type Event } from "@/lib/db/schema";
import { formatInTz } from "@/lib/format";
import { absoluteUrl, eventPublicPath } from "@/lib/urls";
import type { EventFormValues } from "@/components/events/event-form";
import { DEFAULT_EVENT_NOTIFICATIONS } from "@/lib/types";

/** Lookups every event form needs (campaign/host/template pickers + custom contact fields). */
export async function loadEventFormData() {
  const [campaignRows, userRows, templateRows, fieldRows] = await Promise.all([
    db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns).orderBy(asc(campaigns.name)),
    db.select({ id: users.id, name: users.name }).from(users).where(and(isNull(users.deactivatedAt))).orderBy(asc(users.name)),
    db.select({ id: emailTemplates.id, name: emailTemplates.name }).from(emailTemplates).orderBy(asc(emailTemplates.name)),
    db.select({ key: customFieldDefs.key, label: customFieldDefs.label }).from(customFieldDefs).orderBy(asc(customFieldDefs.position)),
  ]);
  return {
    campaigns: campaignRows,
    users: userRows,
    templates: templateRows,
    customFields: fieldRows,
    publicBase: absoluteUrl(eventPublicPath("")),
  };
}

/** Default form values for a new event: tomorrow 10:00–11:00 in `tz`, registration page on. */
export function newEventValues(opts: { tz: string; hostId: string; campaignId?: string; now?: Date }): EventFormValues {
  const base = new Date((opts.now ?? new Date()).getTime() + 24 * 3600_000);
  const date = formatInTz(base, opts.tz, "yyyy-MM-dd");
  return {
    title: "",
    type: "webinar",
    description: "",
    timezone: opts.tz,
    startDate: date,
    startTime: "10:00",
    endDate: date,
    endTime: "11:00",
    locationType: "online",
    location: "",
    meetingUrl: "",
    capacity: "",
    waitlistEnabled: false,
    campaignId: opts.campaignId ?? "",
    hostId: opts.hostId,
    color: "#6366f1",
    status: "draft",
    isPublic: true,
    slug: "",
    registrationOpen: true,
    coverImageUrl: "",
    registrationQuestions: [],
    notifications: structuredClone(DEFAULT_EVENT_NOTIFICATIONS),
  };
}

export function eventToFormValues(event: Event, workspaceTz: string): EventFormValues {
  const tz = event.timezone || workspaceTz;
  return {
    title: event.title,
    type: event.type === "meeting" ? "other" : event.type,
    description: event.description ?? "",
    timezone: tz,
    startDate: formatInTz(event.startsAt, tz, "yyyy-MM-dd"),
    startTime: formatInTz(event.startsAt, tz, "HH:mm"),
    endDate: formatInTz(event.endsAt, tz, "yyyy-MM-dd"),
    endTime: formatInTz(event.endsAt, tz, "HH:mm"),
    locationType: event.locationType,
    location: event.location ?? "",
    meetingUrl: event.meetingUrl ?? "",
    capacity: event.capacity == null ? "" : String(event.capacity),
    waitlistEnabled: event.waitlistEnabled,
    campaignId: event.campaignId ?? "",
    hostId: event.hostId ?? "",
    color: event.color ?? "#6366f1",
    status: event.status === "scheduled" ? "scheduled" : "draft",
    isPublic: event.isPublic,
    slug: event.slug ?? "",
    registrationOpen: event.registrationOpen,
    coverImageUrl: event.coverImageUrl ?? "",
    registrationQuestions: event.registrationQuestions,
    notifications: event.notifications,
  };
}
