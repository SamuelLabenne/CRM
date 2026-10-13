import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import Papa from "papaparse";
import { setupTestDb, createTestUser } from "@/test/setup-db";

const { db } = await setupTestDb();
const schema = await import("@/lib/db/schema");
const { contacts, activities, contactTags, customFieldDefs, events, eventAttendees, tags } = schema;
const { upsertContact, ensureTag, addTagToContact } = await import("@/lib/contacts");
const { buildContactWhere } = await import("@/lib/contacts/filters");
const { listContacts, resolveSelection, mergeQuickIntoGroup, contactQueryWhere } = await import("@/lib/contacts/query");
const { createContact, updateContact, setContactTags, ContactConflictError, ContactValidationError } = await import("@/lib/contacts/update");
const { bulkAddTag, bulkRemoveTag, bulkChangeStage, bulkAssignOwner, bulkAddToEvent, bulkDelete } = await import("@/lib/contacts/bulk");
const { importContactsChunk } = await import("@/lib/contacts/import");
const { buildContactsCsv } = await import("@/lib/contacts/export");
const { registerForEvent } = await import("@/lib/events/registration");
const { DEFAULT_EVENT_NOTIFICATIONS } = await import("@/lib/types");

const actor = await createTestUser({ name: "Alex Owner" });

async function ids(where: ReturnType<typeof buildContactWhere>) {
  const rows = await db.select({ email: contacts.email }).from(contacts).where(where);
  return rows.map((r) => r.email).sort();
}

async function makeEvent(title: string, capacity: number | null = null, waitlist = false) {
  const start = new Date(Date.now() + 3 * 864e5);
  const [e] = await db
    .insert(events)
    .values({ title, startsAt: start, endsAt: new Date(start.getTime() + 36e5), capacity, waitlistEnabled: waitlist, notifications: DEFAULT_EVENT_NOTIFICATIONS })
    .returning();
  return e;
}

