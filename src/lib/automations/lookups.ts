import { desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingPages, campaigns, customFieldDefs, emailTemplates, events, savedViews, tags, users } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings";
import type { AutomationStep, AutomationTrigger } from "@/lib/types";
import type { BuilderLookups, NameLookups } from "./meta";

export type { BuilderLookups } from "./meta";

export async function loadBuilderLookups(
  automation?: { trigger: AutomationTrigger; steps?: AutomationStep[] },
): Promise<BuilderLookups> {
  const referencedEvent = automation?.trigger.config?.eventId;
  const [workspace, stages, tagRows, eventRows, campaignRows, pageRows, templateRows, userRows, fieldRows, viewRows, extraEvent] =
    await Promise.all([
      getSetting("workspace"),
      getSetting("stages"),
      db.select().from(tags).orderBy(tags.name),
      db
        .select({ id: events.id, title: events.title, startsAt: events.startsAt, kind: events.kind })
        .from(events)
        .orderBy(desc(events.startsAt))
        .limit(300),
      db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns).orderBy(campaigns.name),
      db.select({ id: bookingPages.id, title: bookingPages.title }).from(bookingPages).orderBy(bookingPages.title),
      db
        .select({ id: emailTemplates.id, name: emailTemplates.name, subject: emailTemplates.subject, systemKey: emailTemplates.systemKey })
        .from(emailTemplates)
        .orderBy(emailTemplates.name),
      db.select({ id: users.id, name: users.name, deactivatedAt: users.deactivatedAt }).from(users).orderBy(users.name),
      db.select({ key: customFieldDefs.key, label: customFieldDefs.label }).from(customFieldDefs).orderBy(customFieldDefs.position),
      db.select({ id: savedViews.id, name: savedViews.name }).from(savedViews).orderBy(savedViews.name),
      referencedEvent
        ? db
            .select({ id: events.id, title: events.title, startsAt: events.startsAt, kind: events.kind })
            .from(events)
            .where(inArray(events.id, [referencedEvent]))
        : Promise.resolve([]),
    ]);
  const allEvents = [...eventRows];
  for (const e of extraEvent) if (!allEvents.some((x) => x.id === e.id)) allEvents.push(e);
  return {
    timezone: workspace.timezone,
    tags: tagRows.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    stages,
    events: allEvents.map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt.toISOString(), kind: e.kind })),
    campaigns: campaignRows,
    bookingPages: pageRows,
    templates: templateRows.map((t) => ({ id: t.id, name: t.name, subject: t.subject, system: Boolean(t.systemKey) })),
    users: userRows.filter((u) => !u.deactivatedAt).map((u) => ({ id: u.id, name: u.name })),
    customFields: fieldRows,
    views: viewRows,
  };
}

/** Lighter variant for the list page: only what trigger summaries and step counts need. */
export async function loadTriggerNames(triggers: AutomationTrigger[]): Promise<NameLookups> {
  const eventIds = [...new Set(triggers.map((t) => t.config?.eventId).filter((x): x is string => Boolean(x)))];
  const [tagRows, stages, campaignRows, pageRows, eventRows] = await Promise.all([
    db.select({ id: tags.id, name: tags.name }).from(tags),
    getSetting("stages"),
    db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns),
    db.select({ id: bookingPages.id, name: bookingPages.title }).from(bookingPages),
    eventIds.length ? db.select({ id: events.id, title: events.title }).from(events).where(inArray(events.id, eventIds)) : Promise.resolve([]),
  ]);
  return {
    tags: Object.fromEntries(tagRows.map((t) => [t.id, t.name])),
    stages: Object.fromEntries(stages.map((s) => [s.key, s.label])),
    campaigns: Object.fromEntries(campaignRows.map((c) => [c.id, c.name])),
    bookingPages: Object.fromEntries(pageRows.map((p) => [p.id, p.name])),
    events: Object.fromEntries(eventRows.map((e) => [e.id, e.title])),
  };
}
