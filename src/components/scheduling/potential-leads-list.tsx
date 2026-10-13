import Link from "next/link";
import { StatusBadge } from "@/components/app/status-badge";
import { UserAvatar } from "@/components/app/user-avatar";
import { formatInTz, timeAgo } from "@/lib/format";
import type { PotentialLead } from "@/lib/scheduling/meetings";
import { AnswersPopover } from "./answers-popover";
import { LeadActions } from "./lead-actions";

const STATUS: Record<PotentialLead["status"], { label: string; tone: "amber" | "sky" | "red"; note: string }> = {
  partial: { label: "Potential", tone: "amber", note: "Left after entering their details" },
  qualified: { label: "Qualified", tone: "sky", note: "Passed the questions but did not pick a time" },
  disqualified: { label: "Screened out", tone: "red", note: "Matched a disqualification rule" },
};

export function PotentialLeadsList({ rows, timezone }: { rows: PotentialLead[]; timezone: string }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <ul className="divide-y">
        {rows.map((r) => {
          const s = STATUS[r.status];
          return (
            <li key={r.id} className="grid gap-3 p-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.5fr)] md:items-center">
              <div className="flex min-w-0 items-center gap-3">
                <UserAvatar name={r.contact.name} className="size-9 shrink-0" />
                <div className="min-w-0">
                  <Link href={`/contacts/${r.contact.id}`} className="block truncate text-sm font-medium hover:underline">
                    {r.contact.name}
                  </Link>
                  <div className="truncate text-xs text-muted-foreground">{[r.contact.email, r.contact.phone].filter(Boolean).join(" · ")}</div>
                </div>
              </div>
              <div className="min-w-0 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                  <span className="text-xs text-muted-foreground" title={formatInTz(r.createdAt, timezone, "EEE d MMM yyyy, HH:mm")}>
                    {timeAgo(r.createdAt)}
                  </span>
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {r.kind === "booking" ? "Booking" : "Registration"}:{" "}
                  {r.target ? (
                    <Link href={r.target.href} className="hover:underline">
                      {r.target.title}
                    </Link>
                  ) : (
                    "deleted"
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {s.note}
                  {r.utm.source ? ` · via ${r.utm.source}` : ""}
                </div>
              </div>
              <div className="flex flex-col gap-2 md:items-end">
                {r.questions.length > 0 && Object.keys(r.answers).length > 0 && <AnswersPopover questions={r.questions} answers={r.answers} />}
                <LeadActions contactId={r.contact.id} name={r.contact.name} email={r.contact.email} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
