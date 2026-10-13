import Link from "next/link";
import { Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AddAttendeeDialog } from "@/components/events/add-attendee-dialog";
import { AttendeesEmpty, AttendeesTable, type AttendeeTableRow } from "@/components/events/attendees-table";
import { EmptyState } from "@/components/app/empty-state";
import { TabLinks } from "@/components/events/tab-links";
import { Users } from "lucide-react";
import { fullName, formatInTz } from "@/lib/format";
import { listAttendees, eventStatsMap } from "@/lib/events/queries";
import type { Event } from "@/lib/db/schema";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const STATUS_TABS = [
  ["all", "All"],
  ["registered", "Registered"],
  ["confirmed", "Confirmed"],
  ["waitlisted", "Waitlisted"],
  ["attended", "Attended"],
  ["no_show", "No-show"],
  ["cancelled", "Cancelled"],
] as const;

export async function AttendeesTab({ event, tz, sp }: { event: Event; tz: string; sp: Record<string, string | string[] | undefined> }) {
  const status = STATUS_TABS.some(([k]) => k === first(sp.status)) ? first(sp.status) : "all";
  const q = first(sp.q).trim();
  const page = Math.max(1, Number(first(sp.page)) || 1);
  const [list, stats] = await Promise.all([listAttendees(event.id, { status, q, page }), eventStatsMap([event.id]).then((m) => m.get(event.id)!)]);
  const counts: Record<string, number> = {
    all: stats.nonCancelled + stats.cancelled,
    registered: stats.registered,
    confirmed: stats.confirmed,
    waitlisted: stats.waitlisted,
    attended: stats.attended,
    no_show: stats.noShow,
    cancelled: stats.cancelled,
  };
  const questions = event.registrationQuestions;
  const rows: AttendeeTableRow[] = list.rows.map((r) => ({
    id: r.id,
    contactId: r.contactId,
    name: fullName(r),
    email: r.email,
    company: r.company,
    status: r.status,
    rsvp: r.rsvp,
    source: r.source,
    registeredLabel: formatInTz(r.registeredAt, tz, "d MMM yyyy, h:mm a"),
    checkedInLabel: r.checkedInAt ? formatInTz(r.checkedInAt, tz, "d MMM, h:mm a") : null,
    cancelReason: r.cancelReason,
    answers: questions
      .map((qn) => {
        const v = r.answers[qn.id];
        return { label: qn.label, value: v == null ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v) };
      })
      .filter((a) => a.value !== ""),
  }));
  const totalPages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const href = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ tab: "attendees" });
    if (status !== "all") p.set("status", status);
    if (q) p.set("q", q);
    for (const [k, v] of Object.entries(extra)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    return `/events/${event.id}?${p}`;
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <form action={`/events/${event.id}`} className="relative min-w-52 flex-1 sm:max-w-xs">
          <input type="hidden" name="tab" value="attendees" />
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={q} placeholder="Search name, email, company…" className="pl-8" aria-label="Search attendees" />
        </form>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <a href={`/events/${event.id}/export`}>
              <Download /> Export CSV
            </a>
          </Button>
          <AddAttendeeDialog eventId={event.id} />
        </div>
      </div>
      <TabLinks active={status} tabs={STATUS_TABS.map(([k, label]) => ({ key: k, label, count: counts[k], href: href({ status: k === "all" ? "" : k, page: "" }) }))} />
      {rows.length === 0 ? (
        counts.all === 0 && !q ? (
          <EmptyState icon={Users} title="No attendees yet" description="Share the registration page or add people manually." action={<AddAttendeeDialog eventId={event.id} />} />
        ) : (
          <AttendeesEmpty />
        )
      ) : (
        <AttendeesTable rows={rows} />
      )}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages} · {list.total} attendees
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Button asChild variant="outline" size="sm">
                <Link href={href({ page: String(page - 1) })}>Previous</Link>
              </Button>
            )}
            {page < totalPages && (
              <Button asChild variant="outline" size="sm">
                <Link href={href({ page: String(page + 1) })}>Next</Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
