import { and, eq, inArray, isNull, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { contactTags, contacts, eventAttendees } from "@/lib/db/schema";
import type { ContactFilter, FilterGroup } from "@/lib/types";

/** Contact columns that can be filtered on (FilterGroup field → column). */
export const FILTERABLE_COLUMNS = {
  first_name: contacts.firstName,
  last_name: contacts.lastName,
  email: contacts.email,
  phone: contacts.phone,
  company: contacts.company,
  job_title: contacts.jobTitle,
  website: contacts.website,
  city: contacts.city,
  country: contacts.country,
  stage: contacts.stage,
  lead_status: contacts.leadStatus,
  source: contacts.source,
  owner_id: contacts.ownerId,
  email_status: contacts.emailStatus,
  created_at: contacts.createdAt,
  last_activity_at: contacts.lastActivityAt,
  deal_value: contacts.dealValue,
} as const;

const DATE_FIELDS = new Set(["created_at", "last_activity_at"]);
const NUMBER_FIELDS = new Set(["deal_value"]);

/** ISO string for a user-supplied date, or null when it can't be parsed (never throws). */
function toIsoDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Numeric value of a jsonb/text expression, or NULL when it isn't a number (avoids cast errors). */
function safeNumeric(expr: SQL) {
  return sql`(case when ${expr} ~ '^[[:space:]]*-?[0-9]+([.][0-9]+)?[[:space:]]*$' then (${expr})::numeric end)`;
}

function likeEscape(s: string) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function textCondition(expr: SQL | (typeof FILTERABLE_COLUMNS)[keyof typeof FILTERABLE_COLUMNS], f: ContactFilter): SQL | undefined {
  const v = f.value == null ? "" : String(f.value);
  switch (f.operator) {
    case "is":
      return Array.isArray(f.value) ? inArray(expr as never, f.value) : sql`lower(${expr}::text) = lower(${v})`;
    case "is_not":
      return Array.isArray(f.value)
        ? or(isNull(expr as never), notInArray(expr as never, f.value))
        : or(isNull(expr as never), sql`lower(${expr}::text) <> lower(${v})`);
    case "contains":
      return sql`${expr}::text ilike ${"%" + likeEscape(v) + "%"}`;
    case "not_contains":
      return or(isNull(expr as never), sql`${expr}::text not ilike ${"%" + likeEscape(v) + "%"}`);
    case "is_empty":
      return or(isNull(expr as never), sql`${expr}::text = ''`);
    case "is_not_empty":
      return and(sql`${expr} is not null`, sql`${expr}::text <> ''`);
    default:
      return undefined;
  }
}

function conditionFor(f: ContactFilter): SQL | undefined {
  // Tags
  if (f.field === "tag") {
    const ids = Array.isArray(f.value) ? f.value : f.value ? [String(f.value)] : [];
    if (!ids.length) return undefined;
    const exists = sql`exists (select 1 from ${contactTags} where ${contactTags.contactId} = ${contacts.id} and ${inArray(contactTags.tagId, ids)})`;
    return f.operator === "has_not" ? sql`not ${exists}` : exists;
  }
  // Event registration / attendance
  if (f.field === "event" || f.field === "attended_event") {
    if (!f.value) return undefined;
    const statusCond =
      f.field === "attended_event"
        ? eq(eventAttendees.status, "attended")
        : ne(eventAttendees.status, "cancelled");
    const exists = sql`exists (select 1 from ${eventAttendees} where ${eventAttendees.contactId} = ${contacts.id} and ${eventAttendees.eventId} = ${String(f.value)} and ${statusCond})`;
    return f.operator === "has_not" ? sql`not ${exists}` : exists;
  }
  // UTM (first touch)
  if (f.field === "utm_source" || f.field === "utm_campaign" || f.field === "utm_medium") {
    const key = f.field.slice(4);
    return textCondition(sql`(${contacts.utm} ->> ${key})`, f);
  }
  // Custom fields
  if (f.field.startsWith("custom:")) {
    const key = f.field.slice(7);
    const expr = sql`(${contacts.customFields} ->> ${key})`;
    if (f.operator === "gt") return sql`${safeNumeric(expr)} > ${Number(f.value)}`;
    if (f.operator === "lt") return sql`${safeNumeric(expr)} < ${Number(f.value)}`;
    // Date custom fields are stored as ISO "yyyy-MM-dd" strings, which sort lexicographically.
    if (f.operator === "before" || f.operator === "after") {
      const iso = toIsoDate(f.value);
      if (!iso) return undefined;
      const day = iso.slice(0, 10);
      return f.operator === "before" ? sql`${expr} < ${day}` : sql`${expr} > ${day}`;
    }
    if (f.operator === "in_last_days") {
      const days = Number(f.value);
      if (!Number.isFinite(days)) return undefined;
      return sql`(${expr} >= to_char(now() - (${days} * interval '1 day'), 'YYYY-MM-DD') and ${expr} <= to_char(now(), 'YYYY-MM-DD'))`;
    }
    return textCondition(expr, f);
  }
  const col = FILTERABLE_COLUMNS[f.field as keyof typeof FILTERABLE_COLUMNS];
  if (!col) return undefined;

  if (DATE_FIELDS.has(f.field)) {
    switch (f.operator) {
      case "before": {
        const iso = toIsoDate(f.value);
        return iso ? sql`${col} < ${iso}::timestamptz` : undefined;
      }
      case "after": {
        const iso = toIsoDate(f.value);
        return iso ? sql`${col} > ${iso}::timestamptz` : undefined;
      }
      case "in_last_days":
        return sql`${col} > now() - (${Number(f.value) || 0} * interval '1 day')`;
      case "is_empty":
        return isNull(col);
      case "is_not_empty":
        return sql`${col} is not null`;
      default:
        return undefined;
    }
  }
  if (NUMBER_FIELDS.has(f.field)) {
    const n = Number(f.value);
    if (f.operator === "gt") return Number.isFinite(n) ? sql`${col} > ${n}` : undefined;
    if (f.operator === "lt") return Number.isFinite(n) ? sql`${col} < ${n}` : undefined;
    if (f.operator === "is") return Number.isFinite(n) ? sql`${col} = ${n}` : undefined;
    if (f.operator === "is_not") return Number.isFinite(n) ? or(isNull(col), sql`${col} <> ${n}`) : undefined;
  }
  return textCondition(col, f);
}

/** Translate a FilterGroup into a SQL condition on the `contacts` table (undefined = no filter). */
export function buildContactWhere(group: FilterGroup | null | undefined): SQL | undefined {
  if (!group || !group.filters?.length) return undefined;
  const conds = group.filters.map(conditionFor).filter((c): c is SQL => Boolean(c));
  if (!conds.length) return undefined;
  return group.match === "any" ? or(...conds) : and(...conds);
}

/** Free-text search across name, email, phone and company. */
export function contactSearchWhere(q: string | null | undefined): SQL | undefined {
  const term = (q ?? "").trim();
  if (!term) return undefined;
  const like = `%${likeEscape(term)}%`;
  return or(
    sql`(coalesce(${contacts.firstName}, '') || ' ' || coalesce(${contacts.lastName}, '')) ilike ${like}`,
    sql`${contacts.email} ilike ${like}`,
    sql`${contacts.phone} ilike ${like}`,
    sql`${contacts.company} ilike ${like}`,
  );
}
