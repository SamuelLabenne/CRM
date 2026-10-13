// Pure, dependency-free helpers for the events module (safe to import from client components).
import type { AttendeeStatus, EventStatus, EventType, LocationType } from "@/lib/types";

export const EVENT_TYPES: { value: EventType; label: string }[] = [
  { value: "webinar", label: "Webinar" },
  { value: "workshop", label: "Workshop" },
  { value: "meetup", label: "Meetup" },
  { value: "conference", label: "Conference" },
  { value: "class", label: "Class" },
  { value: "call", label: "Call" },
  { value: "other", label: "Other" },
];

export const EVENT_TYPE_LABEL: Record<string, string> = {
  ...Object.fromEntries(EVENT_TYPES.map((t) => [t.value, t.label])),
  meeting: "Meeting",
};

export const LOCATION_TYPES: { value: LocationType; label: string }[] = [
  { value: "online", label: "Online" },
  { value: "in_person", label: "In person" },
  { value: "phone", label: "Phone" },
];

/** Brand-neutral palette offered for event & campaign colors. */
export const COLOR_SWATCHES = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#64748b",
];

/** Statuses that occupy a seat (same definition as `seatsTaken` in registration.ts). */
export const SEAT_STATUSES: AttendeeStatus[] = ["registered", "confirmed", "attended", "no_show"];

export type StatusCounts = Partial<Record<AttendeeStatus, number>>;

export type EventStats = {
  registered: number;
  confirmed: number;
  waitlisted: number;
  attended: number;
  noShow: number;
  cancelled: number;
  /** Seats occupied (registered + confirmed + attended + no-show). */
  seatsTaken: number;
  /** Everyone who is not cancelled (incl. waitlisted) – the denominator of the attendance rate. */
  nonCancelled: number;
  /** attended / non-cancelled registrations (null when nobody is registered). */
  attendanceRate: number | null;
  /** attended / (attended + no_show) (null until attendance has been recorded). */
  showUpRate: number | null;
};

export const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

/** Collapse per-status counts into the KPI numbers used on every events screen. */
export function summarizeStatuses(c: StatusCounts): EventStats {
  const registered = c.registered ?? 0;
  const confirmed = c.confirmed ?? 0;
  const waitlisted = c.waitlisted ?? 0;
  const attended = c.attended ?? 0;
  const noShow = c.no_show ?? 0;
  const cancelled = c.cancelled ?? 0;
  const nonCancelled = registered + confirmed + waitlisted + attended + noShow;
  return {
    registered,
    confirmed,
    waitlisted,
    attended,
    noShow,
    cancelled,
    seatsTaken: registered + confirmed + attended + noShow,
    nonCancelled,
    attendanceRate: ratio(attended, nonCancelled),
    showUpRate: ratio(attended, attended + noShow),
  };
}

export type PublicEventState = "open" | "waitlist" | "full" | "closed" | "past" | "cancelled";

/** What a visitor of the public registration page can do right now. */
export function registrationState(
  event: { status: EventStatus; endsAt: Date; registrationOpen: boolean; capacity: number | null; waitlistEnabled: boolean },
  seatsTaken: number,
  now: Date = new Date(),
): PublicEventState {
  if (event.status === "cancelled") return "cancelled";
  if (event.status === "completed" || event.endsAt.getTime() <= now.getTime()) return "past";
  if (!event.registrationOpen) return "closed";
  if (event.capacity != null && seatsTaken >= event.capacity) return event.waitlistEnabled ? "waitlist" : "full";
  return "open";
}

/** 90 → "1 hour 30 minutes", 1440 → "1 day". */
export function formatOffset(minutes: number): string {
  if (minutes <= 0) return "at the start";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
  if (hours) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (mins) parts.push(`${mins} ${mins === 1 ? "minute" : "minutes"}`);
  return parts.slice(0, 2).join(" ");
}

export type DurationUnit = "minutes" | "hours" | "days";
export const UNIT_MINUTES: Record<DurationUnit, number> = { minutes: 1, hours: 60, days: 1440 };

/** Pick the largest unit that divides `minutes` evenly: 120 → { amount: 2, unit: "hours" }. */
export function splitDuration(minutes: number): { amount: number; unit: DurationUnit } {
  if (minutes > 0 && minutes % 1440 === 0) return { amount: minutes / 1440, unit: "days" };
  if (minutes > 0 && minutes % 60 === 0) return { amount: minutes / 60, unit: "hours" };
  return { amount: minutes, unit: "minutes" };
}

/** Roughly how a seat bar should look: share of capacity used (0–1, capped) and whether it is over-booked. */
export function capacityUsage(taken: number, capacity: number | null) {
  if (capacity == null || capacity <= 0) return null;
  return { ratio: Math.min(1, taken / capacity), over: taken > capacity, full: taken >= capacity, left: Math.max(0, capacity - taken) };
}

/** Count items per day (yyyy-MM-dd in `fmt`) between two dates, filling gaps with zeros. */
export function bucketByDay(
  dates: Date[],
  fmt: (d: Date) => string,
  from: Date,
  to: Date,
): { date: string; count: number; total: number }[] {
  const counts = new Map<string, number>();
  for (const d of dates) counts.set(fmt(d), (counts.get(fmt(d)) ?? 0) + 1);
  const out: { date: string; count: number; total: number }[] = [];
  let total = 0;
  const cursor = new Date(from.getTime());
  const last = fmt(to);
  for (let i = 0; i < 400; i++) {
    const key = fmt(cursor);
    const count = counts.get(key) ?? 0;
    total += count;
    out.push({ date: key, count, total });
    if (key >= last) break;
    cursor.setTime(cursor.getTime() + 24 * 3600 * 1000);
  }
  return out;
}

/**
 * "Tue, 21 Oct 2025, 6:00 – 7:00 pm GMT+8". Pass `tz` to format in a fixed zone (server render);
 * omit it to use the browser's zone (client enhancement).
 */
export function formatEventRange(start: Date, end: Date, tz?: string, locale?: string): string {
  const fmt = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...(tz ? { timeZone: tz } : {}),
  });
  try {
    return fmt.formatRange(start, end);
  } catch {
    return fmt.format(start);
  }
}

/** Short month + day number of an instant, e.g. { month: "OCT", day: "21" }. */
export function dateBlockParts(date: Date, tz?: string, locale?: string): { month: string; day: string; weekday: string } {
  const opt = tz ? { timeZone: tz } : {};
  return {
    month: new Intl.DateTimeFormat(locale, { month: "short", ...opt }).format(date).toUpperCase(),
    day: new Intl.DateTimeFormat(locale, { day: "numeric", ...opt }).format(date),
    weekday: new Intl.DateTimeFormat(locale, { weekday: "short", ...opt }).format(date),
  };
}

/** Current time in ms (a function so server components can read the clock without tripping the render-purity lint). */
export const currentTimeMs = () => Date.now();
