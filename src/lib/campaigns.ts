import { and, asc, count, desc, eq, ilike, inArray, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { audienceWhere, countAudience } from "@/lib/audience";
import { broadcasts, campaigns, contacts, eventAttendees, events, messages, type Campaign } from "@/lib/db/schema";
import { eventStatsMap } from "@/lib/events/queries";
import { ratio } from "@/lib/events/utils";
import type { CampaignStatus, CampaignType } from "@/lib/types";

// Campaign metrics & CRUD. Definitions (kept consistent with the rest of the app):
//  - events: non-cancelled group events (kind "event") of the campaign
//  - registrations: non-cancelled attendees (waitlisted included) of those events
//  - show-up rate: attended / (attended + no_show)
//  - attendance rate: attended / non-cancelled registrations of events that already ended
//  - emails: messages of broadcasts linked to the campaign; delivered = sent + simulated
//  - open rate = opened / delivered, click rate = clicked / delivered
//  - attributed contacts: first-touch utm.campaign equals the campaign's utm_campaign
//  - cost per registration = budget / registrations

export const CAMPAIGN_TYPES: { value: CampaignType; label: string }[] = [
  { value: "event_series", label: "Event series" },
  { value: "webinar", label: "Webinar" },
  { value: "conference", label: "Conference" },
  { value: "email", label: "Email" },
  { value: "outreach", label: "Outreach" },
  { value: "social", label: "Social" },
  { value: "ads", label: "Paid ads" },
  { value: "other", label: "Other" },
];
export const CAMPAIGN_TYPE_LABEL = Object.fromEntries(CAMPAIGN_TYPES.map((t) => [t.value, t.label])) as Record<string, string>;
export const CAMPAIGN_STATUSES: CampaignStatus[] = ["planned", "active", "completed", "archived"];

export type CampaignMetrics = {
  events: number;
  registrations: number;
  attended: number;
  noShow: number;
  showUpRate: number | null;
  attendanceRate: number | null;
  emailsDelivered: number;
  emailsOpened: number;
  emailsClicked: number;
  openRate: number | null;
  clickRate: number | null;
  broadcasts: number;
  attributedContacts: number;
  budget: number | null;
  costPerRegistration: number | null;
};

const int = (expr: SQL) => sql<number>`${expr}::int`;

export async function campaignMetrics(campaignId: string, now = new Date()): Promise<CampaignMetrics | null> {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) return null;

  const eventScope = and(eq(events.campaignId, campaignId), eq(events.kind, "event"), ne(events.status, "cancelled"));
  const nowIso = now.toISOString();

  const [[ev], [att], [mail], [bc], [attributed]] = await Promise.all([
    db.select({ n: count() }).from(events).where(eventScope),
    db
      .select({
        registrations: int(sql`count(*) filter (where ${eventAttendees.status} <> 'cancelled')`),
        attended: int(sql`count(*) filter (where ${eventAttendees.status} = 'attended')`),
        noShow: int(sql`count(*) filter (where ${eventAttendees.status} = 'no_show')`),
        pastRegistrations: int(sql`count(*) filter (where ${eventAttendees.status} <> 'cancelled' and ${events.endsAt} < ${nowIso}::timestamptz)`),
        pastAttended: int(sql`count(*) filter (where ${eventAttendees.status} = 'attended' and ${events.endsAt} < ${nowIso}::timestamptz)`),
      })
      .from(eventAttendees)
      .innerJoin(events, eq(events.id, eventAttendees.eventId))
      .where(eventScope),
    db
      .select({
        delivered: int(sql`count(*) filter (where ${messages.status} in ('sent', 'simulated'))`),
        opened: int(sql`count(*) filter (where ${messages.status} in ('sent', 'simulated') and ${messages.openedAt} is not null)`),
        clicked: int(sql`count(*) filter (where ${messages.status} in ('sent', 'simulated') and ${messages.clickedAt} is not null)`),
      })
      .from(messages)
      .innerJoin(broadcasts, eq(broadcasts.id, messages.broadcastId))
      .where(eq(broadcasts.campaignId, campaignId)),
    db.select({ n: count() }).from(broadcasts).where(eq(broadcasts.campaignId, campaignId)),
    campaign.utmCampaign
      ? db.select({ n: count() }).from(contacts).where(sql`${contacts.utm} ->> 'campaign' = ${campaign.utmCampaign}`)
      : Promise.resolve([{ n: 0 }]),
  ]);

  const registrations = att?.registrations ?? 0;
  const attended = att?.attended ?? 0;
  const noShow = att?.noShow ?? 0;
  const delivered = mail?.delivered ?? 0;
  return {
    events: Number(ev?.n ?? 0),
    registrations,
    attended,
    noShow,
    showUpRate: ratio(attended, attended + noShow),
    attendanceRate: ratio(att?.pastAttended ?? 0, att?.pastRegistrations ?? 0),
    emailsDelivered: delivered,
    emailsOpened: mail?.opened ?? 0,
    emailsClicked: mail?.clicked ?? 0,
    openRate: ratio(mail?.opened ?? 0, delivered),
    clickRate: ratio(mail?.clicked ?? 0, delivered),
    broadcasts: Number(bc?.n ?? 0),
    attributedContacts: Number(attributed?.n ?? 0),
    budget: campaign.budget,
    costPerRegistration: campaign.budget != null && registrations > 0 ? campaign.budget / registrations : null,
  };
}

