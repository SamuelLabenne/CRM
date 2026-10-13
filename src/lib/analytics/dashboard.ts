import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { addDays } from "date-fns";
import { db } from "@/lib/db";
import {
  activities,
  automations,
  bookingPages,
  campaigns,
  contacts,
  eventAttendees,
  events,
  invites,
  jobs,
  leadCaptures,
  messages,
  pageViews,
  tasks,
  users,
} from "@/lib/db/schema";
import { fullName } from "@/lib/format";
import { getSetting } from "@/lib/settings";
import type { ActivityType } from "@/lib/types";
import { dayKeys, type DateRange } from "./range";
import { DELIVERED_STATUSES, REGISTERED_STATUSES, num, ratio, relativeDelta, rateDelta, showUpRate } from "./metrics";

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export type PeriodTotals = {
  newContacts: number;
  registrations: number;
  attended: number;
  noShow: number;
  showUpRate: number | null;
  emailsDelivered: number;
  emailsOpened: number;
  openRate: number | null;
  meetingsBooked: number;
  wonValue: number;
  wonCount: number;
};

const between = (col: Parameters<typeof gte>[0], from: Date, to: Date) => and(gte(col, from), lt(col, to));

/** All headline numbers for one period [from, to). */
export async function periodTotals(from: Date, to: Date, now: Date = new Date()): Promise<PeriodTotals> {
  const [contactRow, regRow, meetingRow, attendRow, mailRow, wonRow] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(contacts).where(between(contacts.createdAt, from, to)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(eventAttendees)
      .innerJoin(events, eq(events.id, eventAttendees.eventId))
      .where(and(eq(events.kind, "event"), inArray(eventAttendees.status, REGISTERED_STATUSES), between(eventAttendees.registeredAt, from, to))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(eventAttendees)
      .innerJoin(events, eq(events.id, eventAttendees.eventId))
      .where(and(eq(events.kind, "meeting"), inArray(eventAttendees.status, REGISTERED_STATUSES), between(eventAttendees.registeredAt, from, to))),
    db
      .select({
        attended: sql<number>`count(*) filter (where ${eventAttendees.status} = 'attended')::int`,
        noShow: sql<number>`count(*) filter (where ${eventAttendees.status} = 'no_show')::int`,
      })
      .from(eventAttendees)
      .innerJoin(events, eq(events.id, eventAttendees.eventId))
      .where(
        and(
          between(events.startsAt, from, to),
          lt(events.endsAt, now),
          inArray(events.status, ["scheduled", "completed"]),
          inArray(eventAttendees.status, ["attended", "no_show"]),
        ),
      ),
    db
      .select({
        delivered: sql<number>`count(*)::int`,
        opened: sql<number>`count(*) filter (where ${messages.openedAt} is not null)::int`,
      })
      .from(messages)
      .where(and(inArray(messages.status, [...DELIVERED_STATUSES]), ne(messages.kind, "test"), between(messages.createdAt, from, to))),
    db
      .select({
        value: sql<number>`coalesce(sum(${eventAttendees.dealValue}), 0)::int`,
        n: sql<number>`count(*)::int`,
      })
      .from(eventAttendees)
      .innerJoin(events, eq(events.id, eventAttendees.eventId))
      .where(and(eq(events.kind, "meeting"), eq(eventAttendees.outcome, "won"), between(events.startsAt, from, to))),
  ]);
  const attended = num(attendRow[0]?.attended);
  const noShow = num(attendRow[0]?.noShow);
  const delivered = num(mailRow[0]?.delivered);
  const opened = num(mailRow[0]?.opened);
  return {
    newContacts: num(contactRow[0]?.n),
    registrations: num(regRow[0]?.n),
    attended,
    noShow,
    showUpRate: showUpRate(attended, noShow),
    emailsDelivered: delivered,
    emailsOpened: opened,
    openRate: ratio(opened, delivered),
    meetingsBooked: num(meetingRow[0]?.n),
    wonValue: num(wonRow[0]?.value),
    wonCount: num(wonRow[0]?.n),
  };
}

