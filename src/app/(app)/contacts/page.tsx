import Link from "next/link";
import { desc, eq, or } from "drizzle-orm";
import { Download, Upload, UserPlus, Users, SearchX } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { ContactsTable } from "@/components/contacts/contacts-table";
import { ContactsToolbar, type ViewPill } from "@/components/contacts/contacts-toolbar";
import { Pager } from "@/components/contacts/pager";
import { db } from "@/lib/db";
import { events, savedViews } from "@/lib/db/schema";
import { isAdmin, requireUser } from "@/lib/auth";
import { getWorkspace } from "@/lib/settings";
import { fullName, formatDate, timeAgo } from "@/lib/format";
import { decodeFilter, encodeFilter, EMPTY_FILTER, sanitizeFilterGroup } from "@/lib/contacts/filter-codec";
import { CONTACT_SORTS, QUICK_FILTER_KEYS, listContacts, mergeQuickIntoGroup, type ContactSort, type QuickFilters } from "@/lib/contacts/query";
import { loadReferenceData } from "@/lib/contacts/form-data";
import type { ContactRowDTO } from "@/lib/contacts/dto";

export const metadata = { title: "Contacts" };

const PAGE_SIZE = 50;
const DEFAULT_DIR: Record<ContactSort, "asc" | "desc"> = { name: "asc", company: "asc", stage: "asc", created: "desc", last_activity: "desc", deal_value: "desc" };

export default async function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  const user = await requireUser();
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

  const q = get("q")?.trim() ?? "";
  const sort: ContactSort = (CONTACT_SORTS as readonly string[]).includes(get("sort") ?? "") ? (get("sort") as ContactSort) : "created";
  const dir = get("dir") === "asc" || get("dir") === "desc" ? (get("dir") as "asc" | "desc") : DEFAULT_DIR[sort];
  const page = Math.max(1, Number.parseInt(get("page") ?? "1", 10) || 1);
  const quick: QuickFilters = {};
  for (const k of QUICK_FILTER_KEYS) {
    const v = get(k);
    if (v) quick[k] = v;
  }

  const [ref, workspace, viewRows, eventRows] = await Promise.all([
    loadReferenceData(),
    getWorkspace(),
    db
      .select()
      .from(savedViews)
      .where(or(eq(savedViews.visibility, "shared"), eq(savedViews.ownerId, user.id)))
      .orderBy(savedViews.name),
    db.select({ id: events.id, title: events.title }).from(events).orderBy(desc(events.startsAt)).limit(100),
  ]);

  const activeView = viewRows.find((v) => v.id === get("view")) ?? null;
  const fParam = get("f");
  const group = fParam !== undefined ? (decodeFilter(fParam) ?? EMPTY_FILTER) : activeView ? sanitizeFilterGroup(activeView.filters) : EMPTY_FILTER;
  const mergedGroup = mergeQuickIntoGroup(quick, group);
  const viewDirty = activeView ? !mergedGroup || encodeFilter(mergedGroup) !== encodeFilter(activeView.filters) : false;

  const result = await listContacts({ q, quick, filter: group }, { sort, dir, page, pageSize: PAGE_SIZE });
  const tz = workspace.timezone;

  const rows: ContactRowDTO[] = result.rows.map((c) => ({
    id: c.id,
    name: fullName(c),
    email: c.email,
    phone: c.phone,
    company: c.company,
    jobTitle: c.jobTitle,
    stage: c.stage,
    leadStatus: c.leadStatus,
    emailStatus: c.emailStatus,
    dealValue: c.dealValue,
    tags: c.tags,
    owner: c.owner,
    lastActivity: c.lastActivityAt ? timeAgo(c.lastActivityAt) : "—",
    created: formatDate(c.createdAt, tz),
  }));

  const views: ViewPill[] = viewRows.map((v) => ({
    id: v.id,
    name: v.name,
    description: v.description,
    visibility: v.visibility,
    ownerId: v.ownerId,
    href: `/contacts?view=${v.id}&f=${encodeFilter(v.filters)}`,
    canEdit: v.ownerId === user.id || isAdmin(user),
  }));

  // Query string shared by pagination, sorting and export links.
  const base = new URLSearchParams();
  if (q) base.set("q", q);
  if (fParam !== undefined) base.set("f", fParam);
  if (activeView) base.set("view", activeView.id);
  if (get("sort")) base.set("sort", sort);
  if (get("dir")) base.set("dir", dir);
  for (const [k, v] of Object.entries(quick)) if (v) base.set(k, v);
  const withParams = (extra: Record<string, string>) => {
    const p = new URLSearchParams(base);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/contacts?${p.toString()}`;
  };
  const sortHrefs = Object.fromEntries(
    CONTACT_SORTS.map((s) => [s, withParams({ sort: s, dir: s === sort ? (dir === "asc" ? "desc" : "asc") : DEFAULT_DIR[s] })]),
  );
  const exportParams = new URLSearchParams();
  if (q) exportParams.set("q", q);
  const effectiveF = encodeFilter(group);
  if (effectiveF) exportParams.set("f", effectiveF);
  for (const [k, v] of Object.entries(quick)) if (v) exportParams.set(k, v);
  const exportQuery = exportParams.toString();

  const filtered = Boolean(q || encodeFilter(group) || Object.keys(quick).length);

  return (
    <>
      <PageHeader
        title="Contacts"
        description={`${result.total.toLocaleString("en-AU")} ${result.total === 1 ? "person" : "people"}${filtered ? " match your filters" : " in your CRM"}`}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/contacts/import">
                <Upload /> Import
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`/contacts/export?${exportQuery}`} download>
                <Download /> Export
              </a>
            </Button>
            <Button size="sm" asChild>
              <Link href="/contacts/new">
                <UserPlus /> New contact
              </Link>
            </Button>
          </>
        }
      />
      <PageBody>
        <ContactsToolbar
          q={q}
          group={group}
          quick={quick}
          views={views}
          activeViewId={activeView?.id ?? null}
          viewDirty={viewDirty}
          mergedGroup={mergedGroup}
          total={result.total}
          options={{ tags: ref.tags, users: ref.users, stages: ref.stages, customFields: ref.customFields, events: eventRows }}
        />
        {result.total === 0 ? (
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="No contacts match"
              description="Try removing a filter or searching for something else."
              action={
                <Button variant="outline" asChild>
                  <Link href="/contacts">Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Users}
              title="No contacts yet"
              description="Add your first contact or import a CSV from another tool to get started."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button asChild>
                    <Link href="/contacts/new">
                      <UserPlus /> New contact
                    </Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link href="/contacts/import">
                      <Upload /> Import CSV
                    </Link>
                  </Button>
                </div>
              }
            />
          )
        ) : (
          <>
            <ContactsTable
              key={`${page}-${exportQuery}`}
              rows={rows}
              total={result.total}
              stages={ref.stages}
              users={ref.users}
              tags={ref.tags}
              timezone={tz}
              currency={workspace.currency}
              query={{ q: q || undefined, f: effectiveF || undefined, quick: { ...quick } }}
              exportQuery={exportQuery}
              sort={sort}
              dir={dir}
              sortHrefs={sortHrefs}
            />
            <Pager page={result.page} pageCount={result.pageCount} total={result.total} pageSize={PAGE_SIZE} hrefFor={(p) => withParams({ page: String(p) })} />
          </>
        )}
      </PageBody>
    </>
  );
}
