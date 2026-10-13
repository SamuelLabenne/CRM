import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  automations,
  bookingPages,
  broadcasts,
  campaigns,
  contacts,
  emailTemplates,
  events,
  jobs,
  leadCaptures,
  messages,
  pageViews,
  activities,
  savedViews,
  tags,
  tasks,
} from "@/lib/db/schema";
import { getSetting, setSetting } from "@/lib/settings";

// ---------------------------------------------------------------------------
// Removes the demo rows created by the sample-data loader. The loader records the
// ids of every row it creates, per table, in the "sampleData" setting.
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK = 500;

export type SampleDataCounts = Record<string, number>;

function clean(ids: string[] | undefined): string[] {
  return [...new Set((ids ?? []).filter((id) => typeof id === "string" && UUID_RE.test(id)))];
}

function chunks<T>(list: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Number of recorded sample rows per table (empty object when there is none). */
export async function getSampleDataCounts(): Promise<SampleDataCounts> {
  const { ids } = await getSetting("sampleData");
  const out: SampleDataCounts = {};
  for (const [table, list] of Object.entries(ids ?? {})) {
    const n = clean(list).length;
    if (n) out[table] = n;
  }
  return out;
}

/** Record sample row ids for a table (used by the sample-data loader). */
export async function recordSampleIds(table: string, newIds: string[]): Promise<void> {
  const current = (await getSetting("sampleData")).ids ?? {};
  await setSetting("sampleData", { ids: { ...current, [table]: [...new Set([...(current[table] ?? []), ...newIds])] } });
}

/**
 * Delete every recorded sample row (children before parents) and clear the setting.
 * Safe to call repeatedly. Returns the number of rows removed per table.
 */
export async function deleteSampleData(): Promise<SampleDataCounts> {
  const { ids } = await getSetting("sampleData");
  const sample = {
    contacts: clean(ids?.contacts),
    campaigns: clean(ids?.campaigns),
    events: clean(ids?.events),
    booking_pages: clean(ids?.booking_pages),
    email_templates: clean(ids?.email_templates),
    broadcasts: clean(ids?.broadcasts),
    automations: clean(ids?.automations),
    tasks: clean(ids?.tasks),
    tags: clean(ids?.tags),
    saved_views: clean(ids?.saved_views),
  };
  const removed: SampleDataCounts = {};
  const count = (table: string, n: number) => {
    if (n) removed[table] = (removed[table] ?? 0) + n;
  };

  await db.transaction(async (tx) => {
    // Emails sent to / on behalf of sample rows (email_events cascade).
    for (const c of chunks(sample.contacts)) await tx.delete(messages).where(inArray(messages.contactId, c));
    for (const c of chunks(sample.broadcasts)) await tx.delete(messages).where(inArray(messages.broadcastId, c));
    for (const c of chunks(sample.automations)) await tx.delete(messages).where(inArray(messages.automationId, c));

    // Rows that reference sample events / booking pages without a foreign key.
    const targets = [...sample.events, ...sample.booking_pages];
    for (const c of chunks(targets)) {
      await tx.delete(pageViews).where(inArray(pageViews.targetId, c));
      await tx.delete(leadCaptures).where(inArray(leadCaptures.targetId, c));
    }
    for (const c of chunks(sample.events)) await tx.delete(activities).where(inArray(activities.eventId, c));

    // Contacts cascade: activities, registrations, lead captures, contact tags, automation runs, tasks.
    for (const c of chunks(sample.contacts)) {
      const rows = await tx.delete(contacts).where(inArray(contacts.id, c)).returning({ id: contacts.id });
      count("contacts", rows.length);
    }
    // Events cascade: attendees.
    for (const c of chunks(sample.events)) {
      const rows = await tx.delete(events).where(inArray(events.id, c)).returning({ id: events.id });
      count("events", rows.length);
    }
    for (const c of chunks(sample.booking_pages)) {
      const rows = await tx.delete(bookingPages).where(inArray(bookingPages.id, c)).returning({ id: bookingPages.id });
      count("booking_pages", rows.length);
    }
    for (const c of chunks(sample.broadcasts)) {
      const rows = await tx.delete(broadcasts).where(inArray(broadcasts.id, c)).returning({ id: broadcasts.id });
      count("broadcasts", rows.length);
    }
    // Automations cascade: runs and logs.
    for (const c of chunks(sample.automations)) {
      const rows = await tx.delete(automations).where(inArray(automations.id, c)).returning({ id: automations.id });
      count("automations", rows.length);
    }
    // Built-in system templates are never removed.
    for (const c of chunks(sample.email_templates)) {
      const rows = await tx
        .delete(emailTemplates)
        .where(and(inArray(emailTemplates.id, c), isNull(emailTemplates.systemKey)))
        .returning({ id: emailTemplates.id });
      count("email_templates", rows.length);
    }
    for (const c of chunks(sample.campaigns)) {
      const rows = await tx.delete(campaigns).where(inArray(campaigns.id, c)).returning({ id: campaigns.id });
      count("campaigns", rows.length);
    }
    for (const c of chunks(sample.tasks)) {
      const rows = await tx.delete(tasks).where(inArray(tasks.id, c)).returning({ id: tasks.id });
      count("tasks", rows.length);
    }
    for (const c of chunks(sample.saved_views)) {
      const rows = await tx.delete(savedViews).where(inArray(savedViews.id, c)).returning({ id: savedViews.id });
      count("saved_views", rows.length);
    }
    // Tags cascade: contact_tags.
    for (const c of chunks(sample.tags)) {
      const rows = await tx.delete(tags).where(inArray(tags.id, c)).returning({ id: tags.id });
      count("tags", rows.length);
    }

    // Scheduled broadcast sends for deleted broadcasts (other job handlers ignore missing rows).
    for (const c of chunks(sample.broadcasts)) {
      await tx.delete(jobs).where(
        and(eq(jobs.status, "pending"), inArray(jobs.dedupeKey, c.map((id) => `broadcast:${id}`))),
      );
    }
  });

  await setSetting("sampleData", { ids: {} });
  return removed;
}
