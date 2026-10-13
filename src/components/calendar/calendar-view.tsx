"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckSquare, Mail } from "lucide-react";
import { toast } from "sonner";
import FullCalendar, { useCalendarController, type CalendarRef, type EventDisplayInfo, type EventDropInfo, type EventResizeDoneInfo } from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import listPlugin from "@fullcalendar/react/list";
import interactionPlugin from "@fullcalendar/react/interaction";
import classicTheme from "@fullcalendar/react/themes/classic";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "./calendar.css";
import { moveEventAction } from "@/app/(app)/calendar/actions";
import type { CalendarEventProps } from "@/lib/analytics/calendar";
import { formatInTz } from "@/lib/format";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { CalendarToolbar } from "./calendar-toolbar";
import { DEFAULT_FILTERS, filtersToParams, type CalendarFilterState } from "./constants";
import { EventDetails, type SelectedCalendarEvent } from "./event-details";
import { QuickCreateDialog, type QuickCreateDraft } from "./quick-create-dialog";

const PLUGINS = [dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, classicTheme];
const TIME_FORMAT = { hour: "2-digit", minute: "2-digit", hour12: false } as const;
const STORAGE_KEY = "relay.calendar.filters.v1";
const WALL = "yyyy-MM-dd'T'HH:mm";

type PendingMove = {
  eventId: string;
  title: string;
  attendees: number;
  startsAt: Date;
  endsAt: Date;
  revert: () => void;
};

function renderEventContent(info: EventDisplayInfo) {
  const kind = (info.event.extendedProps as CalendarEventProps).kind;
  const Icon = kind === "broadcast" ? Mail : kind === "task" ? CheckSquare : null;
  return (
    <>
      {info.timeText && <div className={info.timeClass}>{info.timeText}</div>}
      <div className={`${info.titleClass} flex items-center gap-1`}>
        {Icon && <Icon className="size-3 shrink-0" aria-hidden />}
        <span className="truncate">{info.event.title || " "}</span>
      </div>
    </>
  );
}

