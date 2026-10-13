import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, customFieldDefs, type CustomFieldDef } from "@/lib/db/schema";
import { slugify } from "@/lib/format";
import type { CustomFieldType } from "@/lib/types";

export class FieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldError";
  }
}

export const FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Single choice" },
  { value: "multiselect", label: "Multiple choice" },
  { value: "url", label: "URL" },
  { value: "checkbox", label: "Checkbox (yes/no)" },
];

/** Keys that would clash with built-in merge tag names or contact columns. */
const RESERVED = new Set(["id", "email", "first_name", "last_name", "full_name", "phone", "company", "job_title", "stage"]);

export function fieldKeyFromLabel(label: string, taken: Iterable<string>): string {
  const used = new Set([...taken, ...RESERVED]);
  let base = slugify(label).replace(/-/g, "_");
  if (!base || !/^[a-z]/.test(base)) base = `field_${base}`.replace(/_$/, "");
  if (base === "field") base = "field_1";
  let key = base;
  for (let i = 2; used.has(key); i++) key = `${base}_${i}`;
  return key;
}

function cleanOptions(type: CustomFieldType, options: string[] | undefined): string[] {
  if (type !== "select" && type !== "multiselect") return [];
  const out = [...new Set((options ?? []).map((o) => o.trim()).filter(Boolean))];
  if (out.length < 2) throw new FieldError("Add at least two options for a choice field.");
  return out;
}

export type FieldDefWithUsage = CustomFieldDef & { usage: number };

export async function listFieldDefs(): Promise<FieldDefWithUsage[]> {
  const defs = await db.select().from(customFieldDefs).orderBy(asc(customFieldDefs.position), asc(customFieldDefs.createdAt));
  const out: FieldDefWithUsage[] = [];
  for (const d of defs) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(contacts)
      .where(sql`jsonb_exists(${contacts.customFields}, ${d.key})`);
    out.push({ ...d, usage: row?.n ?? 0 });
  }
  return out;
}

export async function createFieldDef(input: { label: string; type: CustomFieldType; options?: string[] }) {
  const label = input.label.trim().replace(/\s+/g, " ");
  if (!label) throw new FieldError("Give the field a label.");
  if (label.length > 60) throw new FieldError("Labels can be at most 60 characters.");
  const options = cleanOptions(input.type, input.options);
  const existing = await db.select().from(customFieldDefs);
  if (existing.some((d) => d.label.trim().replace(/\s+/g, " ").toLowerCase() === label.toLowerCase())) {
    throw new FieldError(`A field called “${label}” already exists.`);
  }
  const key = fieldKeyFromLabel(label, existing.map((d) => d.key));
  const position = existing.reduce((m, d) => Math.max(m, d.position), -1) + 1;
  const [row] = await db.insert(customFieldDefs).values({ key, label, type: input.type, options, position }).returning();
  return row;
}

/** The key never changes (contact data and merge tags reference it). */
export async function updateFieldDef(id: string, input: { label: string; type: CustomFieldType; options?: string[] }) {
  const label = input.label.trim().replace(/\s+/g, " ");
  if (!label) throw new FieldError("Give the field a label.");
  const options = cleanOptions(input.type, input.options);
  const existing = await db.select().from(customFieldDefs);
  if (existing.some((d) => d.id !== id && d.label.trim().replace(/\s+/g, " ").toLowerCase() === label.toLowerCase())) {
    throw new FieldError(`A field called “${label}” already exists.`);
  }
  const [row] = await db.update(customFieldDefs).set({ label, type: input.type, options }).where(eq(customFieldDefs.id, id)).returning();
  if (!row) throw new FieldError("That field no longer exists.");
  return row;
}

/** Delete the definition and remove its values from every contact. */
export async function deleteFieldDef(id: string) {
  await db.transaction(async (tx) => {
    const [def] = await tx.select().from(customFieldDefs).where(eq(customFieldDefs.id, id));
    if (!def) throw new FieldError("That field no longer exists.");
    await tx
      .update(contacts)
      .set({ customFields: sql`${contacts.customFields} - ${def.key}::text` })
      .where(sql`jsonb_exists(${contacts.customFields}, ${def.key})`);
    await tx.delete(customFieldDefs).where(eq(customFieldDefs.id, id));
  });
}

/** Swap a field with its neighbour (and normalise positions to 0..n-1). */
export async function moveFieldDef(id: string, direction: -1 | 1) {
  await db.transaction(async (tx) => {
    const defs = await tx.select().from(customFieldDefs).orderBy(asc(customFieldDefs.position), asc(customFieldDefs.createdAt));
    const i = defs.findIndex((d) => d.id === id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= defs.length) return;
    [defs[i], defs[j]] = [defs[j], defs[i]];
    for (let p = 0; p < defs.length; p++) {
      if (defs[p].position !== p) await tx.update(customFieldDefs).set({ position: p }).where(eq(customFieldDefs.id, defs[p].id));
    }
  });
}
