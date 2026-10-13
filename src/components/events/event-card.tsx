import Link from "next/link";
import { AlertTriangle, Megaphone, MapPin, Video, Phone, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { MappedStatus, StatusBadge, EVENT_STATUS } from "@/components/app/status-badge";
import { formatInTz, formatPercent } from "@/lib/format";
import { eventLocationText } from "@/lib/email/context";
import { EVENT_TYPE_LABEL, type EventStats } from "@/lib/events/utils";
import type { Event } from "@/lib/db/schema";
import { CapacityBar } from "./capacity-bar";
import { DateBlock } from "./date-block";

/** Event summary card used on /events and campaign pages. */
export function EventCard({
  event,
  stats,
  tz,
  campaign,
  pending = 0,
  now,
}: {
  event: Event;
  stats: EventStats;
  tz: string;
  campaign?: { name: string; color: string } | null;
  /** Registered/confirmed attendees nobody marked attended/no-show yet (past events). */
  pending?: number;
  now: number;
}) {
  const eventTz = event.timezone || tz;
  const ended = event.endsAt.getTime() < now;
  const LocIcon = event.locationType === "in_person" ? MapPin : event.locationType === "phone" ? Phone : Video;
  const color = event.color ?? campaign?.color ?? null;
  return (
    <Link href={`/events/${event.id}`} className="group block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      <Card className="h-full gap-4 p-4 transition-shadow group-hover:shadow-md">
        <div className="flex items-start gap-3">
          <DateBlock date={event.startsAt} tz={eventTz} color={color} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="truncate font-semibold tracking-tight group-hover:underline">{event.title}</h3>
            </div>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3" />
              {formatInTz(event.startsAt, eventTz, "EEE d MMM, h:mm a")} – {formatInTz(event.endsAt, eventTz, "h:mm a")}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {event.status === "scheduled" && ended ? <StatusBadge tone="green">Ended</StatusBadge> : <MappedStatus map={EVENT_STATUS} value={event.status} />}
            {!event.isPublic && event.status !== "draft" && <span className="text-[11px] text-muted-foreground">Page off</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground/80">{EVENT_TYPE_LABEL[event.type] ?? "Event"}</span>
          <span className="inline-flex min-w-0 items-center gap-1">
            <LocIcon className="size-3 shrink-0" />
            <span className="truncate">{eventLocationText(event)}</span>
          </span>
          {campaign && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Megaphone className="size-3 shrink-0" style={{ color: campaign.color }} />
              <span className="truncate">{campaign.name}</span>
            </span>
          )}
        </div>
        {ended || event.status === "completed" ? (
          <div className="flex items-end justify-between gap-3">
            <div className="grid gap-0.5">
              <span className="text-2xl leading-none font-semibold tabular-nums">{formatPercent(stats.attendanceRate, 0)}</span>
              <span className="text-xs text-muted-foreground">
                attendance · {stats.attended} of {stats.nonCancelled}
              </span>
            </div>
            {pending > 0 && (
              <StatusBadge tone="amber" className="shrink-0">
                <AlertTriangle className="size-3" /> {pending} to mark
              </StatusBadge>
            )}
          </div>
        ) : (
          <CapacityBar taken={stats.seatsTaken} capacity={event.capacity} waitlisted={stats.waitlisted} color={color} />
        )}
      </Card>
    </Link>
  );
}
