import { and, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { audienceWhere, emailableWhere } from "@/lib/audience";
import { campaigns, contacts, events, savedViews, tags } from "@/lib/db/schema";
import { fullName } from "@/lib/format";
import type { Audience } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  registered: "registered",
  confirmed: "confirmed",
  waitlisted: "waitlisted",
  attended: "attended",
  no_show: "no-show",
  cancelled: "cancelled",
};

/** One-line, human readable descriptions of audiences (batched lookups for lists). */
export async function describeAudiences(list: Audience[]): Promise<string[]> {
  const viewIds = new Set<string>();
  const tagIds = new Set<string>();
  const eventIds = new Set<string>();
  const campaignIds = new Set<string>();
  for (const a of list) {
    if (a.type === "view") viewIds.add(a.viewId);
    if (a.type === "tags") a.tagIds.forEach((t) => tagIds.add(t));
    if (a.type === "event") eventIds.add(a.eventId);
    if (a.type === "campaign") campaignIds.add(a.campaignId);
  }
  const [viewRows, tagRows, eventRows, campaignRows] = await Promise.all([
    viewIds.size ? db.select({ id: savedViews.id, name: savedViews.name }).from(savedViews).where(inArray(savedViews.id, [...viewIds])) : [],
    tagIds.size ? db.select({ id: tags.id, name: tags.name }).from(tags).where(inArray(tags.id, [...tagIds])) : [],
    eventIds.size ? db.select({ id: events.id, title: events.title }).from(events).where(inArray(events.id, [...eventIds])) : [],
    campaignIds.size ? db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns).where(inArray(campaigns.id, [...campaignIds])) : [],
  ]);
  const views = new Map(viewRows.map((v) => [v.id, v.name]));
  const tagMap = new Map(tagRows.map((t) => [t.id, t.name]));
  const eventMap = new Map(eventRows.map((e) => [e.id, e.title]));
  const campaignMap = new Map(campaignRows.map((c) => [c.id, c.name]));

  return list.map((a) => {
    switch (a.type) {
      case "all":
        return "All subscribed contacts";
      case "view":
        return `Smart view: ${views.get(a.viewId) ?? "(deleted view)"}`;
      case "filter": {
        const n = a.filter.filters.length;
        return n ? `Filtered contacts (${n} condition${n === 1 ? "" : "s"})` : "All subscribed contacts";
      }
      case "tags": {
        const names = a.tagIds.map((id) => tagMap.get(id)).filter(Boolean) as string[];
        if (!names.length) return "Tagged contacts";
        return `Tagged ${names.join(a.match === "all" ? " + " : " or ")}`;
      }
      case "event": {
        const title = eventMap.get(a.eventId) ?? "(deleted event)";
        const st = a.statuses.length ? a.statuses.map((s) => STATUS_LABEL[s] ?? s).join(", ") : "all registrations";
        return `${title} · ${st}`;
      }
      case "campaign":
        return `Campaign: ${campaignMap.get(a.campaignId) ?? "(deleted campaign)"}`;
      case "contacts":
        return `${a.contactIds.length} selected contact${a.contactIds.length === 1 ? "" : "s"}`;
    }
  });
}

export async function describeAudience(a: Audience): Promise<string> {
  return (await describeAudiences([a]))[0];
}

export type AudiencePreview = {
  /** Contacts that will receive the email (subscribed, with an email address). */
  count: number;
  /** Contacts matching the audience before removing unsubscribed/bounced/no-email ones. */
  matching: number;
  sample: { id: string; name: string; email: string | null }[];
};

/** Recipient count, how many matches are excluded, and a few sample recipients. */
export async function previewAudience(audience: Audience, sampleSize = 5): Promise<AudiencePreview> {
  const where = await audienceWhere(audience);
  const [totals] = await db
    .select({
      matching: sql<number>`count(*)::int`,
      count: sql<number>`(count(*) filter (where ${contacts.email} is not null and ${contacts.emailStatus} = 'subscribed'))::int`,
    })
    .from(contacts)
    .where(where);
  const sampleRows = sampleSize
    ? await db
        .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email })
        .from(contacts)
        .where(and(emailableWhere, where))
        .orderBy(contacts.createdAt)
        .limit(sampleSize)
    : [];
  return {
    count: totals?.count ?? 0,
    matching: totals?.matching ?? 0,
    sample: sampleRows.map((r) => ({ id: r.id, name: fullName(r), email: r.email })),
  };
}

/** Names of specific contacts (for the "specific contacts" audience editor). */
export async function lookupContacts(ids: string[]) {
  if (!ids.length) return [];
  const rows = await db
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email })
    .from(contacts)
    .where(inArray(contacts.id, ids.slice(0, 500)));
  return rows.map((r) => ({ id: r.id, name: fullName(r), email: r.email }));
}