describe("filter → SQL", () => {
  it("handles utm, custom fields (numbers, dates, multi-select), dates and tags", async () => {
    await db.insert(customFieldDefs).values([
      { key: "budget", label: "Budget", type: "number" },
      { key: "renewal", label: "Renewal", type: "date" },
      { key: "interests", label: "Interests", type: "multiselect", options: ["Events", "Email"] },
      { key: "notes_text", label: "Free text", type: "text" },
    ]);
    const vip = await ensureTag("VIP");
    const a = (await upsertContact({ email: "f-a@x.io", firstName: "A", company: "Acme", dealValue: 5000, utm: { source: "linkedin", campaign: "spring" }, customFields: { budget: 100, renewal: "2020-01-15", interests: ["Events"], notes_text: "hello" } }, { source: "manual" })).contact;
    await upsertContact({ email: "f-b@x.io", firstName: "B", company: "Beta", dealValue: 100, utm: { source: "google" }, customFields: { budget: 2500, renewal: "2099-01-01", interests: ["Email", "Events"], notes_text: "not a number" } }, { source: "import" });
    await upsertContact({ email: "f-c@x.io", firstName: "C" }, { source: "manual" });
    await addTagToContact(a.id, vip.id);

    expect(await ids(buildContactWhere({ match: "all", filters: [{ field: "utm_source", operator: "is", value: "LinkedIn" }] }))).toEqual(["f-a@x.io"]);
    expect(await ids(buildContactWhere({ match: "all", filters: [{ field: "utm_campaign", operator: "is_empty" }, { field: "email", operator: "contains", value: "f-" }] }))).toEqual(["f-b@x.io", "f-c@x.io"]);
    expect(await ids(buildContactWhere({ match: "all", filters: [{ field: "deal_value", operator: "gt", value: 1000 }] }))).toEqual(["f-a@x.io"]);
    expect(await ids(buildContactWhere({ match: "all", filters: [{ field: "deal_value", operator: "is_empty" }, { field: "email", operator: "contains", value: "f-" }] }))).toEqual(["f-c@x.io"]);
    // numeric comparison on custom fields must not blow up on non-numeric text values
    expect(await ids(buildContactWhere({ match: "all", filters: [{ field: "custom:budget", operator: "gt", value: 1000 }] }))).toEqual(["f-b@x.io"]);
    expect(await ids(buildContactWhere({ match: "all", filters: [{ field: "custom:notes_text", operator: "gt", value: 1 }] }))).toEqual([]);
    expect(await ids(buildContactWhere({ match: "all", filters: [{ field: "custom:renewal", operator: "before", value: "2024-01-01" }] }))).toEqual(["f-a@x.io"]);
    expect(await ids(buildContactWhere({ match: "all", filters: [{ field: "custom:renewal", operator: "after", value: "2024-01-01" }] }))).toEqual(["f-b@x.io"]);
    expect(await ids(buildContactWhere({ match: "all", filters: [{ field: "custom:interests", operator: "contains", value: "Email" }] }))).toEqual(["f-b@x.io"]);
    expect(await ids(buildContactWhere({ match: "all", filters: [{ field: "custom:interests", operator: "is_empty" }, { field: "email", operator: "contains", value: "f-" }] }))).toEqual(["f-c@x.io"]);
    expect(await ids(buildContactWhere({ match: "all", filters: [{ field: "tag", operator: "has_not", value: vip.id }, { field: "email", operator: "contains", value: "f-" }] }))).toEqual(["f-b@x.io", "f-c@x.io"]);
    expect(await ids(buildContactWhere({ match: "any", filters: [{ field: "company", operator: "is", value: "acme" }, { field: "source", operator: "is", value: "import" }] }))).toEqual(["f-a@x.io", "f-b@x.io"]);
    expect(await ids(buildContactWhere({ match: "all", filters: [{ field: "created_at", operator: "in_last_days", value: 1 }, { field: "email", operator: "contains", value: "f-" }] }))).toHaveLength(3);
  });

  it("supports multi-value is / is_not and ignores unparsable dates instead of throwing", async () => {
    expect(await ids(buildContactWhere({ match: "all", filters: [{ field: "source", operator: "is", value: ["import", "api"] }, { field: "email", operator: "contains", value: "f-" }] }))).toEqual(["f-b@x.io"]);
    expect(await ids(buildContactWhere({ match: "all", filters: [{ field: "source", operator: "is_not", value: ["import", "api"] }, { field: "email", operator: "contains", value: "f-" }] }))).toEqual(["f-a@x.io", "f-c@x.io"]);
    expect(await ids(buildContactWhere({ match: "all", filters: [{ field: "created_at", operator: "before", value: "garbage" }, { field: "email", operator: "contains", value: "f-" }] }))).toHaveLength(3);
  });

  it("filters by event registration and attendance", async () => {
    const e = await makeEvent("Filter webinar");
    const a = (await upsertContact({ email: "ev-a@x.io" }, { source: "manual" })).contact;
    const b = (await upsertContact({ email: "ev-b@x.io" }, { source: "manual" })).contact;
    await upsertContact({ email: "ev-c@x.io" }, { source: "manual" });
    await registerForEvent({ eventId: e.id, contactId: a.id, source: "manual", silent: true });
    const rb = await registerForEvent({ eventId: e.id, contactId: b.id, source: "manual", silent: true });
    await db.update(eventAttendees).set({ status: "attended" }).where(eq(eventAttendees.id, rb.attendee.id));
    const evFilter = (field: string, operator: "has" | "has_not") => buildContactWhere({ match: "all", filters: [{ field, operator, value: e.id }, { field: "email", operator: "contains", value: "ev-" }] });
    expect(await ids(evFilter("event", "has"))).toEqual(["ev-a@x.io", "ev-b@x.io"]);
    expect(await ids(evFilter("attended_event", "has"))).toEqual(["ev-b@x.io"]);
    expect(await ids(evFilter("event", "has_not"))).toEqual(["ev-c@x.io"]);
  });
});

