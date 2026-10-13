"use client";

import { ListFilter, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { activeFilterCount, DEFAULT_FILTERS, EVENT_TYPE_OPTIONS, type CalendarFilterState } from "./constants";

type Campaign = { id: string; name: string; color: string };

const SHOW: { key: "events" | "meetings" | "campaigns" | "broadcasts" | "tasks"; label: string; dot: string }[] = [
  { key: "events", label: "Events", dot: "bg-primary" },
  { key: "meetings", label: "Meetings", dot: "bg-sky-600" },
  { key: "campaigns", label: "Campaigns", dot: "bg-emerald-500/60" },
  { key: "broadcasts", label: "Scheduled broadcasts", dot: "bg-violet-600" },
  { key: "tasks", label: "Tasks with due dates", dot: "bg-amber-600" },
];

export function CalendarFilters({
  value,
  onChange,
  campaigns,
}: {
  value: CalendarFilterState;
  onChange: (next: CalendarFilterState) => void;
  campaigns: Campaign[];
}) {
  const count = activeFilterCount(value);
  const set = (patch: Partial<CalendarFilterState>) => onChange({ ...value, ...patch });
  const toggleType = (t: string, on: boolean) =>
    set({ types: on ? [...value.types, t] : value.types.filter((x) => x !== t) });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <ListFilter /> Filters
          {count > 0 && (
            <Badge className="ml-0.5 h-4 min-w-4 rounded-full px-1 text-[10px]" variant="default">
              {count}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3 p-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Calendar filters</div>
          <Button variant="ghost" size="xs" disabled={count === 0} onClick={() => onChange(DEFAULT_FILTERS)}>
            <RotateCcw /> Reset
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-2.5 py-2">
          <Label htmlFor="cal-mine" className="flex flex-col items-start gap-0.5">
            <span>Only mine</span>
            <span className="text-xs font-normal text-muted-foreground">Hosted by, owned by or assigned to you</span>
          </Label>
          <Switch id="cal-mine" checked={value.mine} onCheckedChange={(v) => set({ mine: v })} />
        </div>

        <div className="space-y-1.5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Show</div>
          {SHOW.map((s) => (
            <label key={s.key} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
              <Checkbox checked={value[s.key]} onCheckedChange={(v) => set({ [s.key]: v === true })} />
              <span className={`size-2 rounded-full ${s.dot}`} />
              {s.label}
            </label>
          ))}
          <label className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
            <Checkbox checked={value.cancelled} onCheckedChange={(v) => set({ cancelled: v === true })} />
            <span className="size-2 rounded-full bg-muted-foreground/50" />
            Cancelled events
          </label>
        </div>

        <Separator />

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Event types</div>
            {value.types.length > 0 && (
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => set({ types: [] })}>
                All types
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {EVENT_TYPE_OPTIONS.map((t) => (
              <label key={t.value} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
                <Checkbox checked={value.types.includes(t.value)} onCheckedChange={(v) => toggleType(t.value, v === true)} />
                {t.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{value.types.length ? "Only the selected types are shown." : "No selection shows every type."}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cal-campaign" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Campaign
          </Label>
          <NativeSelect id="cal-campaign" className="w-full" value={value.campaignId} onChange={(e) => set({ campaignId: e.target.value })}>
            <NativeSelectOption value="">All campaigns</NativeSelectOption>
            {campaigns.map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </PopoverContent>
    </Popover>
  );
}
