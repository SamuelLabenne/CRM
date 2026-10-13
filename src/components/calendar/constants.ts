import type { CalendarKind } from "@/lib/analytics/calendar";

export const EVENT_TYPE_OPTIONS = [
  { value: "webinar", label: "Webinar" },
  { value: "workshop", label: "Workshop" },
  { value: "meetup", label: "Meetup" },
  { value: "conference", label: "Conference" },
  { value: "class", label: "Class" },
  { value: "meeting", label: "Meeting" },
  { value: "call", label: "Call" },
  { value: "other", label: "Other" },
] as const;

export const KIND_LABEL: Record<CalendarKind, string> = {
  event: "Event",
  meeting: "Meeting",
  campaign: "Campaign",
  broadcast: "Broadcast",
  task: "Task",
};

export type CalendarFilterState = {
  events: boolean;
  meetings: boolean;
  campaigns: boolean;
  broadcasts: boolean;
  tasks: boolean;
  cancelled: boolean;
  mine: boolean;
  campaignId: string;
  types: string[];
};

export const DEFAULT_FILTERS: CalendarFilterState = {
  events: true,
  meetings: true,
  campaigns: true,
  broadcasts: true,
  tasks: true,
  cancelled: false,
  mine: false,
  campaignId: "",
  types: [],
};

export function filtersToParams(f: CalendarFilterState): Record<string, string> {
  const p: Record<string, string> = {
    events: f.events ? "1" : "0",
    meetings: f.meetings ? "1" : "0",
    campaigns: f.campaigns ? "1" : "0",
    broadcasts: f.broadcasts ? "1" : "0",
    tasks: f.tasks ? "1" : "0",
    cancelled: f.cancelled ? "1" : "0",
    mine: f.mine ? "1" : "0",
  };
  if (f.campaignId) p.campaign = f.campaignId;
  if (f.types.length) p.types = f.types.join(",");
  return p;
}

/** Number of filters that differ from the defaults (for the badge on the Filters button). */
export function activeFilterCount(f: CalendarFilterState): number {
  let n = 0;
  for (const k of ["events", "meetings", "campaigns", "broadcasts", "tasks", "cancelled", "mine"] as const) {
    if (f[k] !== DEFAULT_FILTERS[k]) n++;
  }
  if (f.campaignId) n++;
  if (f.types.length) n++;
  return n;
}
