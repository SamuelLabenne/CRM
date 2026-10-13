import { and, eq, inArray, ne } from "drizzle-orm";
import { TZDate } from "@date-fns/tz";
import Papa from "papaparse";
import { z } from "zod";
import { db } from "@/lib/db";
import { eventAttendees, events, type Event, type EventAttendee } from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { splitName, upsertContact } from "@/lib/contacts";
import { formatInTz, slugify } from "@/lib/format";
import { cancelJobsByPrefix } from "@/lib/jobs/queue";
import { cancelRegistration, markAttendance, promoteFromWaitlist, registerForEvent } from "./registration";
import { cancelAttendeeNotifications, onEventCancelled, replanEventNotifications } from "./notifications";
import { listAttendees } from "./queries";
import type { EventNotifications, EventStatus, FormQuestion } from "@/lib/types";
import { DEFAULT_EVENT_NOTIFICATIONS } from "@/lib/types";

// Staff-side event management: create/update/duplicate/delete/cancel events and
// attendee operations. Server actions in src/app/(app)/events/actions.ts wrap these.

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #6366f1");
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const timeStr = z.string().regex(/^\d{2}:\d{2}$/, "Pick a time");
const optionalUuid = z.union([z.uuid(), z.literal("")]).nullish();
const optionalUrl = z.union([z.url({ message: "Enter a full URL, e.g. https://…" }), z.literal("")]).nullish();

function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const questionSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().trim().min(1, "Every question needs a label").max(200),
  type: z.enum(["text", "textarea", "select", "multiselect", "number", "date", "url", "checkbox"]),
  required: z.boolean(),
  options: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  placeholder: z.string().max(200).optional(),
  mapTo: z.string().max(80).nullish(),
});

const questionsSchema = z.array(questionSchema).max(30, "Use at most 30 questions").superRefine((qs, ctx) => {
  qs.forEach((q, i) => {
    if ((q.type === "select" || q.type === "multiselect") && !(q.options ?? []).length) {
      ctx.addIssue({ code: "custom", path: [i, "options"], message: `Add at least one option to “${q.label}”` });
    }
  });
});

const templateId = z.union([z.uuid(), z.null()]).optional();

export const notificationsSchema = z.object({
  confirmation: z.object({ enabled: z.boolean(), templateId }),
  cancellation: z.object({ enabled: z.boolean(), templateId }),
  reminders: z
    .array(z.object({ id: z.string().min(1).max(40), minutesBefore: z.number().int().min(1, "Reminder time must be at least 1 minute").max(525_600), templateId }))
    .max(10, "Use at most 10 reminders"),
  followUps: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        minutesAfter: z.number().int().min(0).max(525_600),
        audience: z.enum(["attended", "no_show", "all"]),
        templateId,
      }),
    )
    .max(10, "Use at most 10 follow-ups"),
  notifyHost: z.boolean(),
});

const detailsShape = {
  title: z.string().trim().min(1, "Give your event a title").max(160, "Keep the title under 160 characters"),
  type: z.enum(["webinar", "workshop", "meetup", "conference", "class", "call", "other"]),
  description: z.string().max(10_000).optional().default(""),
  timezone: z.string().refine(isValidTimezone, "Unknown timezone"),
  startDate: dateStr,
  startTime: timeStr,
  endDate: dateStr,
  endTime: timeStr,
  locationType: z.enum(["online", "in_person", "phone"]),
  location: z.string().trim().max(300).optional().default(""),
  meetingUrl: optionalUrl,
  capacity: z.number().int("Capacity must be a whole number").min(1, "Capacity must be at least 1").max(1_000_000).nullable(),
  waitlistEnabled: z.boolean(),
  campaignId: optionalUuid,
  hostId: optionalUuid,
  color: hexColor.nullish(),
  /** Only draft/scheduled can be set here; cancel/complete are separate actions. */
  status: z.enum(["draft", "scheduled"]).optional(),
};

