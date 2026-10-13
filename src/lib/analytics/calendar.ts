import { and, asc, eq, gt, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { TZDate } from "@date-fns/tz";
import { addDays } from "date-fns";
import { db } from "@/lib/db";
import {
  broadcasts,
  campaigns,
  contacts,
  eventAttendees,
  events,
  tasks,
  users,
  type Event,
} from "@/lib/db/schema";
import { formatInTz, fullName } from "@/lib/format";
import { replanEventNotifications } from "@/lib/events/notifications";
import { getSetting } from "@/lib/settings";
import { DEFAULT_EVENT_NOTIFICATIONS, type EventType } from "@/lib/types";
import { num } from "./metrics";
import { safeTimezone } from "./range";

// ---------------------------------------------------------------------------
// Types shared with the calendar UI (JSON-serialisable)
// ---------------------------------------------------------------------------

export type CalendarKind = "event" | "meeting" | "campaign" | "broadcast" | "task";

export type CalendarEventProps = {
  kind: CalendarKind;
  entityId: string;
  /** Primary in-app link for the entity. */
  href: string;
  title: string;
  status: string | null;
  eventType: string | null;
  locationType: string | null;
  location: string | null;
  meetingUrl: string | null;
  /** ISO (UTC) instants; campaigns use plain dates. */
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  campaign: { id: string; name: string; color: string } | null;
  host: { id: string; name: string; color: string } | null;
  counts: { registered: number; attended: number; noShow: number; waitlisted: number; capacity: number | null } | null;
  contact: { id: string | null; name: string } | null;
  outcome: string | null;
  isPast: boolean;
  /** Campaign extras */
  campaignInfo: { type: string; events: number; registrations: number; startDate: string | null; endDate: string | null } | null;
  /** Broadcast extras */
  broadcastInfo: { subject: string; recipientCount: number } | null;
  /** Task extras */
  taskInfo: { priority: string; contactId: string | null } | null;
};

/** FullCalendar EventInput subset. */
export type CalendarEventInput = {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  color?: string;
  contrastColor?: string;
  className?: string;
  editable?: boolean;
  extendedProps: CalendarEventProps;
};

export type CalendarFilters = {
  start: Date;
  end: Date;
  /** Show group events / meetings / campaigns / broadcasts / tasks. */
  events: boolean;
  meetings: boolean;
  campaigns: boolean;
  broadcasts: boolean;
  tasks: boolean;
  /** Include cancelled events & meetings. */
  cancelled: boolean;
  /** Event types to show (empty = all). */
  types: EventType[];
  campaignId: string | null;
  /** Only things hosted/owned/assigned to this user. */
  mineUserId: string | null;
};

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

export const MEETING_COLOR = "#0284c7";
export const BROADCAST_COLOR = "#7c3aed";
export const TASK_COLOR = "#d97706";

/** Readable text color (white or near-black) for a hex background; falls back to the primary foreground. */
export function contrastFor(color: string | null | undefined): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color ?? "");
  if (!m) return "#ffffff";
  let hex = m[1];
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // White text needs ~3:1 contrast against the background (event labels are bold); otherwise use near-black.
  return 1.05 / (lum + 0.05) >= 3.2 ? "#ffffff" : "#111827";
}

const tint = (hex: string, pct: number) => `color-mix(in oklab, ${hex} ${pct}%, var(--background))`;
const ink = (hex: string, pct: number) => `color-mix(in oklab, ${hex} ${pct}%, var(--foreground))`;

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

const MAX_ROWS = 1000;