export type DashboardKpis = {
  current: PeriodTotals;
  previous: PeriodTotals | null;
  deltas: {
    newContacts: number | null;
    registrations: number | null;
    showUpRate: number | null;
    emailsDelivered: number | null;
    meetingsBooked: number | null;
    wonValue: number | null;
  };
};

export async function getDashboardKpis(range: DateRange, now: Date = new Date()): Promise<DashboardKpis> {
  const [current, previous] = await Promise.all([
    periodTotals(range.from, range.to, now),
    range.prevFrom && range.prevTo ? periodTotals(range.prevFrom, range.prevTo, now) : Promise.resolve(null),
  ]);
  return {
    current,
    previous,
    deltas: {
      newContacts: relativeDelta(current.newContacts, previous?.newContacts),
      registrations: relativeDelta(current.registrations, previous?.registrations),
      showUpRate: rateDelta(current.showUpRate, previous?.showUpRate ?? null),
      emailsDelivered: relativeDelta(current.emailsDelivered, previous?.emailsDelivered),
      meetingsBooked: relativeDelta(current.meetingsBooked, previous?.meetingsBooked),
      wonValue: relativeDelta(current.wonValue, previous?.wonValue),
    },
  };
}

// ---------------------------------------------------------------------------
// Funnel: unique page views → potential leads → registrations & bookings → attended
// ---------------------------------------------------------------------------

export type FunnelStep = { key: string; label: string; value: number; /** conversion from the previous step */ rate: number | null };

export async function getFunnel(range: DateRange): Promise<FunnelStep[]> {
  const [viewRow, leadRow, signupRow] = await Promise.all([
    db
      .select({ n: sql<number>`count(distinct (${pageViews.targetId}::text || ':' || ${pageViews.visitorHash}))::int` })
      .from(pageViews)
      .where(between(pageViews.createdAt, range.from, range.to)),
    db.select({ n: sql<number>`count(*)::int` }).from(leadCaptures).where(between(leadCaptures.createdAt, range.from, range.to)),
    db
      .select({
        signups: sql<number>`count(*)::int`,
        attended: sql<number>`count(*) filter (where ${eventAttendees.status} = 'attended')::int`,
      })
      .from(eventAttendees)
      .where(
        and(
          inArray(eventAttendees.status, REGISTERED_STATUSES),
          inArray(eventAttendees.source, ["public", "booking"]),
          between(eventAttendees.registeredAt, range.from, range.to),
        ),
      ),
  ]);
  const views = num(viewRow[0]?.n);
  const leads = num(leadRow[0]?.n);
  const signups = num(signupRow[0]?.signups);
  const attended = num(signupRow[0]?.attended);
  return [
    { key: "views", label: "Unique page views", value: views, rate: null },
    { key: "leads", label: "Potential leads", value: leads, rate: ratio(leads, views) },
    { key: "signups", label: "Registrations & bookings", value: signups, rate: ratio(signups, leads) },
    { key: "attended", label: "Attended", value: attended, rate: ratio(attended, signups) },
  ];
}

// ---------------------------------------------------------------------------
// Registrations & bookings over time
// ---------------------------------------------------------------------------

export type SeriesPoint = { date: string; registrations: number; bookings: number };

export async function getRegistrationSeries(range: DateRange): Promise<SeriesPoint[]> {
  const day = sql<string>`to_char(${eventAttendees.registeredAt} at time zone ${range.timezone}, 'YYYY-MM-DD')`;
  const rows = await db
    .select({
      day,
      registrations: sql<number>`count(*) filter (where ${events.kind} = 'event')::int`,
      bookings: sql<number>`count(*) filter (where ${events.kind} = 'meeting')::int`,
    })
    .from(eventAttendees)
    .innerJoin(events, eq(events.id, eventAttendees.eventId))
    .where(and(inArray(eventAttendees.status, REGISTERED_STATUSES), between(eventAttendees.registeredAt, range.from, range.to)))
    .groupBy(sql`1`);
  const byDay = new Map(rows.map((r) => [r.day, r]));
  return dayKeys(range).map((date) => ({
    date,
    registrations: num(byDay.get(date)?.registrations),
    bookings: num(byDay.get(date)?.bookings),
  }));
}