const registrationShape = {
  isPublic: z.boolean(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(80)
    .regex(/^$|^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and dashes only")
    .optional()
    .default(""),
  registrationOpen: z.boolean(),
  coverImageUrl: optionalUrl,
  registrationQuestions: questionsSchema,
};

export const detailsSchema = z.object(detailsShape);
export const registrationSchema = z.object(registrationShape);
export const fullEventSchema = z.object({ ...detailsShape, ...registrationShape, notifications: notificationsSchema });

export type EventSection = "all" | "details" | "registration" | "notifications";
export type EventFormInput = z.input<typeof fullEventSchema>;

/** Convert wall-clock "yyyy-MM-dd" + "HH:mm" in `tz` to a UTC Date. */
export function zonedToDate(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(new TZDate(y, m - 1, d, hh, mm, 0, 0, tz).getTime());
}

export type SaveEventResult =
  | { ok: true; event: Event }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

const bad = (error: string, fieldErrors?: Record<string, string[]>): SaveEventResult => ({ ok: false, error, fieldErrors });

function zodResult(err: z.ZodError): SaveEventResult {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of err.issues) (fieldErrors[issue.path.join(".") || "_"] ??= []).push(issue.message);
  const first = err.issues[0];
  return bad(first?.message ?? "Invalid input", fieldErrors);
}

/** A slug nobody else uses (appends -2, -3… when taken). */
export async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  const root = slugify(base) || "event";
  for (let i = 1; i < 100; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    const [hit] = await db.select({ id: events.id }).from(events).where(eq(events.slug, candidate)).limit(1);
    if (!hit || hit.id === excludeId) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

async function slugTaken(slug: string, excludeId?: string) {
  const [hit] = await db.select({ id: events.id }).from(events).where(eq(events.slug, slug)).limit(1);
  return !!hit && hit.id !== excludeId;
}

const emptyToNull = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/**
 * Create an event (section "all") or update one section of an existing event.
 * Re-plans reminders when times or notification settings change.
 */
export async function saveEvent(args: {
  id?: string | null;
  section: EventSection;
  values: unknown;
  actorId: string;
}): Promise<SaveEventResult> {
  const { id, section, values, actorId } = args;

  if (!id) {
    const parsed = fullEventSchema.safeParse(values);
    if (!parsed.success) return zodResult(parsed.error);
    const v = parsed.data;
    const startsAt = zonedToDate(v.startDate, v.startTime, v.timezone);
    const endsAt = zonedToDate(v.endDate, v.endTime, v.timezone);
    if (endsAt <= startsAt) return bad("The end must be after the start", { endTime: ["The end must be after the start"] });
    let slug: string | null = v.slug || null;
    if (slug && (await slugTaken(slug))) return bad("This registration link is already taken", { slug: ["This link is already taken"] });
    if (!slug && v.isPublic) slug = await uniqueSlug(v.title);
    const [event] = await db
      .insert(events)
      .values({
        kind: "event",
        title: v.title,
        type: v.type,
        description: emptyToNull(v.description),
        timezone: v.timezone,
        startsAt,
        endsAt,
        locationType: v.locationType,
        location: emptyToNull(v.location),
        meetingUrl: emptyToNull(v.meetingUrl),
        capacity: v.capacity,
        waitlistEnabled: v.waitlistEnabled,
        campaignId: emptyToNull(v.campaignId),
        hostId: emptyToNull(v.hostId) ?? actorId,
        color: v.color ?? null,
        status: v.status ?? "draft",
        isPublic: v.isPublic,
        slug,
        registrationOpen: v.registrationOpen,
        coverImageUrl: emptyToNull(v.coverImageUrl),
        registrationQuestions: v.registrationQuestions as FormQuestion[],
        notifications: v.notifications as EventNotifications,
        createdById: actorId,
      })
      .returning();
    return { ok: true, event };
  }

  const [existing] = await db.select().from(events).where(eq(events.id, id));
  if (!existing) return bad("Event not found");
  const patch: Partial<typeof events.$inferInsert> = {};
  let replan = false;

  if (section === "details" || section === "all") {
    const parsed = detailsSchema.safeParse(values);
    if (!parsed.success) return zodResult(parsed.error);
    const v = parsed.data;
    const startsAt = zonedToDate(v.startDate, v.startTime, v.timezone);
    const endsAt = zonedToDate(v.endDate, v.endTime, v.timezone);
    if (endsAt <= startsAt) return bad("The end must be after the start", { endTime: ["The end must be after the start"] });
    Object.assign(patch, {
      title: v.title,
      type: v.type,
      description: emptyToNull(v.description),
      timezone: v.timezone,
      startsAt,
      endsAt,
      locationType: v.locationType,
      location: emptyToNull(v.location),
      meetingUrl: emptyToNull(v.meetingUrl),
      capacity: v.capacity,
      waitlistEnabled: v.waitlistEnabled,
      campaignId: emptyToNull(v.campaignId),
      hostId: emptyToNull(v.hostId),
      color: v.color ?? null,
    });
    if (v.status && (existing.status === "draft" || existing.status === "scheduled")) patch.status = v.status;
    if (startsAt.getTime() !== existing.startsAt.getTime() || endsAt.getTime() !== existing.endsAt.getTime()) replan = true;
  }

  if (section === "registration" || section === "all") {
    const parsed = registrationSchema.safeParse(values);
    if (!parsed.success) return zodResult(parsed.error);
    const v = parsed.data;
    let slug: string | null = v.slug || existing.slug;
    if (v.slug && v.slug !== existing.slug && (await slugTaken(v.slug, existing.id))) {
      return bad("This registration link is already taken", { slug: ["This link is already taken"] });
    }
    if (!slug && v.isPublic) slug = await uniqueSlug(String(patch.title ?? existing.title), existing.id);
    Object.assign(patch, {
      isPublic: v.isPublic,
      slug,
      registrationOpen: v.registrationOpen,
      coverImageUrl: emptyToNull(v.coverImageUrl),
      registrationQuestions: v.registrationQuestions as FormQuestion[],
    });
  }

  if (section === "notifications" || section === "all") {
    const parsed = z.object({ notifications: notificationsSchema }).safeParse(values);
    if (!parsed.success) return zodResult(parsed.error);
    const next = parsed.data.notifications as EventNotifications;
    if (JSON.stringify(next) !== JSON.stringify(existing.notifications)) replan = true;
    patch.notifications = next;
  }

  const [event] = await db.update(events).set(patch).where(eq(events.id, id)).returning();
  if (replan) await replanEventNotifications(id);
  return { ok: true, event };
}

export function defaultNotifications(): EventNotifications {
  return structuredClone(DEFAULT_EVENT_NOTIFICATIONS);
}

/** Copy an event as a new draft (no attendees). */
export async function duplicateEvent(id: string, actorId: string) {
  const [src] = await db.select().from(events).where(eq(events.id, id));
  if (!src) return null;
  const slug = src.slug ? await uniqueSlug(`${src.slug}-copy`) : null;
  const [copy] = await db
    .insert(events)
    .values({
      kind: "event",
      campaignId: src.campaignId,
      title: `Copy of ${src.title}`,
      slug,
      description: src.description,
      type: src.type,
      locationType: src.locationType,
      location: src.location,
      meetingUrl: src.meetingUrl,
      startsAt: src.startsAt,
      endsAt: src.endsAt,
      timezone: src.timezone,
      capacity: src.capacity,
      waitlistEnabled: src.waitlistEnabled,
      status: "draft",
      isPublic: src.isPublic,
      registrationOpen: src.registrationOpen,
      registrationQuestions: src.registrationQuestions,
      notifications: src.notifications,
      coverImageUrl: src.coverImageUrl,
      color: src.color,
      hostId: src.hostId,
      createdById: actorId,
    })
    .returning();
  return copy;
}

/** Change an event's status; cancelling emails attendees (unless `notify` is false), re-opening re-plans reminders. */
export async function setEventStatus(id: string, status: EventStatus, opts: { notify?: boolean } = {}) {
  const [existing] = await db.select().from(events).where(eq(events.id, id));
  if (!existing) return null;
  if (existing.status === status) return existing;
  const [event] = await db.update(events).set({ status }).where(eq(events.id, id)).returning();
  if (status === "cancelled") await onEventCancelled(id, { notify: opts.notify });
  else if (existing.status === "cancelled" && status === "scheduled") await replanEventNotifications(id);
  return event;
}

export async function deleteEvent(id: string) {
  const attendees = await db.select({ id: eventAttendees.id }).from(eventAttendees).where(eq(eventAttendees.eventId, id));
  for (const a of attendees) await cancelJobsByPrefix(`evt-notif:${a.id}:`);
  const removed = await db.delete(events).where(eq(events.id, id)).returning({ id: events.id });
  return removed.length > 0;
}

// ---------------------------------------------------------------------------
// Attendees
// ---------------------------------------------------------------------------

const newContactSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(160),
  email: z.union([z.email("Enter a valid email address"), z.literal("")]).optional(),
  phone: z.string().trim().max(40).optional(),
});

