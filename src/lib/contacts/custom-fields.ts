// Server helpers for custom field definitions (CRUD lives in Settings → Custom fields).
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { customFieldDefs } from "@/lib/db/schema";
import { coerceCustomValue, type CustomFieldLite } from "@/lib/contacts/custom-values";

export async function listCustomFieldDefs(): Promise<CustomFieldLite[]> {
  const rows = await db.select().from(customFieldDefs).orderBy(asc(customFieldDefs.position), asc(customFieldDefs.label));
  return rows.map((r) => ({ key: r.key, label: r.label, type: r.type, options: r.options ?? [] }));
}

/**
 * Validate and normalise submitted custom field values against the definitions.
 * Unknown keys are dropped; empty values become `null` (= remove the key).
 */
export function coerceCustomInput(
  defs: CustomFieldLite[],
  input: Record<string, unknown> | undefined,
): { values: Record<string, unknown>; errors: Record<string, string[]> } {
  const values: Record<string, unknown> = {};
  const errors: Record<string, string[]> = {};
  for (const def of defs) {
    if (!input || !(def.key in input)) continue;
    const res = coerceCustomValue(def, input[def.key]);
    if (!res.ok) errors[`customFields.${def.key}`] = [`Invalid value for ${def.label}`];
    else values[def.key] = res.value;
  }
  return { values, errors };
}