// ---------------------------------------------------------------------------
// Upcoming events & meetings (next 7 days)
// ---------------------------------------------------------------------------

export type UpcomingItem = {
  id: string;
  kind: "event" | "meeting";
  title: string;
  startsAt: Date;
  endsAt: Date;
  type: string;
  registered: number;
  capacity: number | null;
  contactName: string | null;
  hostName: string | null;
  color: string | null;
  campaignName: string | null;
};

export async function getUpcoming(now: Date = new Date(), days = 7, limit = 8): Promise<UpcomingItem[]> {
  const rows = await db
    .select({
      event: events,
      hostName: users.name,
      campaignName: campaigns.name,
      campaignColor: campaigns.color,
    })
    .from(events)
    .leftJoin(users, eq(users.id, events.hostId))
    .leftJoin(campaigns, eq(campaigns.id, events.campaignId))
    .where(and(eq(events.status, "scheduled"), gte(events.startsAt, now), lt(events.startsAt, addDays(now, days))))
    .orderBy(asc(events.startsAt))
    .limit(limit);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.event.id);
  const attendeeRows = await db
    .select({
      eventId: eventAttendees.eventId,
      status: eventAttendees.status,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      phone: contacts.phone,
    })
    .from(eventAttendees)
    .innerJoin(contacts, eq(contacts.id, eventAttendees.contactId))
    .where(and(inArray(eventAttendees.eventId, ids), inArray(eventAttendees.status, REGISTERED_STATUSES)));
  const counts = new Map<string, number>();
  const firstContact = new Map<string, string>();
  for (const a of attendeeRows) {
    counts.set(a.eventId, (counts.get(a.eventId) ?? 0) + 1);
    if (!firstContact.has(a.eventId)) firstContact.set(a.eventId, fullName(a));
  }
  return rows.map(({ event, hostName, campaignName, campaignColor }) => ({
    id: event.id,
    kind: event.kind,
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    type: event.type,
    registered: counts.get(event.id) ?? 0,
    capacity: event.capacity,
    contactName: event.kind === "meeting" ? (firstContact.get(event.id) ?? null) : null,
    hostName,
    color: event.color ?? campaignColor ?? null,
    campaignName,
  }));
}

// ---------------------------------------------------------------------------
// Needs attention
// ---------------------------------------------------------------------------

export type AttentionEvent = { id: string; title: string; endsAt: Date; unmarked: number };
export type AttentionMeeting = { id: string; title: string; endsAt: Date; contactName: string | null; contactId: string | null };
export type AttentionTask = { id: string; title: string; dueAt: Date | null; contactId: string | null };

export type NeedsAttention = {
  eventsWithoutAttendance: { total: number; items: AttentionEvent[] };
  meetingsWithoutOutcome: { total: number; items: AttentionMeeting[] };
  overdueTasks: { total: number; items: AttentionTask[] };
  failedMessages: number;
  failedJobs: number;
  /** Sum of everything above (0 → "all caught up"). */
  total: number;
};

