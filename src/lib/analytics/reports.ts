import { and, asc, desc, eq, gte, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  bookingPages,
  broadcasts,
  campaigns,
  contacts,
  emailEvents,
  emailTemplates,
  eventAttendees,
  events,
  messages,
  pageViews,
  users,
} from "@/lib/db/schema";
import type { DateRange } from "./range";
import { DELIVERED_STATUSES, REGISTERED_STATUSES, num, ratio, showUpRate } from "./metrics";

const between = (col: Parameters<typeof gte>[0], from: Date, to: Date) => and(gte(col, from), lt(col, to));

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type EventReportRow = {
  id: string;
  title: string;
  type: string;
  status: string;
  startsAt: Date;
  isPast: boolean;
  campaignName: string | null;
  campaignColor: string | null;
  capacity: number | null;
  registrations: number;
  waitlisted: number;
  attended: number;
  noShow: number;
  /** attended / (attended + no_show) */
  showUpRate: number | null;
  /** attended / registrations (past events only) */
  attendanceRate: number | null;
  pageViews: number;
  /** registrations / unique page views */
  conversion: number | null;
};

export type EventsReport = {
  rows: EventReportRow[];
  totals: {
    events: number;
    registrations: number;
    attended: number;
    noShow: number;
    showUpRate: number | null;
    pageViews: number;
    conversion: number | null;
  };
};

