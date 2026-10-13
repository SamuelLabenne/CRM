import { and, asc, count, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, eventAttendees, events, jobs, pageViews, type Event } from "@/lib/db/schema";
import { formatInTz } from "@/lib/format";
import type { AttendeeStatus, EventType } from "@/lib/types";
import { bucketByDay, ratio, summarizeStatuses, type EventStats, type StatusCounts } from "./utils";

// Read-side queries for the events module (list, detail, attendees, scheduled emails).

export type EventTab = "upcoming" | "past" | "drafts" | "all";
export const EVENT_TABS: EventTab[] = ["upcoming", "past", "drafts", "all"];

export type EventFilters = { q?: string; campaignId?: string; type?: string };

function tabWhere(tab: EventTab, now: Date): SQL | undefined {
  switch (tab) {
    case "upcoming":
      return and(eq(events.status, "scheduled"), gte(events.endsAt, now));
    case "past":
      return or(eq(events.status, "completed"), and(eq(events.status, "scheduled"), lt(events.endsAt, now)));
    case "drafts":
      return eq(events.status, "draft");
    case "all":
      return undefined;
  }
}

function filterWhere(f: EventFilters): SQL | undefined {
  return and(
    f.q?.trim() ? ilike(events.title, `%${f.q.trim().replace(/[%_\\]/g, "\\$&")}%`) : undefined,
    f.campaignId ? eq(events.campaignId, f.campaignId) : undefined,
    f.type ? eq(events.type, f.type as EventType) : undefined,
  );
}

/** Per-status attendee counts for a set of events. */
export async function eventStatsMap(eventIds: string[]): Promise<Map<string, EventStats>> {
  const out = new Map<string, EventStats>();
  if (!eventIds.length) return out;
  const rows = await db
    .select({ eventId: eventAttendees.eventId, status: eventAttendees.status, n: count() })
    .from(eventAttendees)
    .where(inArray(eventAttendees.eventId, eventIds))
    .groupBy(eventAttendees.eventId, eventAttendees.status);
  const raw = new Map<string, StatusCounts>();
  for (const r of rows) {
    const c = raw.get(r.eventId) ?? {};
    c[r.status as AttendeeStatus] = Number(r.n);
    raw.set(r.eventId, c);
  }
  for (const id of eventIds) out.set(id, summarizeStatuses(raw.get(id) ?? {}));
  return out;
}

export const EVENTS_PAGE_SIZE = 24;

export async function listEvents(opts: { tab: EventTab; page?: number } & EventFilters) {
  const now = new Date();
  const where = and(eq(events.kind, "event"), tabWhere(opts.tab, now), filterWhere(opts));
  const page = Math.max(1, opts.page ?? 1);
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(events)
      .where(where)
      .orderBy(opts.tab === "upcoming" ? asc(events.startsAt) : desc(events.startsAt))
      .limit(EVENTS_PAGE_SIZE)
      .offset((page - 1) * EVENTS_PAGE_SIZE),
    db.select({ n: count() }).from(events).where(where),
  ]);
  const stats = await eventStatsMap(rows.map((r) => r.id));
  return { rows: rows.map((event) => ({ event, stats: stats.get(event.id)! })), total: Number(total?.n ?? 0), pageSize: EVENTS_PAGE_SIZE };
}

/** Number of events per tab (respecting the search/campaign/type filters). */
export async function countEventsByTab(f: EventFilters): Promise<Record<EventTab, number>> {
  const now = new Date();
  const counts = await Promise.all(
    EVENT_TABS.map(async (tab) => {
      const [r] = await db
        .select({ n: count() })
        .from(events)
        .where(and(eq(events.kind, "event"), tabWhere(tab, now), filterWhere(f)));
      return Number(r?.n ?? 0);
    }),
  );
  return Object.fromEntries(EVENT_TABS.map((t, i) => [t, counts[i]])) as Record<EventTab, number>;
}

/** Past events that still have registered/confirmed people nobody marked attended or no-show. */
export async function eventsNeedingAttendance(limit = 20) {
  const now = new Date();
  const rows = await db
    .select({ event: events, pending: sql<number>`count(*)::int` })
    .from(events)
    .innerJoin(eventAttendees, eq(eventAttendees.eventId, events.id))
    .where(
      and(
        eq(events.kind, "event"),
        lt(events.endsAt, now),
        inArray(events.status, ["scheduled", "completed"]),
        inArray(eventAttendees.status, ["registered", "confirmed"]),
      ),
    )
    .groupBy(events.id)
    .orderBy(desc(events.endsAt))
    .limit(limit);
  return rows;
}

// ---------------------------------------------------------------------------
// Event detail
// ---------------------------------------------------------------------------

export type EventOverview = {
  stats: EventStats;
  /** Unique daily visitors of the public page. */
  pageViews: number;
  /** Public registrations / unique page views. */
  conversion: number | null;
  publicRegistrations: number;
};

export async function getEventOverview(eventId: string): Promise<EventOverview> {
  const [stats, [views], [publicRegs]] = await Promise.all([
    eventStatsMap([eventId]).then((m) => m.get(eventId)!),
    db
      .select({ n: sql<number>`count(distinct ${pageViews.visitorHash})::int` })
      .from(pageViews)
      .where(and(eq(pageViews.kind, "event"), eq(pageViews.targetId, eventId))),
    db
      .select({ n: count() })
      .from(eventAttendees)
      .where(and(eq(eventAttendees.eventId, eventId), eq(eventAttendees.source, "public"), sql`${eventAttendees.status} <> 'cancelled'`)),
  ]);
  const unique = views?.n ?? 0;
  const publicRegistrations = Number(publicRegs?.n ?? 0);
  return { stats, pageViews: unique, conversion: ratio(publicRegistrations, unique), publicRegistrations };
}

