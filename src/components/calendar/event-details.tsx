"use client";

import Link from "next/link";
import {
  CalendarClock,
  CheckSquare,
  ExternalLink,
  ListChecks,
  Mail,
  MapPin,
  Megaphone,
  Phone,
  ScanLine,
  Users,
  Video,
} from "lucide-react";
import type { CalendarEventProps } from "@/lib/analytics/calendar";
import { formatInTz, formatPercent, formatTimeRange } from "@/lib/format";
import { showUpRate } from "@/lib/analytics/metrics";
import { MappedStatus, EVENT_STATUS, BROADCAST_STATUS, CAMPAIGN_STATUS, OUTCOME } from "@/components/app/status-badge";
import { UserAvatar } from "@/components/app/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { EVENT_TYPE_OPTIONS, KIND_LABEL } from "./constants";

export type SelectedCalendarEvent = { el: HTMLElement; props: CalendarEventProps; color: string };

const typeLabel = (t: string | null) => EVENT_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t ?? "";

function Row({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-2 py-1.5 text-center">
      <div className={`text-base font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function whenText(p: CalendarEventProps, tz: string) {
  if (p.allDay) {
    const s = p.startsAt;
    const e = p.endsAt ?? p.startsAt;
    const fmt = (d: string) => formatInTz(new Date(`${d}T12:00:00Z`), "UTC", "EEE d MMM yyyy");
    return s === e ? fmt(s) : `${fmt(s)} – ${fmt(e)}`;
  }
  if (p.endsAt) return formatTimeRange(new Date(p.startsAt), new Date(p.endsAt), tz);
  return formatInTz(new Date(p.startsAt), tz, "EEE d MMM yyyy, HH:mm");
}

export function EventDetailsBody({ p, color, tz }: { p: CalendarEventProps; color: string; tz: string }) {
  const isEvent = p.kind === "event";
  const isMeeting = p.kind === "meeting";
  const c = p.counts;
  const rate = c ? showUpRate(c.attended, c.noShow) : null;
  const unmarked = c ? Math.max(0, c.registered - c.attended - c.noShow) : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2.5 pr-6">
        <span className="mt-1.5 size-3 shrink-0 rounded-full" style={{ background: color }} />
        <div className="min-w-0 flex-1">
          <div className="text-base leading-snug font-semibold break-words">{p.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="font-normal">
              {KIND_LABEL[p.kind]}
              {p.eventType && p.kind === "event" ? ` · ${typeLabel(p.eventType)}` : ""}
            </Badge>
            {(isEvent || isMeeting) && <MappedStatus map={EVENT_STATUS} value={p.status} />}
            {p.kind === "broadcast" && <MappedStatus map={BROADCAST_STATUS} value={p.status} />}
            {p.kind === "campaign" && <MappedStatus map={CAMPAIGN_STATUS} value={p.status} />}
            {p.kind === "task" && (
              <Badge variant="secondary" className={p.status === "overdue" ? "bg-red-500/10 text-red-700 dark:text-red-300" : ""}>
                {p.status === "overdue" ? "Overdue" : "Open"}
              </Badge>
            )}
            {isMeeting && p.outcome && <MappedStatus map={OUTCOME} value={p.outcome} />}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Row icon={CalendarClock}>
          <div>{whenText(p, tz)}</div>
          {!p.allDay && <div className="text-xs text-muted-foreground">{tz.replace(/_/g, " ")}</div>}
        </Row>

        {(isEvent || isMeeting) && p.locationType && (
          <Row icon={p.locationType === "in_person" ? MapPin : p.locationType === "phone" ? Phone : Video}>
            {p.locationType === "in_person" && (p.location || "In person")}
            {p.locationType === "phone" && (p.location ? `Phone call (${p.location})` : "Phone call")}
            {p.locationType === "online" &&
              (p.meetingUrl ? (
                <a href={p.meetingUrl} target="_blank" rel="noreferrer" className="break-all text-primary underline-offset-4 hover:underline">
                  {p.meetingUrl.replace(/^https?:\/\//, "")}
                </a>
              ) : (
                (p.location ?? "Online")
              ))}
          </Row>
        )}

        {p.contact && (
          <Row icon={Users}>
            {p.contact.id ? (
              <Link href={`/contacts/${p.contact.id}`} className="font-medium hover:underline">
                {p.contact.name}
              </Link>
            ) : (
              p.contact.name
            )}
          </Row>
        )}

        {p.campaign && p.kind !== "campaign" && (
          <Row icon={Megaphone}>
            <Link href={`/campaigns/${p.campaign.id}`} className="inline-flex items-center gap-1.5 hover:underline">
              <span className="size-2 rounded-full" style={{ background: p.campaign.color }} />
              {p.campaign.name}
            </Link>
          </Row>
        )}

        {p.host && (
          <Row icon={Users}>
            <span className="inline-flex items-center gap-1.5">
              <UserAvatar name={p.host.name} color={p.host.color} className="size-5 rounded-md" />
              <span>Hosted by {p.host.name}</span>
            </span>
          </Row>
        )}

        {p.kind === "broadcast" && p.broadcastInfo && (
          <Row icon={Mail}>
            <div className="font-medium">{p.broadcastInfo.subject || "No subject"}</div>
            <div className="text-xs text-muted-foreground">
              {p.status === "scheduled" ? "Scheduled for" : "Sent to"} {p.broadcastInfo.recipientCount > 0 ? `${p.broadcastInfo.recipientCount} recipients` : "the selected audience"}
            </div>
          </Row>
        )}

        {p.kind === "task" && p.taskInfo && (
          <Row icon={CheckSquare}>
            <span className="capitalize">{p.taskInfo.priority} priority</span>
          </Row>
        )}
      </div>

      {p.kind === "campaign" && p.campaignInfo && (
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Events" value={p.campaignInfo.events} />
          <Stat label="Registrations" value={p.campaignInfo.registrations} />
        </div>
      )}

      {(isEvent || isMeeting) && c && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Attendance</div>
          <div className={`grid gap-2 ${isEvent ? "grid-cols-3" : "grid-cols-3"}`}>
            <Stat label={c.capacity ? `Registered / ${c.capacity}` : "Registered"} value={c.registered} />
            <Stat label="Attended" value={c.attended} tone="text-emerald-600 dark:text-emerald-400" />
            <Stat label="No-show" value={c.noShow} tone={c.noShow ? "text-red-600 dark:text-red-400" : ""} />
          </div>
          <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            {c.waitlisted > 0 && <span>{c.waitlisted} waitlisted</span>}
            {rate != null && <span>Show-up rate {formatPercent(rate, 0)}</span>}
            {p.isPast && unmarked > 0 && <span className="font-medium text-amber-700 dark:text-amber-300">{unmarked} not marked yet</span>}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {isEvent && (
          <>
            <Button size="sm" asChild>
              <Link href={`/events/${p.entityId}`}>
                <ExternalLink /> Open
              </Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href={`/events/${p.entityId}?tab=attendees`}>
                <ListChecks /> Mark attendance
              </Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href={`/events/${p.entityId}/check-in`}>
                <ScanLine /> Check-in
              </Link>
            </Button>
          </>
        )}
        {isMeeting && (
          <>
            <Button size="sm" asChild>
              <Link href="/meetings">
                <Video /> View in Meetings
              </Link>
            </Button>
            {p.contact?.id && (
              <Button size="sm" variant="outline" asChild>
                <Link href={`/contacts/${p.contact.id}`}>
                  <Users /> Contact
                </Link>
              </Button>
            )}
          </>
        )}
        {p.kind === "campaign" && (
          <Button size="sm" asChild>
            <Link href={p.href}>
              <Megaphone /> Open campaign
            </Link>
          </Button>
        )}
        {p.kind === "broadcast" && (
          <Button size="sm" asChild>
            <Link href={p.href}>
              <Mail /> Open broadcast
            </Link>
          </Button>
        )}
        {p.kind === "task" && (
          <>
            <Button size="sm" asChild>
              <Link href="/tasks">
                <CheckSquare /> Open tasks
              </Link>
            </Button>
            {p.taskInfo?.contactId && (
              <Button size="sm" variant="outline" asChild>
                <Link href={`/contacts/${p.taskInfo.contactId}`}>
                  <Users /> Contact
                </Link>
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Popover anchored on the clicked calendar event (desktop) or bottom sheet (mobile). */
export function EventDetails({
  selected,
  timezone,
  onClose,
}: {
  selected: SelectedCalendarEvent | null;
  timezone: string;
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  if (!selected) return null;

  if (isMobile) {
    return (
      <Sheet open onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl p-4">
          <SheetHeader className="sr-only p-0">
            <SheetTitle>{selected.props.title}</SheetTitle>
            <SheetDescription>Details</SheetDescription>
          </SheetHeader>
          <EventDetailsBody p={selected.props} color={selected.color} tz={timezone} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open onOpenChange={(o) => !o && onClose()}>
      <PopoverAnchor virtualRef={{ current: selected.el }} />
      <PopoverContent side="right" align="start" sideOffset={8} collisionPadding={16} className="w-[22rem] gap-0 p-4">
        <EventDetailsBody p={selected.props} color={selected.color} tz={timezone} />
      </PopoverContent>
    </Popover>
  );
}