/** Staff adds somebody to an event (existing contact or a brand-new one). Staff may exceed capacity. */
export async function addAttendee(args: {
  eventId: string;
  contactId?: string | null;
  newContact?: z.input<typeof newContactSchema> | null;
  markAttended?: boolean;
  silent?: boolean;
  actorId: string;
}): Promise<{ ok: true; attendee: EventAttendee; created: boolean } | { ok: false; error: string }> {
  let contactId = args.contactId ?? null;
  if (!contactId) {
    const parsed = newContactSchema.safeParse(args.newContact ?? {});
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid contact" };
    const { firstName, lastName } = splitName(parsed.data.name);
    const { contact } = await upsertContact(
      { firstName, lastName, email: parsed.data.email || null, phone: parsed.data.phone || null },
      { source: "manual", actorId: args.actorId },
    );
    contactId = contact.id;
  }
  const [event] = await db.select({ id: events.id }).from(events).where(eq(events.id, args.eventId));
  if (!event) return { ok: false, error: "Event not found" };
  const res = await registerForEvent({
    eventId: args.eventId,
    contactId,
    source: "manual",
    actorId: args.actorId,
    ignoreCapacity: true,
    silent: args.silent,
  });
  let attendee = res.attendee;
  if (args.markAttended && attendee.status !== "attended") {
    attendee = (await markAttendance(attendee.id, "attended", { actorId: args.actorId })) ?? attendee;
  }
  return { ok: true, attendee, created: res.created };
}

