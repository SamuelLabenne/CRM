import Link from "next/link";
import { ArrowRight, CalendarCheck, Percent, Target, Trophy, Video } from "lucide-react";
import { asc, isNull } from "drizzle-orm";
import { EmptyState } from "@/components/app/empty-state";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { Button } from "@/components/ui/button";
import { MeetingFilters } from "@/components/scheduling/meeting-filters";
import { MeetingsList } from "@/components/scheduling/meetings-list";
import { PotentialLeadsList } from "@/components/scheduling/potential-leads-list";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { bookingPages, users } from "@/lib/db/schema";
import { formatMoney, formatPercent } from "@/lib/format";
import {
  countMeetingTabs,
  listMeetings,
  listPotentialLeads,
  loadMeetingKpis,
  MEETING_TABS,
  type MeetingFilters as Filters,
  type MeetingTab,
} from "@/lib/scheduling/meetings";
import { addDaysToKey, resolveTimezone, startOfZonedDay } from "@/lib/scheduling/slots-core";
import { getSetting } from "@/lib/settings";
import { cn } from "@/lib/utils";

export const metadata = { title: "Meetings" };

const PAGE_SIZE = 25;
const DAY_OPTIONS = [7, 30, 90];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || null;
const dateKey = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export default async function MeetingsPage({ searchParams }: PageProps<"/meetings">) {
  await requireUser();
  const sp = await searchParams;
  const tabParam = one(sp.tab);
  const tab: MeetingTab = MEETING_TABS.some((t) => t.value === tabParam) ? (tabParam as MeetingTab) : "upcoming";
  const days = DAY_OPTIONS.includes(Number(one(sp.days))) ? Number(one(sp.days)) : 30;
  const page = Math.max(1, Number(one(sp.p)) || 1);

  const workspace = await getSetting("workspace");
  const tz = resolveTimezone(workspace.timezone);
  const fromKey = dateKey(one(sp.from));
  const toKey = dateKey(one(sp.to));
  const filters: Filters = {
    hostId: one(sp.host),
    pageId: one(sp.page),
    q: one(sp.q),
    from: fromKey ? new Date(startOfZonedDay(fromKey, tz)) : null,
    to: toKey ? new Date(startOfZonedDay(addDaysToKey(toKey, 1), tz)) : null,
  };

  const [hostRows, pageRows, kpis, tabCounts] = await Promise.all([
    db.select({ id: users.id, name: users.name }).from(users).where(isNull(users.deactivatedAt)).orderBy(asc(users.name)),
    db.select({ id: bookingPages.id, title: bookingPages.title }).from(bookingPages).orderBy(asc(bookingPages.title)),
    loadMeetingKpis(days, filters),
    countMeetingTabs(filters),
  ]);

  const tabHref = (t: MeetingTab) => {
    const q = new URLSearchParams();
    q.set("tab", t);
    if (days !== 30) q.set("days", String(days));
    return `/meetings?${q.toString()}`;
  };

  const data =
    tab === "potential"
      ? await listPotentialLeads({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, pageId: filters.pageId, q: filters.q })
      : await listMeetings(tab, filters, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const pageHref = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      const val = one(v);
      if (val && k !== "p") q.set(k, val);
    }
    if (p > 1) q.set("p", String(p));
    return `/meetings?${q.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Meetings"
        description="Booked calls, their outcomes and the leads that never finished booking."
        actions={
          <Button asChild variant="outline">
            <Link href="/scheduling">
              Booking pages <ArrowRight />
            </Link>
          </Button>
        }
      />
      <PageBody>
        <section aria-label="Key metrics" className="grid gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">Last {days} days</h2>
            <div className="inline-flex rounded-lg border p-0.5 text-xs">
              {DAY_OPTIONS.map((d) => {
                const q = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (one(v) && k !== "days" && k !== "p" ? [[k, one(v)!]] : [])));
                if (d !== 30) q.set("days", String(d));
                return (
                  <Link key={d} href={`/meetings?${q.toString()}`} className={cn("rounded-md px-2.5 py-1 font-medium", d === days ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>
                    {d}d
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label="Meetings booked" icon={CalendarCheck} value={kpis.booked} hint={kpis.bookedCancelled ? `${kpis.bookedCancelled} cancelled` : "booked in period"} />
            <StatCard label="Show-up rate" icon={Percent} value={formatPercent(kpis.showUpRate)} hint={`${kpis.attended} attended · ${kpis.noShow} no-show`} />
            <StatCard label="Closing rate" icon={Target} value={formatPercent(kpis.closingRate)} hint={`${kpis.won} won of ${kpis.withOutcome}`} />
            <StatCard label="Won value" icon={Trophy} value={formatMoney(kpis.wonValue, workspace.currency)} hint="from won meetings" />
            <StatCard
              label="Pending outcomes"
              icon={Video}
              value={kpis.pendingOutcomes}
              hint={kpis.pendingOutcomes ? <Link className="underline" href={tabHref("needs_outcome")}>Log them now</Link> : "all caught up"}
              className={cn(kpis.pendingOutcomes > 0 && "border-amber-500/40")}
            />
          </div>
        </section>

        <div className="-mb-2 overflow-x-auto" role="tablist" aria-label="Meeting views">
          <nav className="flex min-w-max gap-1 border-b">
            {MEETING_TABS.map((t) => (
              <Link
                key={t.value}
                href={tabHref(t.value)}
                role="tab"
                aria-selected={tab === t.value}
                className={cn(
                  "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  tab === t.value ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[11px] tabular-nums",
                    t.value === "needs_outcome" && tabCounts[t.value] > 0 ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground",
                  )}
                >
                  {tabCounts[t.value]}
                </span>
              </Link>
            ))}
          </nav>
        </div>

        <MeetingFilters hosts={hostRows} pages={pageRows} showHostAndDates={tab !== "potential"} />

        {data.total === 0 ? (
          <EmptyState
            icon={Video}
            title={tab === "potential" ? "No potential leads" : tab === "needs_outcome" ? "Nothing waiting for an outcome" : tab === "cancelled" ? "No cancelled meetings" : "No meetings here yet"}
            description={
              tab === "potential"
                ? "People who start a booking or registration form but never finish will show up here so you can follow up."
                : tab === "needs_outcome"
                  ? "Great – every past meeting has an outcome logged."
                  : "Meetings appear here as soon as someone books through one of your booking pages."
            }
            action={
              tab === "upcoming" || tab === "past" ? (
                <Button asChild>
                  <Link href="/scheduling">Open booking pages</Link>
                </Button>
              ) : undefined
            }
          />
        ) : tab === "potential" ? (
          <PotentialLeadsList rows={(data as Awaited<ReturnType<typeof listPotentialLeads>>).rows} timezone={tz} />
        ) : (
          <MeetingsList rows={(data as Awaited<ReturnType<typeof listMeetings>>).rows} timezone={tz} currency={workspace.currency} />
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Page {page} of {totalPages} · {data.total} total
            </span>
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm" disabled={page <= 1}>
                <Link href={pageHref(page - 1)} aria-disabled={page <= 1} className={page <= 1 ? "pointer-events-none opacity-50" : ""}>
                  Previous
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={pageHref(page + 1)} aria-disabled={page >= totalPages} className={page >= totalPages ? "pointer-events-none opacity-50" : ""}>
                  Next
                </Link>
              </Button>
            </div>
          </div>
        )}
      </PageBody>
    </>
  );
}
