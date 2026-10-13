// Client-safe helpers to (de)serialise a FilterGroup for URLs (`?f=<base64url JSON>`)
// and to validate/sanitise filters coming from untrusted input.
import { z } from "zod";
import type { ContactFilter, FilterGroup, FilterOperator } from "@/lib/types";

export const FILTER_OPERATORS = [
  "is",
  "is_not",
  "contains",
  "not_contains",
  "is_empty",
  "is_not_empty",
  "gt",
  "lt",
  "before",
  "after",
  "in_last_days",
  "has",
  "has_not",
] as const satisfies readonly FilterOperator[];

export const filterGroupSchema = z.object({
  match: z.enum(["all", "any"]),
  filters: z
    .array(
      z.object({
        field: z.string().min(1).max(80),
        operator: z.enum(FILTER_OPERATORS),
        value: z.union([z.string().max(500), z.number(), z.array(z.string().max(200)).max(100), z.null()]).optional(),
      }),
    )
    .max(30),
});

export const EMPTY_FILTER: FilterGroup = { match: "all", filters: [] };

const NO_VALUE_OPERATORS = new Set<FilterOperator>(["is_empty", "is_not_empty"]);

/** True when the operator doesn't need a value (is empty / is not empty). */
export function operatorTakesNoValue(op: FilterOperator) {
  return NO_VALUE_OPERATORS.has(op);
}

/** A filter is "complete" when it has everything needed to be applied. */
export function isFilterComplete(f: ContactFilter): boolean {
  if (!f.field) return false;
  if (operatorTakesNoValue(f.operator)) return true;
  const v = f.value;
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.trim() !== "";
  return Number.isFinite(v);
}

/** Drop incomplete filters (e.g. a half-edited builder row). */
export function sanitizeFilterGroup(group: FilterGroup | null | undefined): FilterGroup {
  if (!group) return { match: "all", filters: [] };
  return { match: group.match === "any" ? "any" : "all", filters: (group.filters ?? []).filter(isFilterComplete) };
}

export function isEmptyFilter(group: FilterGroup | null | undefined): boolean {
  return !group || sanitizeFilterGroup(group).filters.length === 0;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** FilterGroup → base64url JSON for `?f=`. Returns "" for an empty filter (so the param can be omitted). */
export function encodeFilter(group: FilterGroup | null | undefined): string {
  const clean = sanitizeFilterGroup(group);
  if (!clean.filters.length) return "";
  return toBase64Url(new TextEncoder().encode(JSON.stringify(clean)));
}

/** `?f=` value → validated FilterGroup, or null when absent/invalid. Never throws. */
export function decodeFilter(param: string | null | undefined): FilterGroup | null {
  if (!param) return null;
  try {
    const json = new TextDecoder().decode(fromBase64Url(param));
    const parsed = filterGroupSchema.safeParse(JSON.parse(json));
    if (!parsed.success) return null;
    return sanitizeFilterGroup(parsed.data as FilterGroup);
  } catch {
    return null;
  }
}
