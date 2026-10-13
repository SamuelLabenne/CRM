import { addDays, format } from "date-fns";
import type { DateOverride, WeeklyAvailability } from "@/lib/types";

// Pure helpers shared by the availability editor (client) and its server action.

export type DayKey = keyof WeeklyAvailability;
export type TimeRange = { start: string; end: string };

export const DAY_KEYS: DayKey[] = ["0", "1", "2", "3", "4", "5", "6"];
export const DAY_NAMES: Record<DayKey, string> = {
  "0": "Sunday",
  "1": "Monday",
  "2": "Tuesday",
  "3": "Wednesday",
  "4": "Thursday",
  "5": "Friday",
  "6": "Saturday",
};
export const WEEKDAYS: DayKey[] = ["1", "2", "3", "4", "5"];

export const DEFAULT_RANGE: TimeRange = { start: "09:00", end: "17:00" };

/** What booking pages use while a user has not saved any availability (null in the database). */
export function defaultAvailability(): WeeklyAvailability {
  return {
    "0": [],
    "1": [{ ...DEFAULT_RANGE }],
    "2": [{ ...DEFAULT_RANGE }],
    "3": [{ ...DEFAULT_RANGE }],
    "4": [{ ...DEFAULT_RANGE }],
    "5": [{ ...DEFAULT_RANGE }],
    "6": [],
  };
}

/** Day order for the editor: Monday-first or Sunday-first. */
export function orderedDays(weekStartsOn: 0 | 1): DayKey[] {
  return weekStartsOn === 1 ? ["1", "2", "3", "4", "5", "6", "0"] : DAY_KEYS;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export class AvailabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvailabilityError";
  }
}

/** Validate ranges: HH:mm, start before end, no overlaps (touching ranges are merged). Sorted by start. */
export function normalizeRanges(ranges: TimeRange[], label: string): TimeRange[] {
  const clean = ranges.map((r) => {
    if (!TIME_RE.test(r.start) || !TIME_RE.test(r.end)) throw new AvailabilityError(`${label}: use times like 09:00.`);
    if (toMinutes(r.start) >= toMinutes(r.end)) throw new AvailabilityError(`${label}: ${r.start} must be before ${r.end}.`);
    return { start: r.start, end: r.end };
  });
  clean.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  const out: TimeRange[] = [];
  for (const r of clean) {
    const prev = out[out.length - 1];
    if (prev && toMinutes(r.start) < toMinutes(prev.end)) {
      throw new AvailabilityError(`${label}: ${r.start}–${r.end} overlaps with ${prev.start}–${prev.end}.`);
    }
    if (prev && toMinutes(r.start) === toMinutes(prev.end)) prev.end = r.end;
    else out.push(r);
  }
  return out;
}

export function normalizeAvailability(input: Partial<Record<DayKey, TimeRange[]>>): WeeklyAvailability {
  const out = {} as WeeklyAvailability;
  for (const k of DAY_KEYS) out[k] = normalizeRanges(input[k] ?? [], DAY_NAMES[k]);
  return out;
}

/** Validate date overrides: unique valid dates, sorted; drops dates before `today` (yyyy-MM-dd). */
export function normalizeOverrides(list: DateOverride[], today = format(new Date(), "yyyy-MM-dd")): DateOverride[] {
  // Keep a day of slack so timezone differences never delete "today" for someone west of UTC.
  const cutoff = format(addDays(new Date(`${today}T12:00:00`), -1), "yyyy-MM-dd");
  const seen = new Set<string>();
  const out: DateOverride[] = [];
  for (const o of list) {
    if (!DATE_RE.test(o.date) || Number.isNaN(new Date(`${o.date}T12:00:00`).getTime())) {
      throw new AvailabilityError(`“${o.date}” is not a valid date.`);
    }
    if (seen.has(o.date)) throw new AvailabilityError(`${o.date} is listed twice.`);
    seen.add(o.date);
    if (o.date < cutoff) continue;
    out.push({ date: o.date, slots: normalizeRanges(o.slots, o.date) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function rangesEqual(a: TimeRange[], b: TimeRange[]) {
  return a.length === b.length && a.every((r, i) => r.start === b[i].start && r.end === b[i].end);
}
