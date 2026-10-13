"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight, Globe, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  addMonthsToKey,
  formatSlotTime,
  groupSlotsByDate,
  localDateKey,
  monthRange,
  weekdayOfKey,
} from "@/lib/scheduling/slots-core";

const DAY_MS = 86_400_000;
const noopSubscribe = () => () => {};

/** Browser timezone, hydration-safe (falls back to `fallback` on the server). */
export function useBrowserTimezone(fallback: string): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || fallback,
    () => fallback,
  );
}

function useIsClient() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

function useBrowserHour12() {
  return useSyncExternalStore(
    noopSubscribe,
    () => new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12 ?? false,
    () => false,
  );
}

function timezoneOptions(current: string, host: string): string[] {
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    all = [];
  }
  return [...new Set(["UTC", ...all, host, current])].sort();
}

const keyToDate = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

type FetchResult = { ok: true; slots: string[] } | { ok: false; error: string };
type MonthState = { status: "ready"; slots: string[] } | { status: "error"; error: string };

export type ConfirmResult = { error: string; refresh?: boolean } | null;

/**
 * Calendly-style date + time picker used by the public booking flow and the reschedule page.
 * Slots are fetched per visible month (in the visitor's timezone) from the server.
 */
export function SlotPicker({
  fetchSlots,
  onConfirm,
  hostTimezone,
  initialNowMs,
  maxDaysAhead,
  weekStartsOn,
  confirmLabel = "Confirm",
}: {
  fetchSlots: (fromIso: string, toIso: string) => Promise<FetchResult>;
  /** Return an error (and optionally `refresh: true` to reload the slots) or null on success. */
  onConfirm: (startIso: string, timezone: string) => Promise<ConfirmResult>;
  hostTimezone: string;
  initialNowMs: number;
  maxDaysAhead: number;
  weekStartsOn: 0 | 1;
  confirmLabel?: string;
}) {
  const isClient = useIsClient();
  const detected = useBrowserTimezone(hostTimezone);
  const [tzOverride, setTzOverride] = useState<string | null>(null);
  const tz = tzOverride ?? detected;
  const detectedHour12 = useBrowserHour12();
  const [hour12Override, setHour12Override] = useState<boolean | null>(null);
  const hour12 = hour12Override ?? detectedHour12;

  const currentMonth = localDateKey(initialNowMs, tz).slice(0, 7);
  const [monthOverride, setMonthOverride] = useState<string | null>(null);
  const monthKey = monthOverride ?? currentMonth;

  const [cache, setCache] = useState<Record<string, MonthState>>({});
  const requested = useRef(new Set<string>());
  const cacheKey = `${tz}|${monthKey}`;
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    const inFlight = requested.current;
    const key = `${cacheKey}|${reloadTick}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    const { from, to } = monthRange(monthKey, tz);
    let cancelled = false;
    fetchSlots(from.toISOString(), to.toISOString())
      .then((res) => {
        if (cancelled) return;
        setCache((c) => ({ ...c, [cacheKey]: res.ok ? { status: "ready", slots: res.slots } : { status: "error", error: res.error } }));
      })
      .catch(() => {
        if (!cancelled) setCache((c) => ({ ...c, [cacheKey]: { status: "error", error: "Could not load times. Please try again." } }));
      });
    return () => {
      cancelled = true;
      inFlight.delete(key);
    };
  }, [cacheKey, reloadTick, monthKey, tz, fetchSlots]);

  const state = cache[cacheKey];
  const byDate = useMemo(() => (state?.status === "ready" ? groupSlotsByDate(state.slots, tz) : {}), [state, tz]);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const todayKey = localDateKey(initialNowMs, tz);
  const firstWeekday = weekdayOfKey(`${monthKey}-01`);
  const lead = (firstWeekday - weekStartsOn + 7) % 7;
  const [y, m] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const weekdays = Array.from({ length: 7 }, (_, i) => format(new Date(2024, 0, 7 + ((weekStartsOn + i) % 7)), "EEE"));
  const canGoPrev = monthKey > currentMonth;
  const nextMonth = addMonthsToKey(monthKey, 1);
  const canGoNext = monthRange(nextMonth, tz).from.getTime() <= initialNowMs + (maxDaysAhead + 1) * DAY_MS;
  const times = selectedDate ? (byDate[selectedDate] ?? []) : [];
  const hasAny = Object.keys(byDate).length > 0;
  const tzList = useMemo(() => (isClient ? timezoneOptions(tz, hostTimezone) : [tz]), [isClient, tz, hostTimezone]);

  const goMonth = (key: string) => {
    setMonthOverride(key);
    setSelectedDate(null);
    setSelectedTime(null);
    setError(null);
  };

  const confirm = async () => {
    if (!selectedTime || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await onConfirm(selectedTime, tz);
      if (res) {
        setError(res.error);
        if (res.refresh) {
          setSelectedTime(null);
          setCache((c) => {
            const next = { ...c };
            delete next[cacheKey];
            return next;
          });
          setReloadTick((t) => t + 1);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className={cn("grid gap-6", selectedDate && "md:grid-cols-[minmax(0,1fr)_13rem]")}>
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">{format(keyToDate(`${monthKey}-01`), "MMMM yyyy")}</h3>
            <div className="flex gap-1">
              <button
                type="button"
                aria-label="Previous month"
                disabled={!canGoPrev}
                onClick={() => goMonth(addMonthsToKey(monthKey, -1))}
                className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Next month"
                disabled={!canGoNext}
                onClick={() => goMonth(nextMonth)}
                className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {weekdays.map((w) => (
              <div key={w} className="py-1">
                {w}
              </div>
            ))}
          </div>
          <div className="relative mt-1 grid grid-cols-7 gap-1">
            {Array.from({ length: lead }, (_, i) => (
              <div key={`b${i}`} />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const key = `${monthKey}-${String(day).padStart(2, "0")}`;
              const available = !!byDate[key]?.length;
              const selected = selectedDate === key;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!available}
                  aria-pressed={selected}
                  aria-label={available ? `${format(keyToDate(key), "EEEE d MMMM")}, times available` : format(keyToDate(key), "EEEE d MMMM")}
                  onClick={() => {
                    setSelectedDate(key);
                    setSelectedTime(null);
                    setError(null);
                  }}
                  className={cn(
                    "relative grid aspect-square place-items-center rounded-full text-sm transition-colors",
                    available
                      ? "bg-[color-mix(in_oklab,var(--brand)_12%,transparent)] font-semibold text-[var(--brand)] hover:bg-[color-mix(in_oklab,var(--brand)_24%,transparent)]"
                      : "cursor-default text-muted-foreground/50",
                    selected && "bg-[var(--brand)] text-white hover:bg-[var(--brand)]",
                  )}
                >
                  {day}
                  {key === todayKey && <span className={cn("absolute bottom-1 size-1 rounded-full", selected ? "bg-white" : "bg-[var(--brand)]")} />}
                </button>
              );
            })}
            {!state && (
              <div className="absolute inset-0 grid place-items-center rounded-lg bg-card/70">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
          {state?.status === "error" && (
            <p className="mt-3 text-sm text-destructive">
              {state.error}{" "}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setCache((c) => {
                    const next = { ...c };
                    delete next[cacheKey];
                    return next;
                  });
                  setReloadTick((t) => t + 1);
                }}
              >
                Retry
              </button>
            </p>
          )}
          {state?.status === "ready" && !hasAny && (
            <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              No times available in {format(keyToDate(`${monthKey}-01`), "MMMM")}.{" "}
              {canGoNext ? (
                <button type="button" className="font-medium text-foreground underline" onClick={() => goMonth(nextMonth)}>
                  Check next month
                </button>
              ) : (
                "Please check back later."
              )}
            </p>
          )}
        </div>

        {selectedDate && (
          <div className="flex min-h-0 flex-col">
            <h3 className="mb-3 text-sm font-semibold">{format(keyToDate(selectedDate), "EEEE d MMMM")}</h3>
            <div className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1" role="list">
              {times.map((iso) =>
                selectedTime === iso ? (
                  <div key={iso} className="flex gap-2" role="listitem">
                    <div className="flex h-11 flex-1 items-center justify-center rounded-lg bg-foreground/85 text-sm font-semibold text-background">
                      {formatSlotTime(iso, tz, hour12)}
                    </div>
                    <button
                      type="button"
                      onClick={confirm}
                      disabled={busy}
                      className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--brand)] text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-70"
                    >
                      {busy && <Loader2 className="size-4 animate-spin" />}
                      {confirmLabel}
                    </button>
                  </div>
                ) : (
                  <button
                    key={iso}
                    type="button"
                    role="listitem"
                    onClick={() => {
                      setSelectedTime(iso);
                      setError(null);
                    }}
                    className="h-11 rounded-lg border border-[color-mix(in_oklab,var(--brand)_45%,transparent)] text-sm font-semibold text-[var(--brand)] transition-colors hover:border-[var(--brand)] hover:bg-[color-mix(in_oklab,var(--brand)_10%,transparent)]"
                  >
                    {formatSlotTime(iso, tz, hour12)}
                  </button>
                ),
              )}
            </div>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          </div>
        )}
      </div>

      {!selectedDate && error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
        <label className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <Globe className="size-4 shrink-0" />
          <span className="sr-only">Timezone</span>
          <select
            value={tz}
            onChange={(e) => {
              setTzOverride(e.target.value);
              setMonthOverride(null);
              setSelectedDate(null);
              setSelectedTime(null);
            }}
            className="max-w-56 truncate rounded-md border border-transparent bg-transparent py-1 pr-1 text-sm text-foreground outline-none hover:bg-muted focus-visible:border-ring"
          >
            {tzList.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <div className="inline-flex rounded-md border p-0.5 text-xs" role="group" aria-label="Time format">
          {([false, true] as const).map((h) => (
            <button
              key={String(h)}
              type="button"
              onClick={() => setHour12Override(h)}
              className={cn("rounded px-2 py-1 font-medium", hour12 === h ? "bg-muted text-foreground" : "text-muted-foreground")}
              aria-pressed={hour12 === h}
            >
              {h ? "12h" : "24h"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
