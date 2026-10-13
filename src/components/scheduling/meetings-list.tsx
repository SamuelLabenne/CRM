import Link from "next/link";
import { MappedStatus, ATTENDEE_STATUS, OUTCOME, StatusBadge } from "@/components/app/status-badge";
import { UserAvatar } from "@/components/app/user-avatar";
import { formatInTz, formatMoney, timeAgo } from "@/lib/format";
import type { MeetingRow } from "@/lib/scheduling/meetings";
import { AnswersPopover } from "./answers-popover";
import { MeetingActions } from "./meeting-actions";

const OBJECTION_LABEL: Record<string, string> = {
  money: "Money",
  timing: "Timing",
  partner: "Partner",
  fear: "Fear",
  smoke_screen: "Smoke screen",
  no_objection: "No objection",
};

export function MeetingsList({ rows, timezone, currency }: { rows: MeetingRow[]; timezone: string; currency: string }) {
  const nowMs = new Date().getTime();
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <ul className="divide-y">
        {rows.map((r) => {
          const cancelled = r.status === "cancelled" || r.eventStatus === "cancelled";
          const past = r.endsAt.getTime() < nowMs;
          const needsOutcome = !cancelled && past && !r.outcome;
          return (
            <li key={r.attendeeId} className="grid gap-3 p-4 md:grid-cols-[10.5rem_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)] md:items-center">
              <div className="text-sm">
                <div className="font-semibold">{formatInTz(r.startsAt, timezone, "EEE d MMM yyyy")}</div>
                <div className="text-muted-foreground">
                  {formatInTz(r.startsAt, timezone, "HH:mm")} – {formatInTz(r.endsAt, timezone, "HH:mm")}
                </div>
                <div className="text-xs text-muted-foreground">{timeAgo(r.startsAt)}</div>
              </div>
              <div className="flex min-w-0 items-center gap-3">
                <UserAvatar name={r.contact.name} className="size-9 shrink-0" />
                <div className="min-w-0">
                  <Link href={`/contacts/${r.contact.id}`} className="block truncate text-sm font-medium hover:underline">
                    {r.contact.name}
                  </Link>
                  <div className="truncate text-xs text-muted-foreground">{r.contact.email ?? r.contact.phone ?? ""}</div>
                </div>
              </div>
              <div className="min-w-0 text-sm">
                {r.host ? (
                  <div className="flex items-center gap-2">
                    <UserAvatar name={r.host.name} color={r.host.color} className="size-5 shrink-0 rounded-full text-[9px]" />
                    <span className="truncate">{r.host.name}</span>
                  </div>
                ) : (
                  <span className="text-muted-foreground">No host</span>
                )}
                <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                  {r.page && <span className="size-2 shrink-0 rounded-full" style={{ background: r.page.color }} />}
                  <span className="truncate">{r.page?.title ?? "Manual meeting"}</span>
                </div>
              </div>
              <div className="flex flex-col gap-2 md:items-end">
                <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
                  {cancelled ? (
                    <StatusBadge tone="neutral">Cancelled</StatusBadge>
                  ) : r.outcome ? (
                    <MappedStatus map={OUTCOME} value={r.outcome} />
                  ) : needsOutcome ? (
                    <StatusBadge tone="amber">Needs outcome</StatusBadge>
                  ) : (
                    <MappedStatus map={ATTENDEE_STATUS} value={r.status} />
                  )}
                  {r.outcome === "won" && r.dealValue != null && <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">{formatMoney(r.dealValue, currency)}</span>}
                  {r.objection && r.objection !== "no_objection" && <StatusBadge tone="violet">{OBJECTION_LABEL[r.objection] ?? r.objection}</StatusBadge>}
                  {r.page && Object.keys(r.answers).length > 0 && <AnswersPopover questions={r.page.questions} answers={r.answers} />}
                </div>
                <MeetingActions
                  row={{
                    attendeeId: r.attendeeId,
                    contactId: r.contact.id,
                    contactName: r.contact.name,
                    title: r.title,
                    manageToken: r.manageToken,
                    cancelled,
                    past,
                    status: r.status,
                    outcome: r.outcome,
                    objection: r.objection,
                    notes: r.outcomeNotes,
                    dealValue: r.dealValue,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
