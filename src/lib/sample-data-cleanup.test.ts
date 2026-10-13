import { describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { setupTestDb } from "@/test/setup-db";

const { db } = await setupTestDb();
const s = await import("@/lib/db/schema");
const { getSetting } = await import("@/lib/settings");
const { deleteSampleData, getSampleDataCounts, recordSampleIds } = await import("./sample-data-cleanup");
const { DEFAULT_EVENT_NOTIFICATIONS } = await import("@/lib/types");

async function seed() {
  const [a, b, real] = await db
    .insert(s.contacts)
    .values([
      { email: "sample-a@example.com", firstName: "Sam", lastName: "Ple" },
      { email: "sample-b@example.com", firstName: "Sue", lastName: "Ple" },
      { email: "real@example.com", firstName: "Real", lastName: "Person" },
    ])
    .returning();
  const [tag, realTag] = await db.insert(s.tags).values([{ name: "Sample data" }, { name: "VIP" }]).returning();
  await db.insert(s.contactTags).values([
    { contactId: a.id, tagId: tag.id },
    { contactId: a.id, tagId: realTag.id },
    { contactId: real.id, tagId: realTag.id },
  ]);
  await db.insert(s.activities).values([
    { contactId: a.id, type: "note", title: "n1" },
    { contactId: real.id, type: "note", title: "keep me" },
  ]);
  const [campaign] = await db.insert(s.campaigns).values({ name: "Sample campaign" }).returning();
  const start = new Date(Date.now() + 864e5);
  const [event] = await db
    .insert(s.events)
    .values({ title: "Sample event", startsAt: start, endsAt: new Date(start.getTime() + 36e5), notifications: DEFAULT_EVENT_NOTIFICATIONS, campaignId: campaign.id })
    .returning();
  await db.insert(s.eventAttendees).values([
    { eventId: event.id, contactId: a.id },
    { eventId: event.id, contactId: real.id },
  ]);
  await db.insert(s.activities).values({ contactId: real.id, type: "event_registered", title: "registered for sample event", eventId: event.id });
  await db.insert(s.pageViews).values({ kind: "event", targetId: event.id, visitorHash: "h" });
  const [page] = await db.insert(s.bookingPages).values({ slug: "sample-call", title: "Sample call", notifications: DEFAULT_EVENT_NOTIFICATIONS }).returning();
  await db.insert(s.leadCaptures).values({ contactId: real.id, kind: "booking", targetId: page.id });
  const [tpl] = await db.insert(s.emailTemplates).values({ name: "Sample template" }).returning();
  const [system] = await db.select().from(s.emailTemplates).where(eq(s.emailTemplates.systemKey, "event_confirmation"));
  const [broadcast] = await db.insert(s.broadcasts).values({ name: "Sample broadcast", templateId: tpl.id, campaignId: campaign.id }).returning();
  await db.insert(s.messages).values([
    { contactId: a.id, toEmail: "sample-a@example.com", fromEmail: "x@y.z", subject: "s", html: "", broadcastId: broadcast.id },
    { contactId: real.id, toEmail: "real@example.com", fromEmail: "x@y.z", subject: "keep", html: "" },
  ]);
  const [automation] = await db
    .insert(s.automations)
    .values({ name: "Sample automation", trigger: { type: "contact_created", config: {} }, steps: [] })
    .returning();
  await db.insert(s.automationRuns).values({ automationId: automation.id, contactId: b.id });
  const [task] = await db.insert(s.tasks).values({ title: "Sample task", contactId: real.id }).returning();
  const [view] = await db.insert(s.savedViews).values({ name: "Sample view", filters: { match: "all", filters: [] } }).returning();
  await db.insert(s.jobs).values({ type: "broadcast.send", payload: { broadcastId: broadcast.id }, dedupeKey: `broadcast:${broadcast.id}`, runAt: new Date(Date.now() + 36e5) });

  const ids = {
    contacts: [a.id, b.id],
    tags: [tag.id],
    campaigns: [campaign.id],
    events: [event.id],
    booking_pages: [page.id],
    email_templates: [tpl.id, system.id],
    broadcasts: [broadcast.id],
    automations: [automation.id],
    tasks: [task.id],
    saved_views: [view.id],
  };
  for (const [table, list] of Object.entries(ids)) await recordSampleIds(table, list);
  return { ids, real, realTag, system, event };
}

describe("deleteSampleData", () => {
  it("is a no-op when nothing was recorded", async () => {
    expect(await getSampleDataCounts()).toEqual({});
    expect(await deleteSampleData()).toEqual({});
  });

  it("deletes recorded rows in FK order, keeps everything else and clears the setting", async () => {
    const { ids, real, realTag, system, event } = await seed();
    expect(await getSampleDataCounts()).toMatchObject({ contacts: 2, tags: 1, email_templates: 2 });

    const removed = await deleteSampleData();
    expect(removed).toMatchObject({ contacts: 2, campaigns: 1, events: 1, booking_pages: 1, broadcasts: 1, automations: 1, tasks: 1, saved_views: 1, tags: 1 });
    // The built-in system template is protected even though its id was recorded.
    expect(removed.email_templates).toBe(1);

    expect(await db.select().from(s.contacts).where(inArray(s.contacts.id, ids.contacts))).toHaveLength(0);
    expect(await db.select().from(s.eventAttendees)).toHaveLength(0);
    expect(await db.select().from(s.automationRuns)).toHaveLength(0);
    expect(await db.select().from(s.events).where(eq(s.events.id, event.id))).toHaveLength(0);
    expect(await db.select().from(s.pageViews)).toHaveLength(0);
    expect(await db.select().from(s.leadCaptures)).toHaveLength(0);
    expect(await db.select().from(s.broadcasts)).toHaveLength(0);
    expect(await db.select().from(s.savedViews)).toHaveLength(0);
    expect(await db.select().from(s.jobs).where(eq(s.jobs.type, "broadcast.send"))).toHaveLength(0);

    // Real data survives: contact, its tag link, its note and its own message; the event-linked activity is gone.
    const [keep] = await db.select().from(s.contacts).where(eq(s.contacts.id, real.id));
    expect(keep.email).toBe("real@example.com");
    expect((await db.select().from(s.contactTags)).map((l) => l.tagId)).toEqual([realTag.id]);
    expect((await db.select().from(s.activities)).map((x) => x.title)).toEqual(["keep me"]);
    expect((await db.select().from(s.messages)).map((m) => m.subject)).toEqual(["keep"]);
    expect(await db.select().from(s.tasks)).toHaveLength(0);
    expect((await db.select().from(s.emailTemplates).where(eq(s.emailTemplates.id, system.id))).length).toBe(1);

    expect((await getSetting("sampleData")).ids).toEqual({});
    // idempotent
    expect(await deleteSampleData()).toEqual({});
  });

  it("ignores malformed ids and unknown tables", async () => {
    await recordSampleIds("contacts", ["not-a-uuid", "'; drop table contacts; --"]);
    await recordSampleIds("users", ["00000000-0000-4000-8000-000000000000"]);
    expect(await deleteSampleData()).toEqual({});
  });
});
