import { eq, sql } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";
import { automations, broadcasts, contactTags, savedViews, tags } from "@/lib/db/schema";
import type { AutomationStep, ContactFilter } from "@/lib/types";

export class TagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TagError";
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const CHUNK = 1000;

export type TagWithUsage = { id: string; name: string; color: string; count: number; createdAt: Date };

/** All tags with the number of contacts using each, alphabetical. */
export async function listTagsWithUsage(): Promise<TagWithUsage[]> {
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
      createdAt: tags.createdAt,
      count: sql<number>`count(${contactTags.contactId})::int`,
    })
    .from(tags)
    .leftJoin(contactTags, eq(contactTags.tagId, tags.id))
    .groupBy(tags.id)
    .orderBy(sql`lower(${tags.name})`);
  return rows;
}

async function assertNameFree(name: string, exceptId?: string) {
  const rows = await db.select({ id: tags.id }).from(tags).where(sql`lower(${tags.name}) = ${name.toLowerCase()}`);
  if (rows.some((r) => r.id !== exceptId)) throw new TagError(`A tag called “${name}” already exists.`);
}

function cleanName(name: string) {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n) throw new TagError("Give the tag a name.");
  if (n.length > 40) throw new TagError("Tag names can be at most 40 characters.");
  return n;
}

export async function createTag(input: { name: string; color: string }) {
  const name = cleanName(input.name);
  if (!HEX.test(input.color)) throw new TagError("Pick a valid color.");
  await assertNameFree(name);
  const [row] = await db.insert(tags).values({ name, color: input.color.toLowerCase() }).returning();
  return row;
}

export async function updateTag(id: string, input: { name: string; color: string }) {
  const name = cleanName(input.name);
  if (!HEX.test(input.color)) throw new TagError("Pick a valid color.");
  await assertNameFree(name, id);
  const [row] = await db.update(tags).set({ name, color: input.color.toLowerCase() }).where(eq(tags.id, id)).returning();
  if (!row) throw new TagError("That tag no longer exists.");
  return row;
}

export async function deleteTag(id: string) {
  const rows = await db.delete(tags).where(eq(tags.id, id)).returning({ id: tags.id });
  if (!rows.length) throw new TagError("That tag no longer exists.");
}

function remapFilterValue(value: ContactFilter["value"], from: string, to: string): ContactFilter["value"] {
  if (value === from) return to;
  if (Array.isArray(value)) return [...new Set(value.map((v) => (v === from ? to : v)))];
  return value;
}

/** Point automations, smart views and broadcast audiences at tag `to` instead of `from`. */
async function remapTagReferences(tx: Tx, from: string, to: string) {
  const autos = await tx.select({ id: automations.id, trigger: automations.trigger, steps: automations.steps }).from(automations);
  for (const a of autos) {
    let changed = false;
    const trigger = { ...a.trigger, config: { ...a.trigger.config } };
    if (trigger.config.tagId === from) {
      trigger.config.tagId = to;
      changed = true;
    }
    const steps = a.steps.map((s): AutomationStep => {
      if ((s.type === "add_tag" || s.type === "remove_tag") && s.tagId === from) {
        changed = true;
        return { ...s, tagId: to };
      }
      return s;
    });
    if (changed) await tx.update(automations).set({ trigger, steps }).where(eq(automations.id, a.id));
  }
  const views = await tx.select({ id: savedViews.id, filters: savedViews.filters }).from(savedViews);
  for (const v of views) {
    let changed = false;
    const filters = (v.filters?.filters ?? []).map((f) => {
      if (f.field !== "tag") return f;
      const value = remapFilterValue(f.value, from, to);
      if (JSON.stringify(value) !== JSON.stringify(f.value)) changed = true;
      return { ...f, value };
    });
    if (changed) await tx.update(savedViews).set({ filters: { ...v.filters, filters } }).where(eq(savedViews.id, v.id));
  }
  const casts = await tx.select({ id: broadcasts.id, audience: broadcasts.audience }).from(broadcasts);
  for (const b of casts) {
    if (b.audience.type === "tags" && b.audience.tagIds.includes(from)) {
      const tagIds = [...new Set(b.audience.tagIds.map((t) => (t === from ? to : t)))];
      await tx.update(broadcasts).set({ audience: { ...b.audience, tagIds } }).where(eq(broadcasts.id, b.id));
    }
  }
}

/**
 * Merge tag `sourceId` into `targetId`: every contact keeps/gets the target tag
 * (existing links are left alone), then the source tag is deleted.
 */
export async function mergeTags(sourceId: string, targetId: string): Promise<{ moved: number; sourceName: string; targetName: string }> {
  if (sourceId === targetId) throw new TagError("Choose two different tags.");
  return db.transaction(async (tx) => {
    const [source] = await tx.select().from(tags).where(eq(tags.id, sourceId));
    const [target] = await tx.select().from(tags).where(eq(tags.id, targetId));
    if (!source || !target) throw new TagError("One of the tags no longer exists.");
    const links = await tx
      .select({ contactId: contactTags.contactId })
      .from(contactTags)
      .where(eq(contactTags.tagId, sourceId));
    let moved = 0;
    for (let i = 0; i < links.length; i += CHUNK) {
      const inserted = await tx
        .insert(contactTags)
        .values(links.slice(i, i + CHUNK).map((l) => ({ contactId: l.contactId, tagId: targetId })))
        .onConflictDoNothing()
        .returning({ contactId: contactTags.contactId });
      moved += inserted.length;
    }
    await remapTagReferences(tx, sourceId, targetId);
    await tx.delete(tags).where(eq(tags.id, sourceId));
    return { moved, sourceName: source.name, targetName: target.name };
  });
}