describe("listContacts & selection", () => {
  it("searches, filters, sorts and paginates; quick filters AND with the advanced filter", async () => {
    for (let i = 0; i < 7; i++) await upsertContact({ email: `list-${i}@y.io`, firstName: `Person${i}`, company: i % 2 ? "Odd Co" : "Even Co", stage: i < 3 ? "contacted" : "new" }, { source: "manual" });
    const q1 = await listContacts({ q: "person" }, { sort: "name", dir: "asc", pageSize: 3, page: 2 });
    expect(q1.total).toBe(7);
    expect(q1.pageCount).toBe(3);
    expect(q1.rows.map((r) => r.firstName)).toEqual(["Person3", "Person4", "Person5"]);
    const q2 = await listContacts({ q: "person", quick: { stage: "contacted" }, filter: { match: "all", filters: [{ field: "company", operator: "is", value: "Odd Co" }] } });
    expect(q2.rows.map((r) => r.email)).toEqual(["list-1@y.io"]);
    // page beyond the end clamps to the last page
    expect((await listContacts({ q: "person" }, { pageSize: 5, page: 99 })).page).toBe(2);
    const sel = await resolveSelection({ query: { q: "person", quick: { stage: "contacted" } } });
    expect(sel).toHaveLength(3);
    expect(await resolveSelection({ ids: ["a", "a", "b"] })).toEqual(["a", "b"]);
    expect(contactQueryWhere({})).toBeUndefined();
  });

  it("merges quick filters into a savable group", () => {
    expect(mergeQuickIntoGroup({ stage: "new" }, null)).toEqual({ match: "all", filters: [{ field: "stage", operator: "is", value: "new" }] });
    expect(mergeQuickIntoGroup({ owner: "none" }, { match: "all", filters: [{ field: "city", operator: "is", value: "Perth" }] })?.filters).toHaveLength(2);
    expect(mergeQuickIntoGroup({ stage: "new" }, { match: "any", filters: [{ field: "city", operator: "is", value: "A" }, { field: "city", operator: "is", value: "B" }] })).toBeNull();
    expect(mergeQuickIntoGroup(undefined, { match: "any", filters: [{ field: "city", operator: "is", value: "A" }, { field: "city", operator: "is", value: "B" }] })?.match).toBe("any");
  });
});

describe("create / update / tags", () => {
  it("creates contacts, refuses duplicates and logs updates", async () => {
    const c = await createContact({ firstName: "New", lastName: "Person", email: "NEW.person@z.io", company: "Z", tagNames: ["Lead", "lead", "Speaker"], customFields: { budget: 10 } }, { actorId: actor.id });
    expect(c.email).toBe("new.person@z.io");
    const tagRows = await db.select({ name: tags.name }).from(contactTags).innerJoin(tags, eq(tags.id, contactTags.tagId)).where(eq(contactTags.contactId, c.id));
    expect(tagRows.map((t) => t.name).sort()).toEqual(["Lead", "Speaker"]);

    await expect(createContact({ firstName: "Dup", email: "new.person@z.io" }, {})).rejects.toBeInstanceOf(ContactConflictError);
    await expect(createContact({ firstName: "Bad", email: "nope" }, {})).rejects.toBeInstanceOf(ContactValidationError);
    await expect(createContact({}, {})).rejects.toBeInstanceOf(ContactValidationError);

    const res = await updateContact(c.id, { company: "Zeta", phone: "+61 400 000 111", dealValue: 900, stage: "engaged", customFields: { budget: null, plan: "Pro" } }, { actorId: actor.id });
    expect(res?.changed.sort()).toEqual(["company", "customFields", "dealValue", "phone", "stage"]);
    expect(res?.contact).toMatchObject({ company: "Zeta", phone: "+61400000111", dealValue: 900, stage: "engaged", customFields: { plan: "Pro" } });
    const acts = await db.select().from(activities).where(eq(activities.contactId, c.id));
    expect(acts.some((a) => a.type === "contact_updated" && a.actorId === actor.id && /company/i.test(a.title))).toBe(true);
    expect(acts.some((a) => a.type === "stage_changed")).toBe(true);

    // no-op update logs nothing new
    const before = (await db.select().from(activities).where(eq(activities.contactId, c.id))).length;
    await updateContact(c.id, { company: "Zeta" });
    expect((await db.select().from(activities).where(eq(activities.contactId, c.id))).length).toBe(before);

    // can't steal another contact's email; can't blank every identifier
    const other = (await upsertContact({ email: "other@z.io" }, { source: "manual" })).contact;
    await expect(updateContact(c.id, { email: "other@z.io" })).rejects.toBeInstanceOf(ContactConflictError);
    await expect(updateContact(other.id, { email: null })).rejects.toBeInstanceOf(ContactValidationError);
  });

  it("sets tags by name (creating, adding and removing)", async () => {
    const c = (await upsertContact({ email: "tags@z.io" }, { source: "manual" })).contact;
    await setContactTags(c.id, ["Alpha", "Beta"], { actorId: actor.id });
    await setContactTags(c.id, ["beta", "Gamma"], { actorId: actor.id });
    const rows = await db.select({ name: tags.name }).from(contactTags).innerJoin(tags, eq(tags.id, contactTags.tagId)).where(eq(contactTags.contactId, c.id));
    expect(rows.map((r) => r.name).sort()).toEqual(["Beta", "Gamma"]);
    const acts = await db.select().from(activities).where(and(eq(activities.contactId, c.id), eq(activities.type, "tag_removed")));
    expect(acts).toHaveLength(1);
  });
});

