// Server side of the CSV import: takes already-mapped rows (see csv-mapping.ts) in chunks.
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, customFieldDefs } from "@/lib/db/schema";
import { ensureTag, normalizeEmail, normalizePhone, upsertContact, type UpsertContactInput } from "@/lib/contacts";
import { coerceCustomValue } from "@/lib/contacts/custom-values";
import type { ImportRowInput } from "@/lib/contacts/csv-mapping";
import { getStages } from "@/lib/settings";

/** update = overwrite existing values · fill = only fill blanks on existing contacts · skip = leave existing contacts untouched */
export type ImportMode = "update" | "fill" | "skip";

export type ImportOptions = {
  mode: ImportMode;
  /** Tag added to every imported (created or updated) contact. */
  tagName?: string | null;
  actorId?: string | null;
};

export type ImportChunkResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: { line: number; message: string }[];
};

async function existingContactId(email: string | null, phone: string | null): Promise<string | null> {
  if (email) {
    const [c] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.email, email)).limit(1);
    if (c) return c.id;
  }
  if (phone) {
    // Same rule as upsertContact: a phone match only counts when the emails can't disagree.
    const [c] = await db.select({ id: contacts.id, email: contacts.email }).from(contacts).where(eq(contacts.phone, phone)).limit(1);
    if (c && (!email || !c.email)) return c.id;
  }
  return null;
}

/**
 * Import one chunk of rows. Every row is handled independently: a bad row is reported in `errors`
 * and never aborts the chunk. Uses `upsertContact({ source: "import" })`, so contacts are de-duplicated
 * by email (then phone) and `contact_created` automations/webhooks fire for new contacts.
 */
export async function importContactsChunk(rows: ImportRowInput[], opts: ImportOptions): Promise<ImportChunkResult> {
  const result: ImportChunkResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  const [stages, defs] = await Promise.all([getStages(), db.select().from(customFieldDefs)]);
  const stageKeys = new Set(stages.map((s) => s.key));
  const defByKey = new Map(defs.map((d) => [d.key, { key: d.key, label: d.label, type: d.type, options: d.options }]));

  const tagIds = new Map<string, string>(); // lower-cased name → id
  const tagId = async (name: string) => {
    const k = name.trim().toLowerCase();
    let id = tagIds.get(k);
    if (!id) {
      id = (await ensureTag(name.trim().slice(0, 60)))?.id;
      if (id) tagIds.set(k, id);
    }
    return id;
  };
  const globalTagId = opts.tagName?.trim() ? await tagId(opts.tagName) : undefined;

  for (const row of rows) {
    try {
      const email = normalizeEmail(row.email);
      const phone = normalizePhone(row.phone);
      if (row.email?.trim() && !email) {
        result.errors.push({ line: row.line, message: `Invalid email "${row.email}"` });
        continue;
      }
      if (!email && !phone && !row.firstName?.trim() && !row.lastName?.trim()) {
        result.errors.push({ line: row.line, message: "Row has no name, email or phone" });
        continue;
      }

      const existingId = await existingContactId(email, phone);
      if (existingId && opts.mode === "skip") {
        result.skipped++;
        continue;
      }

      const custom: Record<string, unknown> = {};
      for (const [key, raw] of Object.entries(row.customFields ?? {})) {
        const def = defByKey.get(key);
        if (!def) continue;
        const c = coerceCustomValue(def, raw);
        if (c.ok && c.value != null) custom[key] = c.value;
      }
      const ids = new Set<string>();
      if (globalTagId) ids.add(globalTagId);
      for (const name of row.tags ?? []) {
        const id = await tagId(name);
        if (id) ids.add(id);
      }

      const input: UpsertContactInput = {
        firstName: row.firstName,
        lastName: row.lastName,
        email,
        phone,
        company: row.company,
        jobTitle: row.jobTitle,
        website: row.website,
        city: row.city,
        country: row.country,
        notes: row.notes ?? null,
        dealValue: row.dealValue != null && Number.isFinite(row.dealValue) ? Math.round(row.dealValue) : undefined,
        stage: row.stage && stageKeys.has(row.stage) ? row.stage : undefined,
        customFields: custom,
        tagIds: [...ids],
      };
      const { created } = await upsertContact(input, {
        source: "import",
        actorId: opts.actorId ?? null,
        overwrite: opts.mode === "update",
      });
      if (created) result.created++;
      else result.updated++;
    } catch (err) {
      result.errors.push({ line: row.line, message: err instanceof Error ? err.message : "Unknown error" });
    }
  }
  return result;
}
