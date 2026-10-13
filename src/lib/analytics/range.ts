import { TZDate } from "@date-fns/tz";
import { addDays, format, startOfDay, subDays } from "date-fns";

// Date-range helpers shared by the dashboard and the reports.
// Everything is computed in the workspace timezone so "last 7 days" means calendar days there.

export const DASHBOARD_RANGES = ["7", "30", "90"] as const;
export const REPORT_RANGES = ["7", "30", "90", "365", "all"] as const;
export type RangeKey = (typeof REPORT_RANGES)[number];

export type DateRange = {
  key: RangeKey;
  /** Number of days covered (null for "all"). */
  days: number | null;
  /** Inclusive start of the first day. */
  from: Date;
  /** Exclusive end (start of tomorrow in the workspace timezone; far future for "all"). */
  to: Date;
  /** Previous period of the same length (null for "all"). */
  prevFrom: Date | null;
  prevTo: Date | null;
  timezone: string;
};

/** Returns `tz` when it is a valid IANA timezone, otherwise "UTC" (guards SQL `AT TIME ZONE`). */
export function safeTimezone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

export function parseRangeKey(value: string | string[] | null | undefined, allowed: readonly RangeKey[], fallback: RangeKey): RangeKey {
  const v = Array.isArray(value) ? value[0] : value;
  return allowed.includes(v as RangeKey) ? (v as RangeKey) : fallback;
}

export function resolveRange(key: RangeKey, timezone: string, now: Date = new Date()): DateRange {
  const tz = safeTimezone(timezone);
  const todayStart = startOfDay(new TZDate(now, tz));
  const to = new Date(addDays(todayStart, 1).getTime());
  if (key === "all") {
    // "All time" also includes future events (reports list upcoming events too).
    return { key, days: null, from: new Date(0), to: new Date("2100-01-01T00:00:00Z"), prevFrom: null, prevTo: null, timezone: tz };
  }
  const days = Number(key);
  const from = new Date(subDays(todayStart, days - 1).getTime());
  return {
    key,
    days,
    from,
    to,
    prevFrom: new Date(subDays(todayStart, days * 2 - 1).getTime()),
    prevTo: from,
    timezone: tz,
  };
}

/** "YYYY-MM-DD" keys for every day of the range in the workspace timezone (max `limit` most recent days). */
export function dayKeys(range: DateRange, limit = 400): string[] {
  const keys: string[] = [];
  let cursor = startOfDay(new TZDate(range.from, range.timezone));
  const end = new TZDate(range.to, range.timezone);
  while (cursor < end && keys.length < limit) {
    keys.push(format(cursor, "yyyy-MM-dd"));
    cursor = addDays(cursor, 1);
  }
  return keys;
}

export function rangeLabel(key: RangeKey): string {
  switch (key) {
    case "7":
      return "Last 7 days";
    case "30":
      return "Last 30 days";
    case "90":
      return "Last 90 days";
    case "365":
      return "Last 12 months";
    case "all":
      return "All time";
  }
}
