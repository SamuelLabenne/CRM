"use client";

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { CalendarOff, Copy, Plus, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { SettingsCard } from "@/components/settings/settings-card";
import { useRunAction } from "@/components/settings/use-run-action";
import type { DateOverride, WeeklyAvailability } from "@/lib/types";
import {
  DAY_KEYS,
  DAY_NAMES,
  DEFAULT_RANGE,
  WEEKDAYS,
  defaultAvailability,
  orderedDays,
  type DayKey,
  type TimeRange,
} from "../_lib/availability";
import { saveAvailabilityAction } from "./actions";

function plusHour(t: string): string {
  const mins = Math.min(Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) + 60, 23 * 60 + 59);
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

function RangeList({ ranges, onChange, label }: { ranges: TimeRange[]; onChange: (next: TimeRange[]) => void; label: string }) {
  const update = (i: number, patch: Partial<TimeRange>) => onChange(ranges.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <div className="grid gap-2">
      {ranges.map((r, i) => {
        const invalid = !!r.start && !!r.end && r.start >= r.end;
        return (
          <div key={i} className="flex items-center gap-2">
            <Input
              type="time"
              step={300}
              aria-label={`${label} start ${i + 1}`}
              value={r.start}
              onChange={(e) => update(i, { start: e.target.value })}
              aria-invalid={invalid}
              className="w-[7.5rem]"
            />
            <span className="text-muted-foreground">–</span>
            <Input
              type="time"
              step={300}
              aria-label={`${label} end ${i + 1}`}
              value={r.end}
              onChange={(e) => update(i, { end: e.target.value })}
              aria-invalid={invalid}
              className="w-[7.5rem]"
            />
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove time range ${i + 1} for ${label}`} onClick={() => onChange(ranges.filter((_, idx) => idx !== i))}>
              <Trash2 />
            </Button>
            {i === ranges.length - 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Add another time range for ${label}`}
                onClick={() => {
                  const last = ranges[ranges.length - 1];
                  const start = last?.end && last.end < "22:59" ? last.end : DEFAULT_RANGE.start;
                  onChange([...ranges, { start, end: plusHour(start) }]);
                }}
              >
                <Plus />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function AvailabilityEditor({
  initialAvailability,
  initialOverrides,
  weekStartsOn,
  timezone,
}: {
  initialAvailability: WeeklyAvailability | null;
  initialOverrides: DateOverride[];
  weekStartsOn: 0 | 1;
  timezone: string;
}) {
  const [week, setWeek] = useState<WeeklyAvailability>(initialAvailability ?? defaultAvailability());
  const [usingDefault, setUsingDefault] = useState(initialAvailability === null);
  const [overrides, setOverrides] = useState<DateOverride[]>(initialOverrides);
  const [newDate, setNewDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useRunAction();
  const days = useMemo(() => orderedDays(weekStartsOn), [weekStartsOn]);

  function editWeek(next: WeeklyAvailability) {
    setWeek(next);
    setUsingDefault(false);
  }
  const setDay = (k: DayKey, ranges: TimeRange[]) => editWeek({ ...week, [k]: ranges });
  const copyFrom = (from: DayKey, to: DayKey[]) => {
    const next = { ...week };
    for (const k of to) if (k !== from) next[k] = week[from].map((r) => ({ ...r }));
    editWeek(next);
  };

  function addOverride() {
    if (!newDate) return;
    if (overrides.some((o) => o.date === newDate)) {
      setError(`${newDate} already has an override.`);
      return;
    }
    setError(null);
    setOverrides([...overrides, { date: newDate, slots: [] }].sort((a, b) => a.date.localeCompare(b.date)));
    setNewDate("");
  }
  const setOverride = (date: string, slots: TimeRange[]) => setOverrides(overrides.map((o) => (o.date === date ? { ...o, slots } : o)));

  function save() {
    setError(null);
    run(() => saveAvailabilityAction({ availability: usingDefault ? null : week, dateOverrides: overrides }), {
      onSuccess: (data) => data && setOverrides(data.dateOverrides),
      onError: setError,
    });
  }

  const todayStr = format(new Date(), "yyyy-MM-dd");

  return (
    <SettingsCard
      title="Weekly availability"
      description={
        <>
          When people can book you on booking pages. Times are in <span className="font-medium text-foreground">{timezone.replace(/_/g, " ")}</span>.
        </>
      }
      action={
        !usingDefault && (
          <Button type="button" variant="ghost" size="sm" onClick={() => (setWeek(defaultAvailability()), setUsingDefault(true))}>
            <RotateCcw /> Reset to default
          </Button>
        )
      }
      footer={
        <Button type="button" onClick={save} disabled={pending}>
          {pending && <Spinner />} Save availability
        </Button>
      }
      contentClassName="gap-6"
    >
      {usingDefault && (
        <Alert>
          <AlertDescription>You haven&apos;t set your hours yet, so the default (Monday–Friday, 09:00–17:00) applies. Edit anything below and save to customise it.</AlertDescription>
        </Alert>
      )}
      <div className="divide-y rounded-lg border">
        {days.map((k) => {
          const ranges = week[k];
          const on = ranges.length > 0;
          return (
            <div key={k} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:gap-4">
              <label className="flex w-36 shrink-0 items-center gap-3 sm:pt-1.5">
                <Switch
                  checked={on}
                  onCheckedChange={(v) => setDay(k, v ? [{ ...DEFAULT_RANGE }] : [])}
                  aria-label={`Available on ${DAY_NAMES[k]}`}
                />
                <span className="text-sm font-medium">{DAY_NAMES[k]}</span>
              </label>
              <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
                {on ? <RangeList ranges={ranges} onChange={(r) => setDay(k, r)} label={DAY_NAMES[k]} /> : <span className="pt-1.5 text-sm text-muted-foreground">Unavailable</span>}
                {on && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Copy ${DAY_NAMES[k]} hours to other days`}>
                        <Copy />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => copyFrom(k, WEEKDAYS)}>Copy to all weekdays (Mon–Fri)</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => copyFrom(k, DAY_KEYS)}>Copy to every day</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-3">
        <div>
          <h3 className="text-sm font-medium">Date overrides</h3>
          <p className="text-sm text-muted-foreground">Block out a holiday or set special hours for a single day. Past dates are removed when you save.</p>
        </div>
        {overrides.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No date overrides.</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {overrides.map((o) => {
              const unavailable = o.slots.length === 0;
              return (
                <div key={o.date} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:gap-4">
                  <div className="flex w-44 shrink-0 items-center gap-2 text-sm font-medium sm:pt-1.5">
                    {unavailable && <CalendarOff className="size-4 text-muted-foreground" aria-hidden />}
                    {format(parseISO(o.date), "EEE d MMM yyyy")}
                    {o.date < todayStr && <span className="text-xs font-normal text-muted-foreground">(past)</span>}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-2">
                    <div className="grid gap-2">
                      <label className="flex items-center gap-2 text-sm sm:pt-1.5">
                        <Switch checked={unavailable} onCheckedChange={(v) => setOverride(o.date, v ? [] : [{ ...DEFAULT_RANGE }])} aria-label={`Unavailable all day on ${o.date}`} />
                        Unavailable all day
                      </label>
                      {!unavailable && <RangeList ranges={o.slots} onChange={(r) => setOverride(o.date, r)} label={o.date} />}
                    </div>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove override for ${o.date}`} onClick={() => setOverrides(overrides.filter((x) => x.date !== o.date))}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="override-date" className="text-xs text-muted-foreground">
              Add a date
            </Label>
            <Input id="override-date" type="date" min={todayStr} value={newDate} onChange={(e) => setNewDate(e.target.value)} className="w-44" suppressHydrationWarning />
          </div>
          <Button type="button" variant="outline" onClick={addOverride} disabled={!newDate}>
            <Plus /> Add override
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </SettingsCard>
  );
}

