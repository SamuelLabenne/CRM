import Link from "next/link";
import { ArrowRight, CalendarDays, ClipboardCheck, Plus, SearchX } from "lucide-react";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EventCard } from "@/components/events/event-card";
import { EventFilters } from "@/components/events/event-filters";
import { TabLinks } from "@/components/events/tab-links";
import { formatInTz } from "@/lib/format";
import { EVENT_TABS, countEventsByTab, eventsNeedingAttendance, listEvents, type EventTab } from "@/lib/events/queries";
import { currentTimeMs } from "@/lib/events/utils";

export const metadata = { title: "Events" };

const TAB_LABEL: Record<EventTab, string> = { upcoming: "Upcoming", past: "Past", drafts: "Drafts", all: "All" };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function EventsPage({ searchParams }: PageProps<"/events">) {
  await requireUser();
  const sp = await searchParams;
  const tab = (EVENT_TABS as string[]).includes(first(sp.tab)) ? (first(sp.tab) as EventTab) : "upcoming";
  const filters = { q: first(sp.q), campaignId: first(sp.campaign) || undefined, type: first(sp.type) || undefined };
  const page = Math.max(1, Number(first(sp.page)) || 1);

  const [ws, list, counts, needs, campaignRows] = await Promise.all([
    getSetting("workspace"),
    listEvents({ tab, page, ...filters }),
    countEventsByTab(filters),
    eventsNeedingAttendance(6),
    db.select({ id: campaigns.id, name: campaigns.name, color: campaigns.color }).from(campaigns).orderBy(asc(campaigns.name)),
  ]);
  const campaignById = new Map(campaignRows.map((c) => [c.id, c]));
  const now = currentTimeMs();
  const hasFilters = !!(filters.q || filters.campaignId || filters.type);
  const totalPages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const tabHref = (t: EventTab) => {
    const p = new URLSearchParams();
    if (t !== "upcoming") p.set("tab", t);
    for (const [k, v] of [["q", filters.q], ["campaign", filters.campaignId], ["type", filters.type]] as const) if (v) p.set(k, v);
    return `/events${p.size ? `?${p}` : ""}`;
  };
  const pageHref = (n: number) => {
    const p = new URLSearchParams();
    if (tab !== "upcoming") p.set("tab", tab);
    for (const [k, v] of [["q", filters.q], ["campaign", filters.campaignId], ["type", filters.type]] as const) if (v) p.set(k, v);
    if (n > 1) p.set("page", String(n));
    return `/events${p.size ? `?${p}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Events"
        description="Webinars, workshops and meetups with registrations, attendance and check-in."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/calendar">
                <CalendarDays /> Calendar
              </Link>
            </Button>
            <Button asChild>
              <Link href="/events/new">
                <Plus /> New event
              </Link>
            </Button>
          </>
        }
      />
      <PageBody>
        {needs.length > 0 && (
          <Card className="gap-3 border-amber-500/40 bg-amber-500/5 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
              <ClipboardCheck className="size-4" />
              Needs attendance
              <span className="rounded-full bg-amber-500/20 px-1.5 text-xs tabular-nums">{needs.length}</span>
            </div>
            <p className="-mt-1 text-sm text-muted-foreground">These events have finished but some registrants haven&apos;t been marked as attended or no-show.</p>
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {needs.map(({ event, pending }) => (
                <li key={event.id} className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <Link href={`/events/${event.id}`} className="block truncate text-sm font-medium hover:underline">
                      {event.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {formatInTz(event.startsAt, event.timezone || ws.timezone, "d MMM, h:mm a")} · {pending} to mark
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/events/${event.id}/check-in`}>
                      Mark <ArrowRight />
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <div className="grid gap-3">
          <TabLinks active={tab} tabs={EVENT_TABS.map((t) => ({ key: t, label: TAB_LABEL[t], href: tabHref(t), count: counts[t] }))} />
          <EventFilters campaigns={campaignRows.map((c) => ({ id: c.id, name: c.name }))} />
        </div>

        {list.rows.length === 0 ? (
          hasFilters ? (
            <EmptyState icon={SearchX} title="No events match your filters" description="Try a different search or clear the filters." />
          ) : counts.all === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="Create your first event"
              description="Set up a webinar, workshop or meetup, share the registration page and track who shows up."
              action={
                <Button asChild>
                  <Link href="/events/new">
                    <Plus /> New event
                  </Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={CalendarDays}
              title={tab === "upcoming" ? "No upcoming events" : tab === "past" ? "No past events yet" : tab === "drafts" ? "No drafts" : "No events"}
              description={tab === "upcoming" ? "Schedule an event to start collecting registrations." : undefined}
              action={
                tab === "upcoming" ? (
                  <Button asChild>
                    <Link href="/events/new">
                      <Plus /> New event
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          )
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {list.rows.map(({ event, stats }) => (
                <EventCard
                  key={event.id}
                  event={event}
                  stats={stats}
                  tz={ws.timezone}
                  campaign={event.campaignId ? campaignById.get(event.campaignId) : null}
                  pending={event.endsAt.getTime() < now && event.status !== "cancelled" ? stats.registered + stats.confirmed : 0}
                  now={now}
                />
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  Page {page} of {totalPages} · {list.total} events
                </span>
                <div className="flex gap-2">
                  {page > 1 && (
                    <Button asChild variant="outline" size="sm">
                      <Link href={pageHref(page - 1)}>Previous</Link>
                    </Button>
                  )}
                  {page < totalPages && (
                    <Button asChild variant="outline" size="sm">
                      <Link href={pageHref(page + 1)}>Next</Link>
                    </Button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}