export async function getCalendarEvents(f: CalendarFilters, now: Date = new Date()): Promise<CalendarEventInput[]> {
  const ws = await getSetting("workspace");
  const tz = safeTimezone(ws.timezone);
  const out: CalendarEventInput[] = [];

  // ---- Group events & meetings -------------------------------------------------------------
  if (f.events || f.meetings) {
    const kinds = [f.events ? "event" : null, f.meetings ? "meeting" : null].filter(Boolean) as ("event" | "meeting")[];
    const rows = await db
      .select({
        event: events,
        campaignName: campaigns.name,
        campaignColor: campaigns.color,
        hostName: users.name,
        hostColor: users.color,
      })
      .from(events)
      .leftJoin(campaigns, eq(campaigns.id, events.campaignId))
      .leftJoin(users, eq(users.id, events.hostId))
      .where(
        and(
          inArray(events.kind, kinds),
          lt(events.startsAt, f.end),
          gt(events.endsAt, f.start),
          f.cancelled ? undefined : ne(events.status, "cancelled"),
          f.types.length ? inArray(events.type, f.types) : undefined,
          f.campaignId ? eq(events.campaignId, f.campaignId) : undefined,
          f.mineUserId ? eq(events.hostId, f.mineUserId) : undefined,
        ),
      )
      .orderBy(asc(events.startsAt))
      .limit(MAX_ROWS);

    const ids = rows.map((r) => r.event.id);
    const countRows = ids.length
      ? await db
          .select({
            eventId: eventAttendees.eventId,
            registered: sql<number>`count(*) filter (where ${eventAttendees.status} in ('registered','confirmed','attended','no_show'))::int`,
            attended: sql<number>`count(*) filter (where ${eventAttendees.status} = 'attended')::int`,
            noShow: sql<number>`count(*) filter (where ${eventAttendees.status} = 'no_show')::int`,
            waitlisted: sql<number>`count(*) filter (where ${eventAttendees.status} = 'waitlisted')::int`,
          })
          .from(eventAttendees)
          .where(inArray(eventAttendees.eventId, ids))
          .groupBy(eventAttendees.eventId)
      : [];
    const counts = new Map(countRows.map((c) => [c.eventId, c]));

    const meetingIds = rows.filter((r) => r.event.kind === "meeting").map((r) => r.event.id);
    const invitees = meetingIds.length
      ? await db
          .select({
            eventId: eventAttendees.eventId,
            outcome: eventAttendees.outcome,
            contactId: contacts.id,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            email: contacts.email,
            phone: contacts.phone,
          })
          .from(eventAttendees)
          .innerJoin(contacts, eq(contacts.id, eventAttendees.contactId))
          .where(and(inArray(eventAttendees.eventId, meetingIds), ne(eventAttendees.status, "cancelled")))
      : [];
    const invitee = new Map(invitees.map((i) => [i.eventId, i]));

    for (const { event, campaignName, campaignColor, hostName, hostColor } of rows) {
      const c = counts.get(event.id);
      const registered = num(c?.registered);
      const isMeeting = event.kind === "meeting";
      const inv = invitee.get(event.id);
      const contactName = inv ? fullName(inv) : null;
      let title = event.title;
      if (isMeeting) {
        if (contactName && !title.includes(contactName)) title = `${title} · ${contactName}`;
      } else if (registered > 0) {
        title = `${title} (${registered})`;
      }
      const color = isMeeting ? (event.color ?? MEETING_COLOR) : (event.color ?? campaignColor ?? null);
      const classes = [
        event.status === "draft" ? "relay-fc-draft" : "",
        event.status === "cancelled" ? "relay-fc-cancelled" : "",
        event.status === "completed" || (event.endsAt < now && event.status === "scheduled") ? "relay-fc-past" : "",
      ]
        .filter(Boolean)
        .join(" ");
      out.push({
        id: `event:${event.id}`,
        title,
        start: event.startsAt.toISOString(),
        end: event.endsAt.toISOString(),
        color: color ?? "var(--primary)",
        contrastColor: color ? contrastFor(color) : "var(--primary-foreground)",
        className: classes || undefined,
        editable: event.status === "draft" || event.status === "scheduled",
        extendedProps: {
          kind: isMeeting ? "meeting" : "event",
          entityId: event.id,
          href: `/events/${event.id}`,
          title: event.title,
          status: event.status,
          eventType: event.type,
          locationType: event.locationType,
          location: event.location,
          meetingUrl: event.meetingUrl,
          startsAt: event.startsAt.toISOString(),
          endsAt: event.endsAt.toISOString(),
          allDay: false,
          campaign: event.campaignId && campaignName ? { id: event.campaignId, name: campaignName, color: campaignColor ?? "#6366f1" } : null,
          host: event.hostId && hostName ? { id: event.hostId, name: hostName, color: hostColor ?? "#6366f1" } : null,
          counts: { registered, attended: num(c?.attended), noShow: num(c?.noShow), waitlisted: num(c?.waitlisted), capacity: event.capacity },
          contact: inv ? { id: inv.contactId, name: contactName ?? "Contact" } : null,
          outcome: inv?.outcome ?? null,
          isPast: event.endsAt < now,
          campaignInfo: null,
          broadcastInfo: null,
          taskInfo: null,
        },
      });
    }
  }

  // ---- Campaigns (all-day spans) -----------------------------------------------------------
  if (f.campaigns) {
    const startDay = formatInTz(f.start, tz, "yyyy-MM-dd");
    const endDay = formatInTz(new Date(f.end.getTime() - 1), tz, "yyyy-MM-dd");
    const rows = await db
      .select()
      .from(campaigns)
      .where(
        and(
          ne(campaigns.status, "archived"),
          sql`${campaigns.startDate} is not null`,
          sql`${campaigns.startDate} <= ${endDay}`,
          sql`coalesce(${campaigns.endDate}, ${campaigns.startDate}) >= ${startDay}`,
          f.campaignId ? eq(campaigns.id, f.campaignId) : undefined,
          f.mineUserId ? eq(campaigns.ownerId, f.mineUserId) : undefined,
        ),
      )
      .orderBy(asc(campaigns.startDate))
      .limit(200);
    const ids = rows.map((c) => c.id);
    const evCounts = ids.length
      ? await db
          .select({
            campaignId: events.campaignId,
            events: sql<number>`count(distinct ${events.id})::int`,
            registrations: sql<number>`count(${eventAttendees.id}) filter (where ${eventAttendees.status} in ('registered','confirmed','attended','no_show'))::int`,
          })
          .from(events)
          .leftJoin(eventAttendees, eq(eventAttendees.eventId, events.id))
          .where(and(inArray(events.campaignId, ids), eq(events.kind, "event"), ne(events.status, "cancelled")))
          .groupBy(events.campaignId)
      : [];
    const evMap = new Map(evCounts.map((c) => [c.campaignId, c]));
    for (const c of rows) {
      const first = c.startDate as string;
      const last = c.endDate && c.endDate >= first ? c.endDate : first;
      const lastExclusive = addDays(new Date(`${last}T00:00:00Z`), 1).toISOString().slice(0, 10);
      const stats = evMap.get(c.id);
      out.push({
        id: `campaign:${c.id}`,
        title: c.name,
        start: first,
        end: lastExclusive,
        allDay: true,
        color: tint(c.color, 24),
        contrastColor: ink(c.color, 70),
        className: "relay-fc-campaign",
        editable: false,
        extendedProps: {
          kind: "campaign",
          entityId: c.id,
          href: `/campaigns/${c.id}`,
          title: c.name,
          status: c.status,
          eventType: null,
          locationType: null,
          location: null,
          meetingUrl: null,
          startsAt: first,
          endsAt: last,
          allDay: true,
          campaign: { id: c.id, name: c.name, color: c.color },
          host: null,
          counts: null,
          contact: null,
          outcome: null,
          isPast: last < startDay,
          campaignInfo: {
            type: c.type,
            events: num(stats?.events),
            registrations: num(stats?.registrations),
            startDate: c.startDate,
            endDate: c.endDate,
          },
          broadcastInfo: null,
          taskInfo: null,
        },
      });
    }
  }

  // ---- Broadcasts (scheduled or sent) ------------------------------------------------------
  if (f.broadcasts) {
    const at = sql<Date>`coalesce(${broadcasts.sentAt}, ${broadcasts.scheduledAt})`;
    const rows = await db
      .select({ b: broadcasts, campaignName: campaigns.name, campaignColor: campaigns.color })
      .from(broadcasts)
      .leftJoin(campaigns, eq(campaigns.id, broadcasts.campaignId))
      .where(
        and(
          inArray(broadcasts.status, ["scheduled", "sending", "sent"]),
          sql`${at} >= ${f.start.toISOString()}::timestamptz`,
          sql`${at} < ${f.end.toISOString()}::timestamptz`,
          f.campaignId ? eq(broadcasts.campaignId, f.campaignId) : undefined,
          f.mineUserId ? eq(broadcasts.createdById, f.mineUserId) : undefined,
        ),
      )
      .limit(300);
    for (const { b, campaignName, campaignColor } of rows) {
      const when = b.sentAt ?? b.scheduledAt;
      if (!when) continue;
      out.push({
        id: `broadcast:${b.id}`,
        title: b.name,
        start: when.toISOString(),
        end: new Date(when.getTime() + 30 * 60_000).toISOString(),
        color: BROADCAST_COLOR,
        contrastColor: "#ffffff",
        className: b.status === "sent" ? "relay-fc-past" : undefined,
        editable: false,
        extendedProps: {
          kind: "broadcast",
          entityId: b.id,
          href: `/emails/broadcasts/${b.id}`,
          title: b.name,
          status: b.status,
          eventType: null,
          locationType: null,
          location: null,
          meetingUrl: null,
          startsAt: when.toISOString(),
          endsAt: null,
          allDay: false,
          campaign: b.campaignId && campaignName ? { id: b.campaignId, name: campaignName, color: campaignColor ?? "#6366f1" } : null,
          host: null,
          counts: null,
          contact: null,
          outcome: null,
          isPast: when < now,
          campaignInfo: null,
          broadcastInfo: { subject: b.subject, recipientCount: b.recipientCount },
          taskInfo: null,
        },
      });
    }
  }

  // ---- Open tasks with a due date ----------------------------------------------------------
  if (f.tasks) {
    const rows = await db
      .select({
        task: tasks,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        phone: contacts.phone,
      })
      .from(tasks)
      .leftJoin(contacts, eq(contacts.id, tasks.contactId))
      .where(
        and(
          isNull(tasks.completedAt),
          gte(tasks.dueAt, f.start),
          lt(tasks.dueAt, f.end),
          f.mineUserId ? eq(tasks.assigneeId, f.mineUserId) : undefined,
        ),
      )
      .orderBy(asc(tasks.dueAt))
      .limit(300);
    for (const { task, ...contact } of rows) {
      if (!task.dueAt) continue;
      out.push({
        id: `task:${task.id}`,
        title: task.title,
        start: task.dueAt.toISOString(),
        end: new Date(task.dueAt.getTime() + 30 * 60_000).toISOString(),
        color: TASK_COLOR,
        contrastColor: "#ffffff",
        editable: false,
        extendedProps: {
          kind: "task",
          entityId: task.id,
          href: task.contactId ? `/contacts/${task.contactId}` : "/tasks",
          title: task.title,
          status: task.dueAt < now ? "overdue" : "open",
          eventType: null,
          locationType: null,
          location: null,
          meetingUrl: null,
          startsAt: task.dueAt.toISOString(),
          endsAt: null,
          allDay: false,
          campaign: null,
          host: null,
          counts: null,
          contact: task.contactId ? { id: task.contactId, name: fullName(contact) } : null,
          outcome: null,
          isPast: task.dueAt < now,
          campaignInfo: null,
          broadcastInfo: null,
          taskInfo: { priority: task.priority, contactId: task.contactId },
        },
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Mutations (called from server actions; auth happens there)
// ---------------------------------------------------------------------------

/** "2026-10-14T09:30" (wall-clock time in `tz`) → UTC Date. Returns null when the string is malformed. */
export function wallTimeToDate(value: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const date = new TZDate(y, mo - 1, d, h, mi, 0, safeTimezone(tz));
  return Number.isNaN(date.getTime()) ? null : new Date(date.getTime());
}

export type QuickCreateInput = {
  title: string;
  type: EventType;
  startsAt: Date;
  endsAt: Date;
  campaignId?: string | null;
  hostId: string;
};

/** Creates a scheduled group event with default notifications, hosted by `hostId`. */
export async function createQuickEvent(input: QuickCreateInput): Promise<Event> {
  const ws = await getSetting("workspace");
  const [event] = await db
    .insert(events)
    .values({
      kind: "event",
      title: input.title,
      type: input.type,
      status: "scheduled",
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timezone: safeTimezone(ws.timezone),
      campaignId: input.campaignId ?? null,
      hostId: input.hostId,
      createdById: input.hostId,
      notifications: DEFAULT_EVENT_NOTIFICATIONS,
    })
    .returning();
  return event;
}

export type MoveResult =
  | { ok: true; event: Event; attendees: number }
  | { ok: false; error: string };

/** Reschedule an event/meeting (drag & drop, resize) and re-plan its reminders. */
export async function moveCalendarEvent(eventId: string, startsAt: Date, endsAt: Date): Promise<MoveResult> {
  if (!(endsAt.getTime() > startsAt.getTime())) return { ok: false, error: "The end must be after the start." };
  const [existing] = await db.select().from(events).where(eq(events.id, eventId));
  if (!existing) return { ok: false, error: "Event not found." };
  if (existing.status === "cancelled" || existing.status === "completed") {
    return { ok: false, error: `A ${existing.status} event can't be rescheduled.` };
  }
  const [event] = await db.update(events).set({ startsAt, endsAt }).where(eq(events.id, eventId)).returning();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(eventAttendees)
    .where(and(eq(eventAttendees.eventId, eventId), ne(eventAttendees.status, "cancelled")));
  const attendees = num(row?.n);
  // Reminders hang off the start, follow-ups off the end: re-plan whichever moved.
  if (attendees > 0) await replanEventNotifications(eventId);
  return { ok: true, event, attendees };
}
