// Server-side contact listing used by /contacts, the CSV export and bulk actions.
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { contactTags, contacts, tags, users, type Contact } from "@/lib/db/schema";
import { buildContactWhere, contactSearchWhere } from "@/lib/contacts/filters";
import { sanitizeFilterGroup } from "@/lib/contacts/filter-codec";
import type { ContactFilter, FilterGroup } from "@/lib/types";

/** Simple dropdown filters shown above the table; AND-ed with the advanced filter. */
export type QuickFilters = { stage?: string; lead?: string; tag?: string; owner?: string; email?: string; source?: string };
export const QUICK_FILTER_KEYS = ["stage", "lead", "tag", "owner", "email", "source"] as const satisfies readonly (keyof QuickFilters)[];

export function quickFiltersToFilters(q: QuickFilters | undefined): ContactFilter[] {
  if (!q) return [];
  const out: ContactFilter[] = [];
  if (q.stage) out.push({ field: "stage", operator: "is", value: q.stage });
  if (q.lead) out.push(q.lead === "none" ? { field: "lead_status", operator: "is_empty" } : { field: "lead_status", operator: "is", value: q.lead });
  if (q.tag) out.push({ field: "tag", operator: "has", value: q.tag });
  if (q.owner) out.push(q.owner === "none" ? { field: "owner_id", operator: "is_empty" } : { field: "owner_id", operator: "is", value: q.owner });
  if (q.email) out.push({ field: "email_status", operator: "is", value: q.email });
  if (q.source) out.push({ field: "source", operator: "is", value: q.source });
  return out;
}

/**
 * Combine quick filters and an advanced filter into one FilterGroup (what a Smart View stores).
 * Returns null when it can't be expressed (quick filters + an advanced "match any" with several rules).
 */
export function mergeQuickIntoGroup(quick: QuickFilters | undefined, group: FilterGroup | null | undefined): FilterGroup | null {
  const quickFilters = quickFiltersToFilters(quick);
  const clean = sanitizeFilterGroup(group);
  if (!quickFilters.length) return clean;
  if (!clean.filters.length) return { match: "all", filters: quickFilters };
  if (clean.match === "all" || clean.filters.length === 1) return { match: "all", filters: [...quickFilters, ...clean.filters] };
  return null;
}

/** What to list: free-text search + quick filters + advanced filter. */
export type ContactQuery = { q?: string | null; quick?: QuickFilters; filter?: FilterGroup | null };

export function contactQueryWhere(query: ContactQuery): SQL | undefined {
  return and(
    contactSearchWhere(query.q),
    buildContactWhere({ match: "all", filters: quickFiltersToFilters(query.quick) }),
    buildContactWhere(sanitizeFilterGroup(query.filter)),
  );
}

export const CONTACT_SORTS = ["created", "name", "company", "stage", "last_activity", "deal_value"] as const;
export type ContactSort = (typeof CONTACT_SORTS)[number];

const NAME_EXPR = sql`lower(coalesce(nullif(trim(coalesce(${contacts.firstName}, '') || ' ' || coalesce(${contacts.lastName}, '')), ''), ${contacts.email}, ${contacts.phone}, ''))`;

function orderFor(sort: ContactSort, dir: "asc" | "desc") {
  const d = dir === "asc" ? asc : desc;
  const tie = desc(contacts.createdAt);
  switch (sort) {
    case "name":
      return [d(NAME_EXPR), tie];
    case "company":
      return [dir === "asc" ? sql`lower(${contacts.company}) asc nulls last` : sql`lower(${contacts.company}) desc nulls last`, tie];
    case "stage":
      return [d(contacts.stage), tie];
    case "last_activity":
      return [dir === "asc" ? sql`${contacts.lastActivityAt} asc nulls last` : sql`${contacts.lastActivityAt} desc nulls last`, tie];
    case "deal_value":
      return [dir === "asc" ? sql`${contacts.dealValue} asc nulls last` : sql`${contacts.dealValue} desc nulls last`, tie];
    default:
      return [d(contacts.createdAt)];
  }
}

export type ContactListRow = Contact & {
  owner: { id: string; name: string; color: string } | null;
  tags: { id: string; name: string; color: string }[];
};

export async function countContacts(query: ContactQuery): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(contactQueryWhere(query));
  return row?.n ?? 0;
}

/** Attach tags to a list of contact rows (single query). */
export async function tagsByContact(ids: string[]) {
  const map = new Map<string, { id: string; name: string; color: string }[]>();
  if (!ids.length) return map;
  const rows = await db
    .select({ contactId: contactTags.contactId, id: tags.id, name: tags.name, color: tags.color })
    .from(contactTags)
    .innerJoin(tags, eq(tags.id, contactTags.tagId))
    .where(inArray(contactTags.contactId, ids))
    .orderBy(asc(tags.name));
  for (const r of rows) {
    const list = map.get(r.contactId) ?? [];
    list.push({ id: r.id, name: r.name, color: r.color });
    map.set(r.contactId, list);
  }
  return map;
}

export async function listContacts(
  query: ContactQuery,
  opts: { sort?: ContactSort; dir?: "asc" | "desc"; page?: number; pageSize?: number } = {},
): Promise<{ rows: ContactListRow[]; total: number; page: number; pageSize: number; pageCount: number }> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 200);
  const where = contactQueryWhere(query);
  const total = await countContacts(query);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(opts.page ?? 1, 1), pageCount);
  const rows = await db
    .select({ contact: contacts, ownerId: users.id, ownerName: users.name, ownerColor: users.color })
    .from(contacts)
    .leftJoin(users, eq(users.id, contacts.ownerId))
    .where(where)
    .orderBy(...orderFor(opts.sort ?? "created", opts.dir ?? "desc"))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const tagMap = await tagsByContact(rows.map((r) => r.contact.id));
  return {
    rows: rows.map((r) => ({
      ...r.contact,
      owner: r.ownerId ? { id: r.ownerId, name: r.ownerName!, color: r.ownerColor! } : null,
      tags: tagMap.get(r.contact.id) ?? [],
    })),
    total,
    page,
    pageSize,
    pageCount,
  };
}

/** Max contacts a single "select all matching" operation (bulk action / export) will touch. */
export const MAX_SELECTION = 10_000;

/** Which contacts an operation applies to: explicit ids, or everything matching a query. */
export type ContactSelection = { ids: string[] } | { query: ContactQuery };

export async function resolveSelection(sel: ContactSelection, limit = MAX_SELECTION): Promise<string[]> {
  if ("ids" in sel) return [...new Set(sel.ids)].slice(0, limit);
  const rows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(contactQueryWhere(sel.query))
    .orderBy(desc(contacts.createdAt))
    .limit(limit);
  return rows.map((r) => r.id);
}
