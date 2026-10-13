// Client-safe CSV import logic: guess which column maps to which contact field and turn a CSV row
// into a normalised, validated contact input. The server action re-validates everything again.
import { normalizeEmailLoose, normalizePhoneLoose, splitNameLoose } from "@/lib/contacts/normalize";
import { coerceCustomValue, splitList, type CustomFieldLite } from "@/lib/contacts/custom-values";

export type ImportField =
  | "skip"
  | "first_name"
  | "last_name"
  | "full_name"
  | "email"
  | "phone"
  | "company"
  | "job_title"
  | "website"
  | "city"
  | "country"
  | "notes"
  | "tags"
  | "stage"
  | "deal_value"
  | `custom:${string}`;

export const IMPORT_FIELDS: { key: Exclude<ImportField, `custom:${string}`>; label: string; aliases: string[] }[] = [
  { key: "skip", label: "Don't import", aliases: [] },
  { key: "full_name", label: "Full name", aliases: ["name", "full name", "fullname", "contact name", "customer name", "display name"] },
  { key: "first_name", label: "First name", aliases: ["first name", "firstname", "given name", "givenname", "forename", "fname"] },
  { key: "last_name", label: "Last name", aliases: ["last name", "lastname", "surname", "family name", "familyname", "lname"] },
  { key: "email", label: "Email", aliases: ["email", "e-mail", "email address", "e-mail address", "mail", "emailaddress"] },
  { key: "phone", label: "Phone", aliases: ["phone", "phone number", "mobile", "mobile phone", "cell", "cell phone", "telephone", "tel", "phonenumber"] },
  { key: "company", label: "Company", aliases: ["company", "company name", "organisation", "organization", "org", "business", "employer"] },
  { key: "job_title", label: "Job title", aliases: ["job title", "jobtitle", "title", "position", "role", "job"] },
  { key: "website", label: "Website", aliases: ["website", "web", "url", "site", "web site", "company website"] },
  { key: "city", label: "City", aliases: ["city", "town", "suburb"] },
  { key: "country", label: "Country", aliases: ["country", "country name", "nation"] },
  { key: "notes", label: "Notes", aliases: ["notes", "note", "comments", "comment", "description", "remarks"] },
  { key: "tags", label: "Tags", aliases: ["tags", "tag", "labels", "label", "groups", "lists"] },
  { key: "stage", label: "Stage", aliases: ["stage", "pipeline stage", "lifecycle stage"] },
  { key: "deal_value", label: "Deal value", aliases: ["deal value", "deal", "value", "amount", "deal amount", "opportunity value"] },
];

