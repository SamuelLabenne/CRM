// Client-safe helpers for custom field values (stored in contacts.custom_fields jsonb).
import type { CustomFieldType } from "@/lib/types";

export type CustomFieldLite = { key: string; label: string; type: CustomFieldType; options?: string[] };

const TRUE_WORDS = new Set(["true", "yes", "y", "1", "x", "checked", "on"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0", "unchecked", "off"]);

/** Parse "2024-03-05", "5/3/2024" (day first, like the workspace default locale) or any Date-parsable string into yyyy-MM-dd. */
export function parseDateOnly(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  let y: number, m: number, d: number;
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  else {
    const t = new Date(s);
    if (Number.isNaN(t.getTime())) return null;
    return t.toISOString().slice(0, 10);
  }
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function splitList(raw: string): string[] {
  return raw
    .split(/[,;|\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Coerce a raw (usually string) value into the right JSON value for a custom field.
 * `value: null` means "empty" (callers should skip/unset it). `ok: false` means the input is invalid.
 */
export function coerceCustomValue(def: CustomFieldLite, raw: unknown): { ok: boolean; value: unknown } {
  if (raw == null) return { ok: true, value: null };
  if (def.type === "multiselect" && Array.isArray(raw)) raw = raw.map(String).join(",");
  if (typeof raw === "boolean") raw = String(raw);
  const s = String(raw).trim();
  if (s === "") return { ok: true, value: null };
  const options = def.options ?? [];
  const matchOption = (v: string) => options.find((o) => o.toLowerCase() === v.toLowerCase());
  switch (def.type) {
    case "number": {
      const n = Number(s.replace(/[,$\s]/g, ""));
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, value: null };
    }
    case "date": {
      const d = parseDateOnly(s);
      return d ? { ok: true, value: d } : { ok: false, value: null };
    }
    case "checkbox": {
      const l = s.toLowerCase();
      if (TRUE_WORDS.has(l)) return { ok: true, value: true };
      if (FALSE_WORDS.has(l)) return { ok: true, value: false };
      return { ok: false, value: null };
    }
    case "select": {
      if (!options.length) return { ok: true, value: s };
      const m = matchOption(s);
      return m ? { ok: true, value: m } : { ok: false, value: null };
    }
    case "multiselect": {
      const parts = splitList(s);
      const picked = options.length ? parts.map(matchOption).filter((x): x is string => Boolean(x)) : parts;
      if (!picked.length) return { ok: options.length === 0, value: null };
      return { ok: true, value: [...new Set(picked)] };
    }
    default:
      return { ok: true, value: s };
  }
}

/** Display string for a stored custom field value. */
export function formatCustomValue(def: Pick<CustomFieldLite, "type">, value: unknown): string {
  if (value == null || value === "") return "";
  if (Array.isArray(value)) return value.join(", ");
  if (def.type === "checkbox") return value === true || value === "true" ? "Yes" : "No";
  if (def.type === "number" && typeof value === "number") return new Intl.NumberFormat("en-AU").format(value);
  return String(value);
}
