import { and, eq, inArray, isNotNull, ne, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, contactTags, contacts, eventAttendees, events, savedViews } from "@/lib/db/schema";
import { buildContactWhere } from "@/lib/contacts/filters";
import type { Audience } from "@/lib/types";

/** SQL condition selecting the contacts in an audience (before email eligibility filtering). */
export async function audienceWhere(audience: Audience): Promise<SQL | undefined> {
  switch (audience.type) {
    case "all":
      return undefined;
    case "view": {
      const [view] = await db.select().from(savedViews).where(eq(savedViews.id, audience.viewId));
      if (!view) return sql`false`;
      return buildContactWhere(view.filters) ?? undefined;
    }
    case "filter":
      return buildContactWhere(audience.filter);
    case "tags": {
      if (!audience.tagIds.length) return sql`false`;
      if (audience.match === "all") {
        return sql`(select count(distinct ${contactTags.tagId}) from ${contactTags} where ${contactTags.contactId} = ${contacts.id} and ${inArray(contactTags.tagId, audience.tagIds)}) = ${audience.tagIds.length}`;
      }
      return sql`exists (select 1 from ${contactTags} where ${contactTags.contactId} = ${contacts.id} and ${inArray(contactTags.tagId, audience.tagIds)})`;
    }
    case "event": {
      const statuses = audience.statuses.length ? audience.statuses : null;
      return sql`exists (select 1 from ${eventAttendees} where ${eventAttendees.contactId} = ${contacts.id} and ${eventAttendees.eventId} = ${audience.eventId} ${
        statuses ? sql`and ${inArray(eventAttendees.status, statuses)}` : sql`and ${ne(eventAttendees.status, "cancelled")}`
      })`;
    }
    case "campaign": {
      // Registered for any event in the campaign, or attributed via utm_campaign.
      const [c] = await db.select().from(campaigns).where(eq(campaigns.id, audience.campaignId));
      if (!c) return sql`false`;
      const viaEvents = sql`exists (select 1 from ${eventAttendees} join ${events} on ${events.id} = ${eventAttendees.eventId} where ${eventAttendees.contactId} = ${contacts.id} and ${events.campaignId} = ${c.id} and ${ne(eventAttendees.status, "cancelled")})`;
      return c.utmCampaign ? sql`(${viaEvents} or ${contacts.utm} ->> 'campaign' = ${c.utmCampaign})` : viaEvents;
    }
    case "contacts":
      return audience.contactIds.length ? inArray(contacts.id, audience.contactIds) : sql`false`;
  }
}

/** Contacts that can receive marketing email: have an email and are subscribed. */
export const emailableWhere = and(isNotNull(contacts.email), eq(contacts.emailStatus, "subscribed"));

/** Resolve an audience to the list of emailable contacts. */
export async function resolveAudience(audience: Audience) {
  const where = await audienceWhere(audience);
  return db
    .select({ id: contacts.id, email: contacts.email, firstName: contacts.firstName, lastName: contacts.lastName })
    .from(contacts)
    .where(and(emailableWhere, where));
}

export async function countAudience(audience: Audience): Promise<number> {
  const where = await audienceWhere(audience);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(and(emailableWhere, where));
  return row?.n ?? 0;
}