/** Check-in mode walk-in: upsert the contact, register (no confirmation email) and mark attended. */
export async function walkIn(args: { eventId: string; name: string; email?: string; actorId: string }) {
  return addAttendee({
    eventId: args.eventId,
    newContact: { name: args.name, email: args.email ?? "" },
    markAttended: true,
    silent: true,
    actorId: args.actorId,
  });
}

/** Remove an attendee row entirely (frees the seat and promotes the waitlist). */
export async function removeAttendee(attendeeId: string, actorId: string) {
  const [row] = await db
    .select({ attendee: eventAttendees, event: events })
    .from(eventAttendees)
    .innerJoin(events, eq(events.id, eventAttendees.eventId))
    .where(eq(eventAttendees.id, attendeeId));
  if (!row) return false;
  await cancelAttendeeNotifications(attendeeId);
  await db.delete(eventAttendees).where(eq(eventAttendees.id, attendeeId));
  await logActivity({
    contactId: row.attendee.contactId,
    type: "event_cancelled",
    title: `Removed from “${row.event.title}”`,
    actorId,
    eventId: row.event.id,
  });
  await promoteFromWaitlist(row.event);
  return true;
}

export async function cancelAttendeeAsStaff(attendeeId: string, actorId: string, opts: { reason?: string | null; notify?: boolean } = {}) {
  return cancelRegistration(attendeeId, { by: "staff", actorId, reason: opts.reason ?? null, notify: opts.notify });
}

export async function bulkMarkAttendance(ids: string[], status: "attended" | "no_show" | "registered", actorId: string) {
  let changed = 0;
  for (const id of ids) {
    const before = await db.select({ status: eventAttendees.status }).from(eventAttendees).where(eq(eventAttendees.id, id));
    if (!before.length || before[0].status === "cancelled" || before[0].status === "waitlisted") continue;
    await markAttendance(id, status, { actorId });
    changed++;
  }
  return changed;
}

/** Mark every registered/confirmed person of an event as no-show (used after the event ended). */
export async function markRemainingNoShow(eventId: string, actorId: string) {
  const rows = await db
    .select({ id: eventAttendees.id })
    .from(eventAttendees)
    .where(and(eq(eventAttendees.eventId, eventId), inArray(eventAttendees.status, ["registered", "confirmed"])));
  return bulkMarkAttendance(rows.map((r) => r.id), "no_show", actorId);
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

const csvSafe = (v: unknown) => {
  const s = v == null ? "" : Array.isArray(v) ? v.join("; ") : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

/** All non-removed attendees of an event as CSV (answers included, one column per question). */
export async function attendeesCsv(eventId: string, tz: string) {
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  if (!event) return null;
  const { rows } = await listAttendees(eventId, { all: true });
  const questions = event.registrationQuestions;
  const header = ["First name", "Last name", "Email", "Phone", "Company", "Status", "RSVP", "Source", "Registered at", "Checked in at", ...questions.map((q) => q.label)];
  const data = rows.map((r) => [
    r.firstName,
    r.lastName,
    r.email,
    r.phone,
    r.company,
    r.status,
    r.rsvp,
    r.source,
    formatInTz(r.registeredAt, tz, "yyyy-MM-dd HH:mm"),
    r.checkedInAt ? formatInTz(r.checkedInAt, tz, "yyyy-MM-dd HH:mm") : "",
    ...questions.map((q) => r.answers[q.id]),
  ].map(csvSafe));
  return { csv: Papa.unparse({ fields: header, data }), event };
}

/** Everyone currently on a given event with a non-cancelled status (used by tests & callouts). */
export async function activeAttendeeCount(eventId: string) {
  const rows = await db
    .select({ id: eventAttendees.id })
    .from(eventAttendees)
    .where(and(eq(eventAttendees.eventId, eventId), ne(eventAttendees.status, "cancelled")));
  return rows.length;
}