export async function getNeedsAttention(userId: string, now: Date = new Date()): Promise<NeedsAttention> {
  const weekAgo = new Date(now.getTime() - 7 * 864e5);
  const unmarkedExists = and(
    eq(eventAttendees.eventId, events.id),
    inArray(eventAttendees.status, ["registered", "confirmed"]),
  );

  const [pastEvents, pastEventTotal, meetings, meetingTotal, overdue, overdueTotal, failedMsg, failedJob] = await Promise.all([
    db
      .select({
        id: events.id,
        title: events.title,
        endsAt: events.endsAt,
        unmarked: sql<number>`(select count(*) from ${eventAttendees} where ${unmarkedExists})::int`,
      })
      .from(events)
      .where(
        and(
          eq(events.kind, "event"),
          inArray(events.status, ["scheduled", "completed"]),
          lt(events.endsAt, now),
          sql`exists (select 1 from ${eventAttendees} where ${unmarkedExists})`,
        ),
      )
      .orderBy(desc(events.endsAt))
      .limit(5),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(events)
      .where(
        and(
          eq(events.kind, "event"),
          inArray(events.status, ["scheduled", "completed"]),
          lt(events.endsAt, now),
          sql`exists (select 1 from ${eventAttendees} where ${unmarkedExists})`,
        ),
      ),
    db
      .select({
        id: events.id,
        title: events.title,
        endsAt: events.endsAt,
        contactId: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        phone: contacts.phone,
      })
      .from(eventAttendees)
      .innerJoin(events, eq(events.id, eventAttendees.eventId))
      .innerJoin(contacts, eq(contacts.id, eventAttendees.contactId))
      .where(meetingNeedsOutcome(now))
      .orderBy(desc(events.endsAt))
      .limit(5),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(eventAttendees)
      .innerJoin(events, eq(events.id, eventAttendees.eventId))
      .where(meetingNeedsOutcome(now)),
    db
      .select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt, contactId: tasks.contactId })
      .from(tasks)
      .where(overdueTaskWhere(userId, now))
      .orderBy(asc(tasks.dueAt))
      .limit(5),
    db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(overdueTaskWhere(userId, now)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(messages)
      .where(and(inArray(messages.status, ["failed", "bounced"]), gte(messages.createdAt, weekAgo))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(jobs)
      .where(and(eq(jobs.status, "failed"), gte(jobs.createdAt, weekAgo))),
  ]);

  const result: NeedsAttention = {
    eventsWithoutAttendance: {
      total: num(pastEventTotal[0]?.n),
      items: pastEvents.map((e) => ({ id: e.id, title: e.title, endsAt: e.endsAt, unmarked: num(e.unmarked) })),
    },
    meetingsWithoutOutcome: {
      total: num(meetingTotal[0]?.n),
      items: meetings.map((m) => ({
        id: m.id,
        title: m.title,
        endsAt: m.endsAt,
        contactId: m.contactId,
        contactName: fullName(m),
      })),
    },
    overdueTasks: { total: num(overdueTotal[0]?.n), items: overdue },
    failedMessages: num(failedMsg[0]?.n),
    failedJobs: num(failedJob[0]?.n),
    total: 0,
  };
  result.total =
    result.eventsWithoutAttendance.total +
    result.meetingsWithoutOutcome.total +
    result.overdueTasks.total +
    result.failedMessages +
    result.failedJobs;
  return result;
}

/** Past meetings (not cancelled) whose invitee has no logged outcome yet. */
export function meetingNeedsOutcome(now: Date) {
  return and(
    eq(events.kind, "meeting"),
    inArray(events.status, ["scheduled", "completed"]),
    lt(events.endsAt, now),
    isNull(eventAttendees.outcome),
    ne(eventAttendees.status, "cancelled"),
  );
}

function overdueTaskWhere(userId: string, now: Date) {
  return and(isNull(tasks.completedAt), lt(tasks.dueAt, now), or(eq(tasks.assigneeId, userId), isNull(tasks.assigneeId)));
}

// ---------------------------------------------------------------------------
// Recent activity & top campaigns
// ---------------------------------------------------------------------------

export type RecentActivity = {
  id: string;
  type: ActivityType;
  title: string;
  createdAt: Date;
  contactId: string | null;
  contactName: string | null;
  eventId: string | null;
};

export async function getRecentActivity(limit = 12): Promise<RecentActivity[]> {
  const rows = await db
    .select({
      id: activities.id,
      type: activities.type,
      title: activities.title,
      createdAt: activities.createdAt,
      eventId: activities.eventId,
      contactId: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      phone: contacts.phone,
    })
    .from(activities)
    .leftJoin(contacts, eq(contacts.id, activities.contactId))
    .orderBy(desc(activities.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    createdAt: r.createdAt,
    eventId: r.eventId,
    contactId: r.contactId,
    contactName: r.contactId ? fullName(r) : null,
  }));
}