export type CampaignListRow = {
  campaign: Campaign;
  events: number;
  registrations: number;
  attendanceRate: number | null;
};

export async function listCampaignsWithStats(opts: { status?: string; q?: string } = {}): Promise<CampaignListRow[]> {
  const rows = await db
    .select()
    .from(campaigns)
    .where(
      and(
        opts.status && opts.status !== "all" ? eq(campaigns.status, opts.status as CampaignStatus) : undefined,
        opts.q?.trim() ? ilike(campaigns.name, `%${opts.q.trim().replace(/[%_\\]/g, "\\$&")}%`) : undefined,
      ),
    )
    .orderBy(sql`${campaigns.startDate} desc nulls last`, desc(campaigns.createdAt));
  if (!rows.length) return [];
  const nowIso = new Date().toISOString();
  const stats = await db
    .select({
      campaignId: events.campaignId,
      events: int(sql`count(distinct ${events.id})`),
      registrations: int(sql`count(${eventAttendees.id}) filter (where ${eventAttendees.status} <> 'cancelled')`),
      pastRegistrations: int(sql`count(${eventAttendees.id}) filter (where ${eventAttendees.status} <> 'cancelled' and ${events.endsAt} < ${nowIso}::timestamptz)`),
      pastAttended: int(sql`count(${eventAttendees.id}) filter (where ${eventAttendees.status} = 'attended' and ${events.endsAt} < ${nowIso}::timestamptz)`),
    })
    .from(events)
    .leftJoin(eventAttendees, eq(eventAttendees.eventId, events.id))
    .where(and(inArray(events.campaignId, rows.map((r) => r.id)), eq(events.kind, "event"), ne(events.status, "cancelled")))
    .groupBy(events.campaignId);
  const byId = new Map(stats.map((s) => [s.campaignId, s]));
  return rows.map((campaign) => {
    const s = byId.get(campaign.id);
    return {
      campaign,
      events: s?.events ?? 0,
      registrations: s?.registrations ?? 0,
      attendanceRate: ratio(s?.pastAttended ?? 0, s?.pastRegistrations ?? 0),
    };
  });
}

/** Events of a campaign (soonest first) with their attendee stats. */
export async function campaignEvents(campaignId: string) {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.campaignId, campaignId), eq(events.kind, "event")))
    .orderBy(desc(events.startsAt));
  const stats = await eventStatsMap(rows.map((r) => r.id));
  return rows.map((event) => ({ event, stats: stats.get(event.id)! }));
}