function norm(s: string) {
  return s
    .toLowerCase()
    .replace(/[_\-./]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Guess a field for every CSV header (same length/order as `headers`). Each field is used at most once. */
export function guessMapping(headers: string[], customFields: CustomFieldLite[] = []): ImportField[] {
  const used = new Set<ImportField>();
  const candidates: { field: ImportField; names: string[] }[] = [
    ...IMPORT_FIELDS.filter((f) => f.key !== "skip").map((f) => ({ field: f.key as ImportField, names: [f.label, ...f.aliases].map(norm) })),
    ...customFields.map((c) => ({ field: `custom:${c.key}` as ImportField, names: [norm(c.label), norm(c.key)] })),
  ];
  const result: ImportField[] = headers.map(() => "skip");
  // Pass 1: exact matches. Pass 2: whole-word containment (e.g. "Billing email address").
  for (const pass of [1, 2] as const) {
    headers.forEach((h, i) => {
      if (result[i] !== "skip") return;
      const n = norm(h);
      if (!n) return;
      for (const c of candidates) {
        if (used.has(c.field)) continue;
        const hit =
          pass === 1
            ? c.names.includes(n)
            : c.names.some((name) => name.length >= 5 && ` ${n} `.includes(` ${name} `));
        if (hit) {
          result[i] = c.field;
          used.add(c.field);
          return;
        }
      }
    });
  }
  return result;
}

/** A normalised contact row ready to be sent to the import server action. */
export type ImportRowInput = {
  /** 1-based line number in the CSV (header is line 1) – used in error messages. */
  line: number;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  website?: string;
  city?: string;
  country?: string;
  notes?: string;
  tags?: string[];
  stage?: string;
  dealValue?: number;
  customFields?: Record<string, unknown>;
};

export type MapRowResult = { input: ImportRowInput | null; error?: string; warnings: string[] };

export type MapContext = {
  customFields: CustomFieldLite[];
  stages: { key: string; label: string }[];
};

function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  if (!/\d/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Turn one CSV record (array of cells aligned with the headers) into a validated input.
 * `error` is set when the row can't be imported at all (no name/email/phone, invalid email).
 */
export function mapCsvRow(cells: string[], mapping: ImportField[], ctx: MapContext, line: number): MapRowResult {
  const warnings: string[] = [];
  const out: ImportRowInput = { line };
  let fullName: string | undefined;
  const custom: Record<string, unknown> = {};
  const tagSet = new Set<string>();

  mapping.forEach((field, i) => {
    const raw = (cells[i] ?? "").toString().trim();
    if (!raw || field === "skip") return;
    switch (field) {
      case "first_name":
        out.firstName = raw;
        break;
      case "last_name":
        out.lastName = raw;
        break;
      case "full_name":
        fullName = raw;
        break;
      case "email":
        out.email = raw;
        break;
      case "phone":
        out.phone = raw;
        break;
      case "company":
      case "job_title":
      case "website":
      case "city":
      case "country":
      case "notes": {
        const key = ({ company: "company", job_title: "jobTitle", website: "website", city: "city", country: "country", notes: "notes" } as const)[field];
        // Several columns can map to notes → concatenate; otherwise first non-empty wins.
        if (field === "notes" && out.notes) out.notes += `\n${raw}`;
        else if (!out[key]) out[key] = raw;
        break;
      }
      case "tags":
        splitList(raw).forEach((t) => tagSet.add(t.slice(0, 60)));
        break;
      case "stage": {
        const l = raw.toLowerCase();
        const hit = ctx.stages.find((s) => s.key.toLowerCase() === l || s.label.toLowerCase() === l);
        if (hit) out.stage = hit.key;
        else warnings.push(`Unknown stage "${raw}" – using the default stage`);
        break;
      }
      case "deal_value": {
        const n = parseMoney(raw);
        if (n == null) warnings.push(`Invalid deal value "${raw}" ignored`);
        else out.dealValue = n;
        break;
      }
      default: {
        if (!field.startsWith("custom:")) break;
        const key = field.slice(7);
        const def = ctx.customFields.find((c) => c.key === key);
        if (!def) break;
        const res = coerceCustomValue(def, raw);
        if (!res.ok) warnings.push(`Invalid value "${raw}" for ${def.label} ignored`);
        else if (res.value != null) custom[key] = res.value;
      }
    }
  });

  if (fullName && !out.firstName && !out.lastName) {
    const { firstName, lastName } = splitNameLoose(fullName);
    if (firstName) out.firstName = firstName;
    if (lastName) out.lastName = lastName;
  }
  if (out.email) {
    const email = normalizeEmailLoose(out.email);
    if (!email) return { input: null, error: `Invalid email "${out.email}"`, warnings };
    out.email = email;
  }
  if (out.phone) {
    const phone = normalizePhoneLoose(out.phone);
    if (!phone) {
      warnings.push(`Invalid phone "${out.phone}" ignored`);
      delete out.phone;
    } else out.phone = phone;
  }
  if (tagSet.size) out.tags = [...tagSet];
  if (Object.keys(custom).length) out.customFields = custom;
  if (!out.email && !out.phone && !out.firstName && !out.lastName) {
    return { input: null, error: "Row has no name, email or phone", warnings };
  }
  return { input: out, warnings };
}

/** Row is entirely blank (papaparse can yield these when skipEmptyLines is off). */
export function isBlankRow(cells: string[]) {
  return cells.every((c) => !String(c ?? "").trim());
}