export type TopCampaign = { id: string; name: string; color: string; registrations: number; events: number };

export async function getTopCampaigns(range: DateRange, limit = 5): Promise<TopCampaign[]> {
  const regs = sql<number>`count(${eventAttendees.id})::int`;
  const rows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      color: campaigns.color,
      registrations: regs,
      events: sql<number>`count(distinct ${events.id})::int`,
    })
    .from(campaigns)
    .innerJoin(events, eq(events.campaignId, campaigns.id))
    .innerJoin(eventAttendees, eq(eventAttendees.eventId, events.id))
    .where(and(inArray(eventAttendees.status, REGISTERED_STATUSES), between(eventAttendees.registeredAt, range.from, range.to)))
    .groupBy(campaigns.id)
    .orderBy(desc(regs), asc(campaigns.name))
    .limit(limit);
  return rows.map((r) => ({ ...r, registrations: num(r.registrations), events: num(r.events) }));
}

// ---------------------------------------------------------------------------
// Getting started checklist
// ---------------------------------------------------------------------------

export type OnboardingItem = {
  key: "email" | "event" | "booking" | "contacts" | "automation" | "team";
  title: string;
  description: string;
  href: string;
  cta: string;
  done: boolean;
};

export type OnboardingState = {
  items: OnboardingItem[];
  done: number;
  total: number;
  /** No contacts and no events yet. */
  fresh: boolean;
};

export async function getOnboardingState(): Promise<OnboardingState> {
  const count = async (q: Promise<{ n: number }[]>) => num((await q)[0]?.n);
  const [email, contactCount, importedCount, eventCount, bookingCount, automationCount, userCount, inviteCount] = await Promise.all([
    getSetting("email"),
    count(db.select({ n: sql<number>`count(*)::int` }).from(contacts)),
    count(db.select({ n: sql<number>`count(*)::int` }).from(contacts).where(eq(contacts.source, "import"))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(events).where(eq(events.kind, "event"))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(bookingPages).where(eq(bookingPages.isActive, true))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(automations)),
    count(db.select({ n: sql<number>`count(*)::int` }).from(users).where(isNull(users.deactivatedAt))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(invites)),
  ]);
  const items: OnboardingItem[] = [
    {
      key: "email",
      title: "Connect email sending",
      description: "Set your sender name and address (and a provider) so confirmations and reminders reach inboxes.",
      href: "/settings/email",
      cta: "Set up email",
      done: email.provider !== "outbox",
    },
    {
      key: "event",
      title: "Create your first event",
      description: "Webinar, workshop or meetup — with a public registration page and automatic reminders.",
      href: "/events/new",
      cta: "Create event",
      done: eventCount > 0,
    },
    {
      key: "booking",
      title: "Publish a booking page",
      description: "Let leads self-book qualified 1:1 calls and cut no-shows with reminders.",
      href: "/scheduling/new",
      cta: "Create booking page",
      done: bookingCount > 0,
    },
    {
      key: "contacts",
      title: "Import your contacts",
      description: "Upload a CSV and map the columns — duplicates are merged by email.",
      href: "/contacts/import",
      cta: "Import contacts",
      done: importedCount > 0 || contactCount > 0,
    },
    {
      key: "automation",
      title: "Create an automation",
      description: "Start from a recipe such as event reminders, no-show recovery or a welcome series.",
      href: "/automations/new",
      cta: "Browse recipes",
      done: automationCount > 0,
    },
    {
      key: "team",
      title: "Invite your team",
      description: "Add teammates so hosts, owners and follow-ups are shared.",
      href: "/settings/team",
      cta: "Invite team",
      done: userCount > 1 || inviteCount > 0,
    },
  ];
  return {
    items,
    done: items.filter((i) => i.done).length,
    total: items.length,
    fresh: contactCount === 0 && eventCount === 0,
  };
}