/** Broadcasts linked to a campaign with delivery/open/click counts. */
export async function campaignBroadcasts(campaignId: string) {
  const rows = await db.select().from(broadcasts).where(eq(broadcasts.campaignId, campaignId)).orderBy(desc(broadcasts.createdAt));
  if (!rows.length) return [];
  const stats = await db
    .select({
      broadcastId: messages.broadcastId,
      delivered: int(sql`count(*) filter (where ${messages.status} in ('sent', 'simulated'))`),
      opened: int(sql`count(*) filter (where ${messages.status} in ('sent', 'simulated') and ${messages.openedAt} is not null)`),
      clicked: int(sql`count(*) filter (where ${messages.status} in ('sent', 'simulated') and ${messages.clickedAt} is not null)`),
    })
    .from(messages)
    .where(inArray(messages.broadcastId, rows.map((r) => r.id)))
    .groupBy(messages.broadcastId);
  const byId = new Map(stats.map((s) => [s.broadcastId, s]));
  return rows.map((broadcast) => {
    const s = byId.get(broadcast.id);
    return {
      broadcast,
      delivered: s?.delivered ?? 0,
      openRate: ratio(s?.opened ?? 0, s?.delivered ?? 0),
      clickRate: ratio(s?.clicked ?? 0, s?.delivered ?? 0),
    };
  });
}

/** Contacts tied to the campaign (registered for one of its events, or attributed via utm_campaign). */
export async function campaignContacts(campaignId: string, limit = 25) {
  const where = await audienceWhere({ type: "campaign", campaignId });
  const [[total], emailable, rows] = await Promise.all([
    db.select({ n: count() }).from(contacts).where(where),
    countAudience({ type: "campaign", campaignId }),
    db
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        company: contacts.company,
        stage: contacts.stage,
        emailStatus: contacts.emailStatus,
        source: contacts.source,
      })
      .from(contacts)
      .where(where)
      .orderBy(desc(contacts.lastActivityAt), asc(contacts.email))
      .limit(limit),
  ]);
  return { total: Number(total?.n ?? 0), emailable, rows };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

const dateOrEmpty = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date"), z.literal("")]).nullish();

export const campaignSchema = z
  .object({
    name: z.string().trim().min(1, "Give the campaign a name").max(120),
    description: z.string().trim().max(5000).nullish(),
    type: z.enum(["event_series", "webinar", "email", "conference", "outreach", "social", "ads", "other"]),
    status: z.enum(["planned", "active", "completed", "archived"]),
    startDate: dateOrEmpty,
    endDate: dateOrEmpty,
    goal: z.string().trim().max(500).nullish(),
    budget: z.number().int("Budget must be a whole number").min(0, "Budget can't be negative").max(1_000_000_000).nullable(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color"),
    utmCampaign: z.string().trim().max(100).nullish(),
    ownerId: z.union([z.uuid(), z.literal("")]).nullish(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, { path: ["endDate"], message: "The end date must be on or after the start date" });

export type CampaignInput = z.input<typeof campaignSchema>;

const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

export type SaveCampaignResult =
  | { ok: true; campaign: Campaign }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

export async function saveCampaign(args: { id?: string | null; values: unknown }): Promise<SaveCampaignResult> {
  const parsed = campaignSchema.safeParse(args.values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) (fieldErrors[i.path.join(".") || "_"] ??= []).push(i.message);
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input", fieldErrors };
  }
  const v = parsed.data;
  const row = {
    name: v.name,
    description: blank(v.description),
    type: v.type,
    status: v.status,
    startDate: blank(v.startDate),
    endDate: blank(v.endDate),
    goal: blank(v.goal),
    budget: v.budget,
    color: v.color,
    utmCampaign: blank(v.utmCampaign),
    ownerId: blank(v.ownerId),
  };
  if (args.id) {
    const [campaign] = await db.update(campaigns).set(row).where(eq(campaigns.id, args.id)).returning();
    if (!campaign) return { ok: false, error: "Campaign not found" };
    return { ok: true, campaign };
  }
  const [campaign] = await db.insert(campaigns).values(row).returning();
  return { ok: true, campaign };
}

/** Delete a campaign; its events and broadcasts stay (the link is cleared). */
export async function deleteCampaign(id: string) {
  const removed = await db.delete(campaigns).where(eq(campaigns.id, id)).returning({ id: campaigns.id });
  return removed.length > 0;
}
