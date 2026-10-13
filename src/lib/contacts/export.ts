// CSV export of contacts (matching a query, or an explicit selection).
import Papa from "papaparse";
import { asc, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, customFieldDefs, users } from "@/lib/db/schema";
import { contactQueryWhere, tagsByContact, MAX_SELECTION, type ContactQuery } from "@/lib/contacts/query";
import { formatCustomValue } from "@/lib/contacts/custom-values";
import { getStages } from "@/lib/settings";

const BATCH = 1000;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "");

/**
 * Build the CSV text for contacts. Pass `ids` for an explicit selection or `query` for everything
 * matching a search/filter. Cells that would be interpreted as spreadsheet formulas are escaped.
 */
export async function buildContactsCsv(sel: { ids: string[] } | { query: ContactQuery }): Promise<{ csv: string; count: number }> {
  const [stages, defs, owners] = await Promise.all([
    getStages(),
    db.select().from(customFieldDefs).orderBy(asc(customFieldDefs.position), asc(customFieldDefs.label)),
    db.select({ id: users.id, name: users.name }).from(users),
  ]);
  const stageLabel = new Map(stages.map((s) => [s.key, s.label]));
  const ownerName = new Map(owners.map((o) => [o.id, o.name]));

  const where = "ids" in sel ? inArray(contacts.id, sel.ids.slice(0, MAX_SELECTION)) : contactQueryWhere(sel.query);
  const idRows = await db.select({ id: contacts.id }).from(contacts).where(where).orderBy(desc(contacts.createdAt)).limit(MAX_SELECTION);
  const orderedIds = idRows.map((r) => r.id);

  const fields = [
    "First name",
    "Last name",
    "Email",
    "Phone",
    "Company",
    "Job title",
    "Website",
    "City",
    "Country",
    "Stage",
    "Lead status",
    "Source",
    "Owner",
    "Tags",
    "Deal value",
    "Email status",
    "Notes",
    "UTM source",
    "UTM medium",
    "UTM campaign",
    "Created",
    "Last activity",
    ...defs.map((d) => d.label),
  ];
  const data: string[][] = [];
  for (let i = 0; i < orderedIds.length; i += BATCH) {
    const chunk = orderedIds.slice(i, i + BATCH);
    const [rows, tagMap] = await Promise.all([db.select().from(contacts).where(inArray(contacts.id, chunk)), tagsByContact(chunk)]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of chunk) {
      const c = byId.get(id);
      if (!c) continue;
      data.push([
        c.firstName ?? "",
        c.lastName ?? "",
        c.email ?? "",
        c.phone ?? "",
        c.company ?? "",
        c.jobTitle ?? "",
        c.website ?? "",
        c.city ?? "",
        c.country ?? "",
        stageLabel.get(c.stage) ?? c.stage,
        c.leadStatus ?? "",
        c.source,
        c.ownerId ? (ownerName.get(c.ownerId) ?? "") : "",
        (tagMap.get(id) ?? []).map((t) => t.name).join(", "),
        c.dealValue == null ? "" : String(c.dealValue),
        c.emailStatus,
        c.notes ?? "",
        c.utm?.source ?? "",
        c.utm?.medium ?? "",
        c.utm?.campaign ?? "",
        iso(c.createdAt),
        iso(c.lastActivityAt),
        ...defs.map((d) => formatCustomValue(d, c.customFields?.[d.key])),
      ]);
    }
  }
  const csv = Papa.unparse({ fields, data }, { escapeFormulae: true, newline: "\r\n" });
  return { csv, count: data.length };
}
