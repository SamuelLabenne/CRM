"use client";

import { ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CalendarFilters } from "./calendar-filters";
import type { CalendarFilterState } from "./constants";

export const VIEW_OPTIONS = [
  { value: "dayGridMonth", label: "Month" },
  { value: "timeGridWeek", label: "Week" },
  { value: "timeGridDay", label: "Day" },
  { value: "listWeek", label: "List" },
] as const;

export function CalendarToolbar({
  title,
  view,
  loading,
  filters,
  campaigns,
  onPrev,
  onNext,
  onToday,
  onView,
  onFilters,
  onNew,
}: {
  title: string;
  view: string;
  loading: boolean;
  filters: CalendarFilterState;
  campaigns: { id: string; name: string; color: string }[];
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onView: (view: string) => void;
  onFilters: (f: CalendarFilterState) => void;
  onNew: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="icon-sm" onClick={onPrev} aria-label="Previous">
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="sm" onClick={onToday}>
          Today
        </Button>
        <Button variant="outline" size="icon-sm" onClick={onNext} aria-label="Next">
          <ChevronRight />
        </Button>
      </div>
      <h2 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight sm:flex-none sm:text-lg">
        {title || " "}
        {loading && <Loader2 className="ml-2 inline size-3.5 animate-spin text-muted-foreground" aria-label="Loading" />}
      </h2>
      <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={view}
          onValueChange={(v) => v && onView(v)}
          aria-label="Calendar view"
        >
          {VIEW_OPTIONS.map((v) => (
            <ToggleGroupItem key={v.value} value={v.value} className="px-2.5">
              {v.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <CalendarFilters value={filters} onChange={onFilters} campaigns={campaigns} />
        <Button size="sm" onClick={onNew} className="ml-auto sm:ml-0">
          <Plus /> New event
        </Button>
      </div>
    </div>
  );
}
