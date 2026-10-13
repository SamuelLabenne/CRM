"use client";

import { useSyncExternalStore } from "react";
import { dateBlockParts, formatEventRange } from "@/lib/events/utils";

const subscribe = () => () => {};

/**
 * Event time in the visitor's own timezone. The server renders the event's timezone (so there is no
 * layout shift and crawlers see a sensible value); the browser swaps in local time after hydration.
 */
export function LocalTime({ startIso, endIso, eventTz, className }: { startIso: string; endIso: string; eventTz: string; className?: string }) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const serverText = formatEventRange(start, end, eventTz, "en-AU");
  const text = useSyncExternalStore(subscribe, () => formatEventRange(start, end), () => serverText);
  const note = useSyncExternalStore(
    subscribe,
    () => {
      const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return browserTz && browserTz !== eventTz ? `Your local time · event is in ${eventTz.replace(/_/g, " ")}` : "";
    },
    () => "",
  );
  return (
    <span className={className}>
      <span className="block">{text}</span>
      {note && <span className="block text-xs font-normal text-muted-foreground">{note}</span>}
    </span>
  );
}

/** Calendar-style date block (month + day) in the visitor's timezone. */
export function LocalDateBlock({ startIso, eventTz, className }: { startIso: string; eventTz: string; className?: string }) {
  const start = new Date(startIso);
  const serverKey = (() => {
    const p = dateBlockParts(start, eventTz, "en-AU");
    return `${p.month}|${p.day}`;
  })();
  const key = useSyncExternalStore(
    subscribe,
    () => {
      const p = dateBlockParts(start);
      return `${p.month}|${p.day}`;
    },
    () => serverKey,
  );
  const [month, day] = key.split("|");
  return (
    <div className={className ?? "flex size-14 shrink-0 flex-col items-center justify-center rounded-xl border bg-card text-center shadow-xs"}>
      <span className="text-[10px] font-semibold tracking-wider text-[var(--brand)]">{month}</span>
      <span className="text-xl leading-none font-bold tabular-nums">{day}</span>
    </div>
  );
}