export function CalendarView({
  timezone,
  weekStartsOn,
  campaigns,
  initialView,
  initialDate,
}: {
  timezone: string;
  weekStartsOn: 0 | 1;
  campaigns: { id: string; name: string; color: string }[];
  initialView?: string;
  initialDate?: string;
}) {
  const controller = useCalendarController();
  const calRef = useRef<CalendarRef>(null);

  // FullCalendar measures the DOM, so it is only rendered after mount (also avoids hydration mismatches).
  const [mountedView, setMountedView] = useState<string | null>(null);
  const [filters, setFilters] = useState<CalendarFilterState>(DEFAULT_FILTERS);
  const filtersRef = useRef(filters);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<SelectedCalendarEvent | null>(null);
  const [draft, setDraft] = useState<QuickCreateDraft | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [moving, setMoving] = useState(false);

  // Restore saved filters and pick a sensible default view (list on phones) once on the client.
  useEffect(() => {
    let saved: CalendarFilterState | null = null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) saved = { ...DEFAULT_FILTERS, ...(JSON.parse(raw) as Partial<CalendarFilterState>) };
    } catch {
      /* storage unavailable */
    }
    if (saved) {
      filtersRef.current = saved;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client hydration of persisted filters
      setFilters(saved);
    }
    setMountedView(initialView ?? (window.innerWidth < 640 ? "listWeek" : "dayGridMonth"));
  }, [initialView]);

  const applyFilters = useCallback((next: CalendarFilterState) => {
    filtersRef.current = next;
    setFilters(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
    calRef.current?.getApi().refetchEvents();
  }, []);

  // Stable event source: reads the latest filters from a ref so changing filters just refetches.
  const fetchEvents = useCallback(async (info: { start: Date; end: Date }) => {
    const pad = 864e5; // pad a day each side so timezone edges never drop events
    const params = new URLSearchParams({
      start: new Date(info.start.getTime() - pad).toISOString(),
      end: new Date(info.end.getTime() + pad).toISOString(),
      ...filtersToParams(filtersRef.current),
    });
    const res = await fetch(`/api/calendar/events?${params}`, { credentials: "same-origin" });
    if (!res.ok) throw new Error(res.status === 401 ? "Your session expired — please sign in again." : "Could not load calendar events.");
    return (await res.json()) as never[];
  }, []);

  const refetch = useCallback(() => calRef.current?.getApi().refetchEvents(), []);

  const openQuickCreate = useCallback(
    (start?: string, end?: string) => {
      if (start && end) return setDraft({ start, end });
      const next = new Date(Math.ceil(Date.now() / 3600e3) * 3600e3);
      setDraft({ start: formatInTz(next, timezone, WALL), end: formatInTz(new Date(next.getTime() + 3600e3), timezone, WALL) });
    },
    [timezone],
  );

  const persistMove = useCallback(
    async (m: PendingMove) => {
      setMoving(true);
      const res = await moveEventAction({ eventId: m.eventId, startsAt: m.startsAt.toISOString(), endsAt: m.endsAt.toISOString() });
      setMoving(false);
      setPendingMove(null);
      if (!res.ok) {
        m.revert();
        toast.error(res.error);
        return;
      }
      toast.success(
        res.data && res.data.attendees > 0 ? "Rescheduled — reminders and follow-ups were re-planned." : "Event rescheduled",
      );
      refetch();
    },
    [refetch],
  );

  const handleMove = useCallback(
    (info: EventDropInfo | EventResizeDoneInfo) => {
      const p = info.event.extendedProps as CalendarEventProps;
      const start = info.event.start;
      if (info.event.allDay || !start) {
        info.revert();
        toast.error("Events need a start and end time — drop it on a time slot.");
        return;
      }
      const end = info.event.end ?? new Date(start.getTime() + (new Date(p.endsAt ?? p.startsAt).getTime() - new Date(p.startsAt).getTime()));
      const move: PendingMove = {
        eventId: p.entityId,
        title: p.title,
        attendees: p.counts ? p.counts.registered + p.counts.waitlisted : 0,
        startsAt: start,
        endsAt: end,
        revert: info.revert,
      };
      if (move.attendees > 0) setPendingMove(move);
      else void persistMove(move);
    },
    [persistMove],
  );

  const cancelMove = () => {
    pendingMove?.revert();
    setPendingMove(null);
  };

  const title = controller.view?.title ?? "";
  const view = controller.view?.type ?? mountedView ?? "dayGridMonth";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <CalendarToolbar
        title={title}
        view={view}
        loading={loading}
        filters={filters}
        campaigns={campaigns}
        onPrev={() => controller.prev()}
        onNext={() => controller.next()}
        onToday={() => controller.today()}
        onView={(v) => controller.changeView(v)}
        onFilters={applyFilters}
        onNew={() => openQuickCreate()}
      />

      <div className="relay-calendar h-[calc(100dvh-15.5rem)] min-h-[520px] overflow-hidden rounded-xl border bg-background">
        {mountedView ? (
          <FullCalendar
            ref={calRef}
            controller={controller}
            plugins={PLUGINS}
            initialView={mountedView}
            initialDate={initialDate}
            headerToolbar={false}
            height="100%"
            borderless
            timeZone={timezone}
            firstDay={weekStartsOn}
            nowIndicator
            navLinks
            selectable
            selectMirror
            editable
            dayMaxEvents
            scrollTime="08:00:00"
            eventTimeFormat={TIME_FORMAT}
            slotHeaderFormat={TIME_FORMAT}
            noEventsText="Nothing scheduled in this range"
            events={fetchEvents}
            eventContent={renderEventContent}
            loading={setLoading}
            eventSourceFailure={(err: unknown) => toast.error(err instanceof Error ? err.message : "Could not load calendar events.")}
            eventClick={(info) => {
              const props = info.event.extendedProps as CalendarEventProps;
              setSelected({ el: info.el, props, color: info.event.color || "var(--primary)" });
            }}
            select={(info) => {
              const startWall = info.startStr.slice(0, 16);
              if (info.allDay) {
                const first = info.startStr.slice(0, 10);
                // endStr is exclusive for all-day selections → last selected day
                const last = formatInTz(new Date(new Date(`${info.endStr.slice(0, 10)}T00:00:00Z`).getTime() - 864e5), "UTC", "yyyy-MM-dd");
                openQuickCreate(`${first}T09:00`, last > first ? `${last}T17:00` : `${first}T10:00`);
              } else {
                openQuickCreate(startWall, info.endStr.slice(0, 16));
              }
              calRef.current?.getApi().unselect();
            }}
            eventDrop={handleMove}
            eventResize={handleMove}
          />
        ) : (
          <Skeleton className="size-full rounded-none" />
        )}
      </div>

      <EventDetails selected={selected} timezone={timezone} onClose={() => setSelected(null)} />

      <QuickCreateDialog
        draft={draft}
        onClose={() => setDraft(null)}
        campaigns={campaigns}
        timezone={timezone}
        onCreated={refetch}
      />

      <AlertDialog open={!!pendingMove} onOpenChange={(o) => !o && !moving && cancelMove()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reschedule “{pendingMove?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingMove && (
                <>
                  {pendingMove.attendees} {pendingMove.attendees === 1 ? "person is" : "people are"} registered. The new time is{" "}
                  <strong>{formatInTz(pendingMove.startsAt, timezone, "EEE d MMM, HH:mm")}</strong> –{" "}
                  <strong>{formatInTz(pendingMove.endsAt, timezone, "HH:mm")}</strong>. Reminders and follow-up emails will be re-planned for the new time;
                  attendees are not emailed about the change, so let them know if needed.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={moving}>Keep original time</AlertDialogCancel>
            <AlertDialogAction
              disabled={moving}
              onClick={(e) => {
                e.preventDefault();
                if (pendingMove) void persistMove(pendingMove);
              }}
            >
              {moving && <Spinner />} Reschedule &amp; re-plan reminders
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