/** Registrations per day (non-cancelled), from the first registration until the event (or today). */
export async function registrationSeries(event: Pick<Event, "id" | "startsAt" | "timezone">, tz: string) {
  const rows = await db
    .select({ at: eventAttendees.registeredAt })
    .from(eventAttendees)
    .where(and(eq(eventAttendees.eventId, event.id), sql`${eventAttendees.status} <> 'cancelled'`))
    .orderBy(asc(eventAttendees.registeredAt));
  if (!rows.length) return [];
  const fmt = (d: Date) => formatInTz(d, tz, "yyyy-MM-dd");
  const first = rows[0].at;
  const lastDay = new Date(Math.min(Date.now(), event.startsAt.getTime()));
  const to = lastDay.getTime() < first.getTime() ? rows[rows.length - 1].at : lastDay;
  return bucketByDay(rows.map((r) => r.at), fmt, first, to);
}

export const ATTENDEES_PAGE_SIZE = 50;

export type AttendeeRow = {
  id: string;
  contactId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  status: AttendeeStatus;
  rsvp: string | null;
  source: string;
  answers: Record<string, unknown>;
  registeredAt: Date;
  checkedInAt: Date | null;
  cancelReason: string | null;
};

function attendeeSearch(q?: string): SQL | undefined {
  const term = q?.trim();
  if (!term) return undefined;
  const like = `%${term.replace(/[%_\\]/g, "\\$&")}%`;
  return or(
    ilike(contacts.firstName, like),
    ilike(contacts.lastName, like),
    ilike(contacts.email, like),
    ilike(contacts.company, like),
    sql`concat_ws(' ', ${contacts.firstName}, ${contacts.lastName}) ilike ${like}`,
  );
}

export async function listAttendees(
  eventId: string,
  opts: { status?: string; q?: string; page?: number; all?: boolean } = {},
) {
  const where = and(
    eq(eventAttendees.eventId, eventId),
    opts.status && opts.status !== "all" ? eq(eventAttendees.status, opts.status as AttendeeStatus) : undefined,
    attendeeSearch(opts.q),
  );
  const page = Math.max(1, opts.page ?? 1);
  const query = db
    .select({
      id: eventAttendees.id,
      contactId: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      phone: contacts.phone,
      company: contacts.company,
      status: eventAttendees.status,
      rsvp: eventAttendees.rsvp,
      source: eventAttendees.source,
      answers: eventAttendees.answers,
      registeredAt: eventAttendees.registeredAt,
      checkedInAt: eventAttendees.checkedInAt,
      cancelReason: eventAttendees.cancelReason,
    })
    .from(eventAttendees)
    .innerJoin(contacts, eq(contacts.id, eventAttendees.contactId))
    .where(where)
    .orderBy(desc(eventAttendees.registeredAt));
  const [rows, [total]] = await Promise.all([
    (opts.all ? query : query.limit(ATTENDEES_PAGE_SIZE).offset((page - 1) * ATTENDEES_PAGE_SIZE)) as Promise<AttendeeRow[]>,
    db.select({ n: count() }).from(eventAttendees).innerJoin(contacts, eq(contacts.id, eventAttendees.contactId)).where(where),
  ]);
  return { rows, total: Number(total?.n ?? 0), pageSize: ATTENDEES_PAGE_SIZE };
}

/** Everyone who can be checked in (all but cancelled & waitlisted), alphabetical. */
export async function listCheckInRows(eventId: string) {
  return db
    .select({
      id: eventAttendees.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      company: contacts.company,
      status: eventAttendees.status,
      rsvp: eventAttendees.rsvp,
      checkedInAt: eventAttendees.checkedInAt,
    })
    .from(eventAttendees)
    .innerJoin(contacts, eq(contacts.id, eventAttendees.contactId))
    .where(and(eq(eventAttendees.eventId, eventId), inArray(eventAttendees.status, ["registered", "confirmed", "attended", "no_show"])))
    .orderBy(asc(contacts.firstName), asc(contacts.lastName), asc(contacts.email));
}

export type ScheduledEmail = {
  kind: string;
  reminderId: string | null;
  followUpId: string | null;
  runAt: Date;
  recipients: number;
};

/** Pending `event.notification` jobs for an event's attendees, grouped by notification and time. */
export async function upcomingEventEmails(eventId: string): Promise<ScheduledEmail[]> {
  const kind = sql<string>`${jobs.payload} ->> 'kind'`;
  const reminderId = sql<string | null>`${jobs.payload} ->> 'reminderId'`;
  const followUpId = sql<string | null>`${jobs.payload} ->> 'followUpId'`;
  const rows = await db
    .select({ kind, reminderId, followUpId, runAt: jobs.runAt, n: count() })
    .from(jobs)
    .innerJoin(eventAttendees, sql`${eventAttendees.id}::text = ${jobs.payload} ->> 'attendeeId'`)
    .where(and(eq(jobs.type, "event.notification"), eq(jobs.status, "pending"), eq(eventAttendees.eventId, eventId)))
    .groupBy(kind, reminderId, followUpId, jobs.runAt)
    .orderBy(asc(jobs.runAt));
  return rows
    .filter((r) => r.kind !== "host")
    .map((r) => ({ kind: r.kind, reminderId: r.reminderId, followUpId: r.followUpId, runAt: r.runAt, recipients: Number(r.n) }));
}
