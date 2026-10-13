import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "@/test/setup-db";

const { db } = await setupTestDb();
const s = await import("@/lib/db/schema");
const tagLib = await import("./tags");

describe("tags", () => {
  it("creates, renames and rejects duplicate names (case-insensitive)", async () => {
    const t = await tagLib.createTag({ name: "  Hot   lead ", color: "#ff0000" });
    expect(t.name).toBe("Hot lead");
    await expect(tagLib.createTag({ name: "hot LEAD", color: "#00ff00" })).rejects.toThrow(/already exists/);
    await expect(tagLib.createTag({ name: "x", color: "red" })).rejects.toThrow(/color/);
    const renamed = await tagLib.updateTag(t.id, { name: "Hot", color: "#00ff00" });
    expect(renamed.color).toBe("#00ff00");
  });

  it("merges A into B without duplicating links, remaps references and deletes A", async () => {
    const a = await tagLib.createTag({ name: "Webinar 2025", color: "#111111" });
    const b = await tagLib.createTag({ name: "Webinar", color: "#222222" });
    const [c1, c2, c3] = await db
      .insert(s.contacts)
      .values([{ email: "1@x.io" }, { email: "2@x.io" }, { email: "3@x.io" }])
      .returning();
    await db.insert(s.contactTags).values([
      { contactId: c1.id, tagId: a.id },
      { contactId: c2.id, tagId: a.id },
      { contactId: c2.id, tagId: b.id }, // already has B
      { contactId: c3.id, tagId: b.id },
    ]);
    const [auto] = await db
      .insert(s.automations)
      .values({
        name: "tag auto",
        trigger: { type: "tag_added", config: { tagId: a.id } },
        steps: [{ id: "s", type: "add_tag", tagId: a.id }],
      })
      .returning();
    const [view] = await db
      .insert(s.savedViews)
      .values({ name: "v", filters: { match: "all", filters: [{ field: "tag", operator: "has", value: [a.id, b.id] }] } })
      .returning();
    const [bc] = await db.insert(s.broadcasts).values({ name: "bc", audience: { type: "tags", tagIds: [a.id], match: "any" } }).returning();

    const usageBefore = await tagLib.listTagsWithUsage();
    expect(usageBefore.find((t) => t.id === a.id)?.count).toBe(2);

    const res = await tagLib.mergeTags(a.id, b.id);
    expect(res.moved).toBe(1); // only c1 was new for B
    expect(res.sourceName).toBe("Webinar 2025");

    const links = await db.select().from(s.contactTags).where(eq(s.contactTags.tagId, b.id));
    expect(links.map((l) => l.contactId).sort()).toEqual([c1.id, c2.id, c3.id].sort());
    expect(await db.select().from(s.tags).where(eq(s.tags.id, a.id))).toHaveLength(0);
    const usage = await tagLib.listTagsWithUsage();
    expect(usage.find((t) => t.id === b.id)?.count).toBe(3);

    const [auto2] = await db.select().from(s.automations).where(eq(s.automations.id, auto.id));
    expect(auto2.trigger.config.tagId).toBe(b.id);
    expect(auto2.steps[0]).toMatchObject({ tagId: b.id });
    const [v2] = await db.select().from(s.savedViews).where(eq(s.savedViews.id, view.id));
    expect(v2.filters.filters[0].value).toEqual([b.id]);
    const [bc2] = await db.select().from(s.broadcasts).where(eq(s.broadcasts.id, bc.id));
    expect(bc2.audience).toMatchObject({ type: "tags", tagIds: [b.id] });
  });

  it("refuses to merge a tag into itself or a missing tag", async () => {
    const t = await tagLib.createTag({ name: "Solo", color: "#123456" });
    await expect(tagLib.mergeTags(t.id, t.id)).rejects.toThrow(/different/);
    await expect(tagLib.mergeTags(t.id, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(/no longer exists/);
  });

  it("deleting a tag removes its links but not the contacts", async () => {
    const t = await tagLib.createTag({ name: "Temp", color: "#123456" });
    const [c] = await db.insert(s.contacts).values({ email: "t@x.io" }).returning();
    await db.insert(s.contactTags).values({ contactId: c.id, tagId: t.id });
    await tagLib.deleteTag(t.id);
    expect(await db.select().from(s.contactTags).where(eq(s.contactTags.tagId, t.id))).toHaveLength(0);
    expect(await db.select().from(s.contacts).where(eq(s.contacts.id, c.id))).toHaveLength(1);
    await expect(tagLib.deleteTag(t.id)).rejects.toThrow();
  });
});