describe("bulk actions", () => {
  it("tags, stages, owners, events and deletes", async () => {
    const people = [];
    for (let i = 0; i < 4; i++) people.push((await upsertContact({ email: `bulk-${i}@b.io` }, { source: "manual" })).contact);
    const idList = people.map((p) => p.id);

    const t = await bulkAddTag(idList, { name: "Bulk tag" }, actor.id);
    expect(t.affected).toBe(4);
    expect((await bulkAddTag(idList, { id: t.tagId! }, actor.id)).affected).toBe(0); // idempotent
    expect((await bulkRemoveTag(idList.slice(0, 2), t.tagId!, actor.id)).affected).toBe(2);

    expect((await bulkChangeStage(idList, "contacted", actor.id)).affected).toBe(4);
    expect((await bulkChangeStage(idList, "contacted", actor.id)).affected).toBe(0);

    expect((await bulkAssignOwner(idList, actor.id, actor.id)).affected).toBe(4);
    expect((await bulkAssignOwner(idList, actor.id, actor.id)).affected).toBe(0);
    expect((await db.select().from(contacts).where(eq(contacts.id, idList[0])))[0].ownerId).toBe(actor.id);
    expect((await bulkAssignOwner(idList.slice(0, 1), null, actor.id)).affected).toBe(1);

    const full = await makeEvent("Tiny event", 2, false);
    const r = await bulkAddToEvent(idList, full.id, { actorId: actor.id, silent: true });
    expect(r).toMatchObject({ registered: 2, full: 2, alreadyRegistered: 0, failed: 0 });
    expect((await bulkAddToEvent(idList.slice(0, 2), full.id, { actorId: actor.id, silent: true })).alreadyRegistered).toBe(2);
    const wl = await makeEvent("Waitlist event", 1, true);
    expect(await bulkAddToEvent(idList.slice(0, 3), wl.id, { silent: true })).toMatchObject({ registered: 1, waitlisted: 2, full: 0 });

    const regActs = await db.select().from(activities).where(and(eq(activities.contactId, idList[0]), eq(activities.type, "event_registered")));
    expect(regActs.length).toBeGreaterThan(0);
    expect((await bulkDelete(idList)).affected).toBe(4);
    expect(await db.select().from(contacts).where(eq(contacts.email, "bulk-0@b.io"))).toHaveLength(0);
  });
});