export async function getEventsReport(range: DateRange, now: Date = new Date()): Promise<EventsReport> {
  const evRows = await db
    .select({ event: events, campaignName: campaigns.name, campaignColor: campaigns.color })
    .from(events)
    .leftJoin(campaigns, eq(campaigns.id, events.campaignId))
    .where(and(eq(events.kind, "event"), ne(events.status, "draft"), between(events.startsAt, range.from, range.to)))
    .orderBy(desc(events.startsAt))
    .limit(300);
  const ids = evRows.map((r) => r.event.id);
  const [attRows, viewRows] = ids.length
    ? await Promise.all([
        db
          .select({
            eventId: eventAttendees.eventId,
            registrations: sql<number>`count(*) filter (where ${eventAttendees.status} in ('registered','confirmed','attended','no_show'))::int`,
            waitlisted: sql<number>`count(*) filter (where ${eventAttendees.status} = 'waitlisted')::int`,
            attended: sql<number>`count(*) filter (where ${eventAttendees.status} = 'attended')::int`,
            noShow: sql<number>`count(*) filter (where ${eventAttendees.status} = 'no_show')::int`,
          })
          .from(eventAttendees)
          .where(inArray(eventAttendees.eventId, ids))
          .groupBy(eventAttendees.eventId),
        db
          .select({ targetId: pageViews.targetId, n: sql<number>`count(distinct ${pageViews.visitorHash})::int` })
          .from(pageViews)
          .where(and(eq(pageViews.kind, "event"), inArray(pageViews.targetId, ids)))
          .groupBy(pageViews.targetId),
      ])
    : [[], []];
  const att = new Map(attRows.map((r) => [r.eventId, r]));
  const views = new Map(viewRows.map((r) => [r.targetId, num(r.n)]));

  const rows: EventReportRow[] = evRows.map(({ event, campaignName, campaignColor }) => {
    const a = att.get(event.id);
    const registrations = num(a?.registrations);
    const attended = num(a?.attended);
    const noShow = num(a?.noShow);
    const pv = views.get(event.id) ?? 0;
    const isPast = event.endsAt < now;
    return {
      id: event.id,
      title: event.title,
      type: event.type,
      status: event.status,
      startsAt: event.startsAt,
      isPast,
      campaignName,
      campaignColor,
      capacity: event.capacity,
      registrations,
      waitlisted: num(a?.waitlisted),
      attended,
      noShow,
      showUpRate: showUpRate(attended, noShow),
      attendanceRate: isPast ? ratio(attended, registrations) : null,
      pageViews: pv,
      conversion: ratio(registrations, pv),
    };
  });

  const sum = (f: (r: EventReportRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const registrations = sum((r) => r.registrations);
  const attended = sum((r) => r.attended);
  const noShow = sum((r) => r.noShow);
  const pageViewTotal = sum((r) => r.pageViews);
  return {
    rows,
    totals: {
      events: rows.length,
      registrations,
      attended,
      noShow,
      showUpRate: showUpRate(attended, noShow),
      pageViews: pageViewTotal,
      conversion: ratio(registrations, pageViewTotal),
    },
  };
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export type EmailStatsRow = {
  delivered: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  failed: number;
  openRate: number | null;
  clickRate: number | null;
};

export type BroadcastReportRow = EmailStatsRow & {
  id: string;
  name: string;
  subject: string;
  status: string;
  sentAt: Date | null;
  recipients: number;
};

export type TemplateReportRow = EmailStatsRow & {
  id: string;
  name: string;
  category: string;
  isSystem: boolean;
};

export type EmailReport = {
  totals: EmailStatsRow & { messages: number };
  broadcasts: BroadcastReportRow[];
  templates: TemplateReportRow[];
};

function emailStats(r: { delivered?: unknown; opened?: unknown; clicked?: unknown; unsubscribed?: unknown; failed?: unknown } | undefined): EmailStatsRow {
  const delivered = num(r?.delivered);
  const opened = num(r?.opened);
  const clicked = num(r?.clicked);
  return {
    delivered,
    opened,
    clicked,
    unsubscribed: num(r?.unsubscribed),
    failed: num(r?.failed),
    openRate: ratio(opened, delivered),
    clickRate: ratio(clicked, delivered),
  };
}

const deliveredCount = sql<number>`count(*) filter (where ${messages.status} in ('sent','simulated'))::int`;
const openedCount = sql<number>`count(*) filter (where ${messages.status} in ('sent','simulated') and ${messages.openedAt} is not null)::int`;
const clickedCount = sql<number>`count(*) filter (where ${messages.status} in ('sent','simulated') and ${messages.clickedAt} is not null)::int`;
const failedCount = sql<number>`count(*) filter (where ${messages.status} in ('failed','bounced'))::int`;

export async function getEmailReport(range: DateRange): Promise<EmailReport> {
  const msgWhere = and(ne(messages.kind, "test"), between(messages.createdAt, range.from, range.to));

  const [totalRow, unsubTotal, bcRows, bcStats, bcUnsubs, tplStats, tplUnsubs] = await Promise.all([
    db.select({ delivered: deliveredCount, opened: openedCount, clicked: clickedCount, failed: failedCount, all: sql<number>`count(*)::int` }).from(messages).where(msgWhere),
    db
      .select({ n: sql<number>`count(distinct ${emailEvents.messageId})::int` })
      .from(emailEvents)
      .innerJoin(messages, eq(messages.id, emailEvents.messageId))
      .where(and(eq(emailEvents.type, "unsubscribe"), msgWhere)),
    db
      .select()
      .from(broadcasts)
      .where(
        and(
          inArray(broadcasts.status, ["sent", "sending"]),
          between(sql`coalesce(${broadcasts.sentAt}, ${broadcasts.createdAt})`, range.from, range.to),
        ),
      )
      .orderBy(desc(sql`coalesce(${broadcasts.sentAt}, ${broadcasts.createdAt})`))
      .limit(100),
    db
      .select({ id: messages.broadcastId, delivered: deliveredCount, opened: openedCount, clicked: clickedCount, failed: failedCount })
      .from(messages)
      .where(and(isNotNull(messages.broadcastId), eq(messages.kind, "broadcast")))
      .groupBy(messages.broadcastId),
    db
      .select({ id: messages.broadcastId, n: sql<number>`count(distinct ${emailEvents.messageId})::int` })
      .from(emailEvents)
      .innerJoin(messages, eq(messages.id, emailEvents.messageId))
      .where(and(eq(emailEvents.type, "unsubscribe"), isNotNull(messages.broadcastId)))
      .groupBy(messages.broadcastId),
    db
      .select({ id: messages.templateId, delivered: deliveredCount, opened: openedCount, clicked: clickedCount, failed: failedCount })
      .from(messages)
      .where(and(isNotNull(messages.templateId), msgWhere))
      .groupBy(messages.templateId),
    db
      .select({ id: messages.templateId, n: sql<number>`count(distinct ${emailEvents.messageId})::int` })
      .from(emailEvents)
      .innerJoin(messages, eq(messages.id, emailEvents.messageId))
      .where(and(eq(emailEvents.type, "unsubscribe"), isNotNull(messages.templateId), msgWhere))
      .groupBy(messages.templateId),
  ]);

  const bcStatMap = new Map(bcStats.map((r) => [r.id, r]));
  const bcUnsubMap = new Map(bcUnsubs.map((r) => [r.id, num(r.n)]));
  const broadcastRows: BroadcastReportRow[] = bcRows.map((b) => ({
    id: b.id,
    name: b.name,
    subject: b.subject,
    status: b.status,
    sentAt: b.sentAt ?? b.createdAt,
    recipients: b.recipientCount,
    ...emailStats({ ...bcStatMap.get(b.id), unsubscribed: bcUnsubMap.get(b.id) ?? 0 }),
  }));

  const tplIds = tplStats.map((t) => t.id).filter((x): x is string => !!x);
  const tplMeta = tplIds.length ? await db.select().from(emailTemplates).where(inArray(emailTemplates.id, tplIds)) : [];
  const tplMetaMap = new Map(tplMeta.map((t) => [t.id, t]));
  const tplUnsubMap = new Map(tplUnsubs.map((r) => [r.id, num(r.n)]));
  const templateRows: TemplateReportRow[] = tplStats
    .filter((t) => t.id && tplMetaMap.has(t.id))
    .map((t) => {
      const meta = tplMetaMap.get(t.id!)!;
      return {
        id: meta.id,
        name: meta.name,
        category: meta.category,
        isSystem: !!meta.systemKey,
        ...emailStats({ ...t, unsubscribed: tplUnsubMap.get(t.id!) ?? 0 }),
      };
    })
    .sort((a, b) => b.delivered - a.delivered);

  return {
    totals: { ...emailStats({ ...totalRow[0], unsubscribed: unsubTotal[0]?.n }), messages: num(totalRow[0]?.all) },
    broadcasts: broadcastRows,
    templates: templateRows,
  };
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export type CampaignReportRow = {
  id: string;
  name: string;
  color: string;
  status: string;
  type: string;
  budget: number | null;
  events: number;
  registrations: number;
  attended: number;
  noShow: number;
  showUpRate: number | null;
  broadcasts: number;
  emailsDelivered: number;
  openRate: number | null;
  clickRate: number | null;
  /** Contacts created in the range whose first-touch utm.campaign equals the campaign's utm_campaign. */
  contacts: number;
  /** budget / registrations */
  costPerRegistration: number | null;
};

export async function getCampaignsReport(range: DateRange): Promise<CampaignReportRow[]> {
  const [camps, evStats, bcStats, msgStats, contactStats] = await Promise.all([
    db.select().from(campaigns).where(ne(campaigns.status, "archived")).orderBy(asc(campaigns.name)),
    db
      .select({
        campaignId: events.campaignId,
        events: sql<number>`count(distinct ${events.id})::int`,
        registrations: sql<number>`count(*) filter (where ${eventAttendees.status} in ('registered','confirmed','attended','no_show'))::int`,
        attended: sql<number>`count(*) filter (where ${eventAttendees.status} = 'attended')::int`,
        noShow: sql<number>`count(*) filter (where ${eventAttendees.status} = 'no_show')::int`,
      })
      .from(events)
      .leftJoin(eventAttendees, eq(eventAttendees.eventId, events.id))
      .where(and(isNotNull(events.campaignId), eq(events.kind, "event"), ne(events.status, "draft"), between(events.startsAt, range.from, range.to)))
      .groupBy(events.campaignId),
    db
      .select({ campaignId: broadcasts.campaignId, n: sql<number>`count(*)::int` })
      .from(broadcasts)
      .where(
        and(
          isNotNull(broadcasts.campaignId),
          inArray(broadcasts.status, ["sent", "sending"]),
          between(sql`coalesce(${broadcasts.sentAt}, ${broadcasts.createdAt})`, range.from, range.to),
        ),
      )
      .groupBy(broadcasts.campaignId),
    db
      .select({ campaignId: broadcasts.campaignId, delivered: deliveredCount, opened: openedCount, clicked: clickedCount })
      .from(messages)
      .innerJoin(broadcasts, eq(broadcasts.id, messages.broadcastId))
      .where(
        and(
          isNotNull(broadcasts.campaignId),
          between(sql`coalesce(${broadcasts.sentAt}, ${broadcasts.createdAt})`, range.from, range.to),
        ),
      )
      .groupBy(broadcasts.campaignId),
    db
      .select({ utmCampaign: sql<string>`${contacts.utm}->>'campaign'`, n: sql<number>`count(*)::int` })
      .from(contacts)
      .where(and(sql`coalesce(${contacts.utm}->>'campaign', '') <> ''`, between(contacts.createdAt, range.from, range.to)))
      .groupBy(sql`1`),
  ]);
  const evMap = new Map(evStats.map((r) => [r.campaignId, r]));
  const bcMap = new Map(bcStats.map((r) => [r.campaignId, num(r.n)]));
  const msgMap = new Map(msgStats.map((r) => [r.campaignId, r]));
  const contactMap = new Map(contactStats.map((r) => [r.utmCampaign, num(r.n)]));

  return camps.map((c) => {
    const ev = evMap.get(c.id);
    const msg = msgMap.get(c.id);
    const registrations = num(ev?.registrations);
    const attended = num(ev?.attended);
    const noShow = num(ev?.noShow);
    const delivered = num(msg?.delivered);
    return {
      id: c.id,
      name: c.name,
      color: c.color,
      status: c.status,
      type: c.type,
      budget: c.budget,
      events: num(ev?.events),
      registrations,
      attended,
      noShow,
      showUpRate: showUpRate(attended, noShow),
      broadcasts: bcMap.get(c.id) ?? 0,
      emailsDelivered: delivered,
      openRate: ratio(num(msg?.opened), delivered),
      clickRate: ratio(num(msg?.clicked), delivered),
      contacts: c.utmCampaign ? (contactMap.get(c.utmCampaign) ?? 0) : 0,
      costPerRegistration: c.budget != null ? ratio(c.budget, registrations) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

export type MeetingStats = {
  booked: number;
  cancelled: number;
  attended: number;
  noShow: number;
  /** attended / (attended + no_show) */
  showUpRate: number | null;
  withOutcome: number;
  won: number;
  /** won / meetings with an outcome other than cancelled */
  closingRate: number | null;
  wonValue: number;
  avgDealValue: number | null;
};

export type MeetingGroupRow = MeetingStats & { key: string; name: string };

export type MeetingsReport = {
  totals: MeetingStats;
  byHost: MeetingGroupRow[];
  byPage: MeetingGroupRow[];
  outcomes: { outcome: string; count: number }[];
  objections: { objection: string; count: number }[];
};

const meetingAggregates = {
  booked: sql<number>`count(*) filter (where ${eventAttendees.status} in ('registered','confirmed','attended','no_show'))::int`,
  cancelled: sql<number>`count(*) filter (where ${eventAttendees.status} = 'cancelled')::int`,
  attended: sql<number>`count(*) filter (where ${eventAttendees.status} = 'attended')::int`,
  noShow: sql<number>`count(*) filter (where ${eventAttendees.status} = 'no_show')::int`,
  withOutcome: sql<number>`count(*) filter (where ${eventAttendees.outcome} is not null and ${eventAttendees.outcome} <> 'cancelled')::int`,
  won: sql<number>`count(*) filter (where ${eventAttendees.outcome} = 'won')::int`,
  wonValue: sql<number>`coalesce(sum(${eventAttendees.dealValue}) filter (where ${eventAttendees.outcome} = 'won'), 0)::int`,
};

function toMeetingStats(r: Partial<Record<keyof typeof meetingAggregates, unknown>> | undefined): MeetingStats {
  const attended = num(r?.attended);
  const noShow = num(r?.noShow);
  const withOutcome = num(r?.withOutcome);
  const won = num(r?.won);
  const wonValue = num(r?.wonValue);
  return {
    booked: num(r?.booked),
    cancelled: num(r?.cancelled),
    attended,
    noShow,
    showUpRate: showUpRate(attended, noShow),
    withOutcome,
    won,
    closingRate: ratio(won, withOutcome),
    wonValue,
    avgDealValue: ratio(wonValue, won),
  };
}

export async function getMeetingsReport(range: DateRange): Promise<MeetingsReport> {
  const cohort = and(eq(events.kind, "meeting"), ne(events.status, "draft"), between(events.startsAt, range.from, range.to));
  const [totalRow, hostRows, pageRows, outcomeRows, objectionRows] = await Promise.all([
    db.select(meetingAggregates).from(eventAttendees).innerJoin(events, eq(events.id, eventAttendees.eventId)).where(cohort),
    db
      .select({ key: events.hostId, name: users.name, ...meetingAggregates })
      .from(eventAttendees)
      .innerJoin(events, eq(events.id, eventAttendees.eventId))
      .leftJoin(users, eq(users.id, events.hostId))
      .where(cohort)
      .groupBy(events.hostId, users.name),
    db
      .select({ key: events.bookingPageId, name: bookingPages.title, ...meetingAggregates })
      .from(eventAttendees)
      .innerJoin(events, eq(events.id, eventAttendees.eventId))
      .leftJoin(bookingPages, eq(bookingPages.id, events.bookingPageId))
      .where(cohort)
      .groupBy(events.bookingPageId, bookingPages.title),
    db
      .select({ outcome: eventAttendees.outcome, count: sql<number>`count(*)::int` })
      .from(eventAttendees)
      .innerJoin(events, eq(events.id, eventAttendees.eventId))
      .where(and(cohort, isNotNull(eventAttendees.outcome)))
      .groupBy(eventAttendees.outcome),
    db
      .select({ objection: eventAttendees.objection, count: sql<number>`count(*)::int` })
      .from(eventAttendees)
      .innerJoin(events, eq(events.id, eventAttendees.eventId))
      .where(and(cohort, isNotNull(eventAttendees.objection)))
      .groupBy(eventAttendees.objection),
  ]);
  const group = (rows: typeof hostRows, fallback: string): MeetingGroupRow[] =>
    rows
      .map((r) => ({ key: r.key ?? "none", name: r.name ?? fallback, ...toMeetingStats(r) }))
      .sort((a, b) => b.booked - a.booked || a.name.localeCompare(b.name));
  return {
    totals: toMeetingStats(totalRow[0]),
    byHost: group(hostRows, "Unassigned"),
    byPage: group(pageRows as unknown as typeof hostRows, "Direct (no booking page)"),
    outcomes: outcomeRows
      .filter((r) => r.outcome)
      .map((r) => ({ outcome: r.outcome as string, count: num(r.count) }))
      .sort((a, b) => b.count - a.count),
    objections: objectionRows
      .filter((r) => r.objection)
      .map((r) => ({ objection: r.objection as string, count: num(r.count) }))
      .sort((a, b) => b.count - a.count),
  };
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export type SourceRow = { key: string; contacts: number; converted: number; conversion: number | null };
export type SourcesReport = {
  totalContacts: number;
  withUtm: number;
  converted: number;
  bySource: SourceRow[];
  byUtmSource: SourceRow[];
  byUtmMedium: SourceRow[];
  byUtmCampaign: SourceRow[];
};

async function groupContacts(range: DateRange, expr: ReturnType<typeof sql<string>>): Promise<SourceRow[]> {
  const registered = and(eq(eventAttendees.contactId, contacts.id), inArray(eventAttendees.status, REGISTERED_STATUSES));
  const rows = await db
    .select({
      key: expr,
      contacts: sql<number>`count(*)::int`,
      converted: sql<number>`count(*) filter (where exists (select 1 from ${eventAttendees} where ${registered}))::int`,
    })
    .from(contacts)
    .where(between(contacts.createdAt, range.from, range.to))
    .groupBy(sql`1`)
    .orderBy(desc(sql`2`), asc(sql`1`))
    .limit(50);
  return rows.map((r) => ({
    key: r.key,
    contacts: num(r.contacts),
    converted: num(r.converted),
    conversion: ratio(num(r.converted), num(r.contacts)),
  }));
}

const utmExpr = (field: "source" | "medium" | "campaign") =>
  sql<string>`coalesce(nullif(${contacts.utm}->>${sql.raw(`'${field}'`)}, ''), '(none)')`;

export async function getSourcesReport(range: DateRange): Promise<SourcesReport> {
  const [bySource, byUtmSource, byUtmMedium, byUtmCampaign, totals] = await Promise.all([
    groupContacts(range, sql<string>`${contacts.source}`),
    groupContacts(range, utmExpr("source")),
    groupContacts(range, utmExpr("medium")),
    groupContacts(range, utmExpr("campaign")),
    db
      .select({
        total: sql<number>`count(*)::int`,
        withUtm: sql<number>`count(*) filter (where coalesce(${contacts.utm}->>'source', '') <> '' or coalesce(${contacts.utm}->>'campaign', '') <> '')::int`,
      })
      .from(contacts)
      .where(between(contacts.createdAt, range.from, range.to)),
  ]);
  return {
    totalContacts: num(totals[0]?.total),
    withUtm: num(totals[0]?.withUtm),
    converted: bySource.reduce((s, r) => s + r.converted, 0),
    bySource,
    byUtmSource,
    byUtmMedium,
    byUtmCampaign,
  };
}

// Re-exported for the email-delivered definition used in tests / UI copy.
export { DELIVERED_STATUSES };