describe("CSV import", () => {
  it("creates, updates, skips and reports errors; applies tags/stage/custom fields", async () => {
    await upsertContact({ email: "imp-existing@c.io", firstName: "Old", company: "Keep Co" }, { source: "manual" });
    const rows = [
      { line: 2, firstName: "New", lastName: "One", email: "Imp-New@C.io", company: "NewCo", tags: ["Imported", "Webinar"], stage: "contacted", dealValue: 1200, customFields: { budget: 50, unknown_key: "x" } },
      { line: 3, firstName: "Updated", email: "imp-existing@c.io", company: "Overwritten Co", tags: ["Imported"] },
      { line: 4, company: "Nameless" },
      { line: 5, email: "not-an-email" },
      { line: 6, phone: "+61 411 222 333", firstName: "Phone", stage: "bogus-stage" },
    ];
    const res = await importContactsChunk(rows, { mode: "update", tagName: "Batch 1", actorId: actor.id });
    expect(res).toMatchObject({ created: 2, updated: 1, skipped: 0 });
    expect(res.errors.map((e) => e.line)).toEqual([4, 5]);

    const [created] = await db.select().from(contacts).where(eq(contacts.email, "imp-new@c.io"));
    expect(created).toMatchObject({ source: "import", stage: "contacted", dealValue: 1200, company: "NewCo", customFields: { budget: 50 } });
    const [phoneOnly] = await db.select().from(contacts).where(eq(contacts.phone, "+61411222333"));
    expect(phoneOnly.stage).toBe("new");
    const [updated] = await db.select().from(contacts).where(eq(contacts.email, "imp-existing@c.io"));
    expect(updated.company).toBe("Overwritten Co");
    const tagNames = await db.select({ name: tags.name }).from(contactTags).innerJoin(tags, eq(tags.id, contactTags.tagId)).where(eq(contactTags.contactId, created.id));
    expect(tagNames.map((t) => t.name).sort()).toEqual(["Batch 1", "Imported", "Webinar"]);
  });

  it("fill mode only fills blanks; skip mode leaves existing contacts untouched", async () => {
    await upsertContact({ email: "imp-fill@c.io", firstName: "Keep", company: "" }, { source: "manual" });
    const row = { line: 2, email: "imp-fill@c.io", firstName: "Changed", company: "Filled Co", tags: ["FillTag"] };
    expect(await importContactsChunk([row], { mode: "fill" })).toMatchObject({ created: 0, updated: 1 });
    const [c] = await db.select().from(contacts).where(eq(contacts.email, "imp-fill@c.io"));
    expect(c).toMatchObject({ firstName: "Keep", company: "Filled Co" });
    const skipped = await importContactsChunk([{ ...row, company: "Nope", tags: ["SkipTag"] }, { line: 3, email: "imp-brand-new@c.io" }], { mode: "skip" });
    expect(skipped).toMatchObject({ created: 1, updated: 0, skipped: 1 });
    expect((await db.select().from(contacts).where(eq(contacts.email, "imp-fill@c.io")))[0].company).toBe("Filled Co");
    expect(await db.select().from(tags).where(eq(tags.name, "SkipTag"))).toHaveLength(0);
  });
});

describe("CSV export", () => {
  it("exports matching contacts with tags, stage labels and custom fields, escaping formulas", async () => {
    await db.insert(customFieldDefs).values({ key: "exp_plan", label: "Plan (export)", type: "text" }).onConflictDoNothing();
    const c = (await createContact({ firstName: "=cmd()", lastName: "Exporty", email: "export-1@e.io", company: "Co, Inc.", stage: "contacted", tagNames: ["ExportTag"], customFields: { exp_plan: "Pro" } }, {})).id;
    const { csv, count } = await buildContactsCsv({ query: { q: "exporty" } });
    expect(count).toBe(1);
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain("First name,Last name,Email");
    expect(lines[0]).toContain("Plan (export)");
    expect(lines[1]).toContain("'=cmd()");
    expect(lines[1]).toContain('"Co, Inc."');
    expect(lines[1]).toContain("Contacted");
    expect(lines[1]).toContain("ExportTag");
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true }).data;
    expect(parsed[0]["Plan (export)"]).toBe("Pro");
    expect(parsed[0]["Company"]).toBe("Co, Inc.");
    const byIds = await buildContactsCsv({ ids: [c] });
    expect(byIds.count).toBe(1);
  });
});
