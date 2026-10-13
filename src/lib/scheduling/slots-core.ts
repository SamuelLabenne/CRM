// Pure slot-engine functions (no database, no server-only imports) so they can be
// unit-tested and also used from client components. The DB loader lives in ./slots.ts.
import { TZDate } from "@date-fns/tz";
import type { DateOverride, WeeklyAvailability } from "@/lib/types";

const MIN = 60_000;

/** Mon–Fri 09:00–17:00 (used when a host has not configured weekly hours). */
export const DEFAULT_WEEKLY_AVAILABILITY: WeeklyAvailability = {
  "0": [],
  "1": [{ start: "09:00", end: "17:00" }],
  "2": [{ start: "09:00", end: "17:00" }],
  "3": [{ start: "09:00", end: "17:00" }],
  "4": [{ start: "09:00", end: "17:00" }],
  "5": [{ start: "09:00", end: "17:00" }],
  "6": [],
};

/** The booking-page settings that influence which slots exist. */
export type SlotConfig = {
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  maxDaysAhead: number;
  slotIncrementMinutes: number;
  /** Max meetings per host per (host-local) day; null = unlimited. */
  dailyLimit: number | null;
};

export type SlotHost = {
  id: string;
  /** IANA timezone the weekly hours / overrides are expressed in. */
  timezone: string;
  /** null → default Mon–Fri 09:00–17:00. */
  availability: WeeklyAvailability | null;
  dateOverrides: DateOverride[];
};

/** Something that occupies a host's calendar (non-cancelled events & meetings). */
export type BusyInterval = {
  hostId: string;
  start: Date;
  end: Date;
  /** Counts toward the host's daily meeting limit (events.kind = "meeting"). */
  isMeeting?: boolean;
};

export type Slot = {
  /** UTC ISO string of the start. */
  start: string;
  end: string;
  /** Hosts that are free for this slot (more than one for multi-host pages). */
  hostIds: string[];
};

export type HostLoad = { lastAssignedAt: Date | null; upcoming: number };

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");

export function isValidTimezone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** First valid IANA timezone in the list, else "UTC". */
export function resolveTimezone(...candidates: (string | null | undefined)[]): string {
  return candidates.find((c) => isValidTimezone(c)) ?? "UTC";
}

/** Local calendar date ("yyyy-MM-dd") of an instant in a timezone. */
export function localDateKey(instant: Date | number, tz: string): string {
  const d = new TZDate(typeof instant === "number" ? instant : instant.getTime(), tz);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Calendar arithmetic on "yyyy-MM-dd" keys (timezone independent). */
export function addDaysToKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday for a "yyyy-MM-dd" key. */
export function weekdayOfKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "09:30" → 570. Accepts "24:00" (end of day). Returns null when invalid. */
export function parseHm(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

/** The instant (ms) at which wall-clock `minutesOfDay` happens on a local date in `tz` (DST-aware). */
export function zonedInstant(key: string, minutesOfDay: number, tz: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new TZDate(y, m - 1, d, Math.floor(minutesOfDay / 60), minutesOfDay % 60, 0, 0, tz).getTime();
}

/** Start of a local day (ms). */
export function startOfZonedDay(key: string, tz: string): number {
  return zonedInstant(key, 0, tz);
}

// ---------------------------------------------------------------------------
// Availability windows
// ---------------------------------------------------------------------------

/** Working windows of a host on a local date as minute ranges (override wins over weekly hours). */
export function windowsForDate(host: Pick<SlotHost, "availability" | "dateOverrides">, key: string): [number, number][] {
  const override = host.dateOverrides.find((o) => o.date === key);
  const weekly = host.availability ?? DEFAULT_WEEKLY_AVAILABILITY;
  const raw = override ? override.slots : (weekly[String(weekdayOfKey(key)) as keyof WeeklyAvailability] ?? []);
  const out: [number, number][] = [];
  for (const w of raw) {
    const s = parseHm(w.start);
    const e = parseHm(w.end);
    if (s == null || e == null || e <= s) continue;
    out.push([s, e]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

export type SlotRange = { from?: Date; to?: Date };

/**
 * All bookable start times (ms) for ONE host.
 *
 *  - window = date override for that day, else weekly hours (host tz, DST-aware)
 *  - slots start at each window start and step by `slotIncrementMinutes`; the whole meeting must fit in the window
 *  - start >= now + minNotice, and the local date <= today + maxDaysAhead (host tz)
 *  - [start - bufferBefore, end + bufferAfter) must not overlap any busy interval
 *  - days where the host already has `dailyLimit` meetings are skipped
 */
export function hostSlotStarts(
  config: SlotConfig,
  host: SlotHost,
  busy: BusyInterval[],
  now: Date,
  range: SlotRange = {},
): number[] {
  const tz = host.timezone;
  const dur = Math.max(1, config.durationMinutes) * MIN;
  const inc = Math.max(1, config.slotIncrementMinutes) * MIN;
  const before = Math.max(0, config.bufferBeforeMinutes) * MIN;
  const after = Math.max(0, config.bufferAfterMinutes) * MIN;
  const earliest = now.getTime() + Math.max(0, config.minNoticeMinutes) * MIN;
  const from = range.from?.getTime() ?? -Infinity;
  const to = range.to?.getTime() ?? Infinity;
  if (to <= from) return [];

  const todayKey = localDateKey(now, tz);
  const lastKey = addDaysToKey(todayKey, Math.max(0, config.maxDaysAhead));
  let firstKey = todayKey;
  let endKey = lastKey;
  if (Number.isFinite(from)) {
    const k = localDateKey(from, tz);
    if (k > firstKey) firstKey = k;
  }
  if (Number.isFinite(to)) {
    const k = localDateKey(to - 1, tz);
    if (k < endKey) endKey = k;
  }
  if (firstKey > endKey) return [];

  const mine = busy.filter((b) => b.hostId === host.id);
  const meetingsPerDay = new Map<string, number>();
  if (config.dailyLimit != null) {
    for (const b of mine) {
      if (!b.isMeeting) continue;
      const k = localDateKey(b.start, tz);
      meetingsPerDay.set(k, (meetingsPerDay.get(k) ?? 0) + 1);
    }
  }

  const out = new Set<number>();
  for (let key = firstKey; key <= endKey; key = addDaysToKey(key, 1)) {
    if (config.dailyLimit != null && (meetingsPerDay.get(key) ?? 0) >= config.dailyLimit) continue;
    for (const [ws, we] of windowsForDate(host, key)) {
      const winStart = zonedInstant(key, ws, tz);
      const winEnd = zonedInstant(key, we, tz);
      for (let s = winStart; s + dur <= winEnd; s += inc) {
        if (s < earliest || s < from || s >= to) continue;
        const a = s - before;
        const b = s + dur + after;
        if (mine.some((x) => x.start.getTime() < b && a < x.end.getTime())) continue;
        out.add(s);
      }
    }
  }
  return [...out].sort((x, y) => x - y);
}

export type ComputeSlotsInput = {
  config: SlotConfig;
  hosts: SlotHost[];
  busy: BusyInterval[];
  now: Date;
  /** Only return slots starting in [from, to). */
  from?: Date;
  to?: Date;
};

/** Union of all hosts' slots, sorted by start. Each slot lists the hosts that are free. */
export function computeSlots(input: ComputeSlotsInput): Slot[] {
  const dur = Math.max(1, input.config.durationMinutes) * MIN;
  const byStart = new Map<number, string[]>();
  for (const host of input.hosts) {
    const starts = hostSlotStarts(input.config, host, input.busy, input.now, { from: input.from, to: input.to });
    for (const s of starts) {
      const list = byStart.get(s);
      if (list) list.push(host.id);
      else byStart.set(s, [host.id]);
    }
  }
  return [...byStart.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([s, hostIds]) => ({ start: new Date(s).toISOString(), end: new Date(s + dur).toISOString(), hostIds }));
}

/** Hosts that are free at exactly `start` (empty when the time is not an available slot). */
export function hostsFreeAt(input: Omit<ComputeSlotsInput, "from" | "to">, start: Date): string[] {
  const ms = start.getTime();
  if (Number.isNaN(ms)) return [];
  const [slot] = computeSlots({ ...input, from: new Date(ms), to: new Date(ms + 1) });
  return slot?.hostIds ?? [];
}

// ---------------------------------------------------------------------------
// Round robin
// ---------------------------------------------------------------------------

/**
 * Pick the host to assign: the one whose last meeting from this page was assigned longest ago
 * (never assigned = oldest); ties → fewest upcoming meetings; remaining ties keep `candidates` order.
 */
export function pickRoundRobinHost(candidates: string[], loads: Record<string, HostLoad | undefined>): string | null {
  if (!candidates.length) return null;
  const ranked = candidates.map((id, index) => {
    const l = loads[id];
    return { id, index, last: l?.lastAssignedAt ? l.lastAssignedAt.getTime() : -Infinity, upcoming: l?.upcoming ?? 0 };
  });
  ranked.sort((a, b) => (a.last === b.last ? 0 : a.last < b.last ? -1 : 1) || a.upcoming - b.upcoming || a.index - b.index);
  return ranked[0].id;
}

// ---------------------------------------------------------------------------
// Presentation helpers (visitor timezone) – safe for client components
// ---------------------------------------------------------------------------

/** Group slot start ISO strings by local date key in `tz`. */
export function groupSlotsByDate(starts: string[], tz: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const iso of starts) {
    const key = localDateKey(new Date(iso), tz);
    (out[key] ??= []).push(iso);
  }
  for (const list of Object.values(out)) list.sort();
  return out;
}

/** UTC range [from, to) covering a whole local month ("yyyy-MM") in `tz`. */
export function monthRange(monthKey: string, tz: string): { from: Date; to: Date } {
  const first = `${monthKey}-01`;
  const [y, m] = monthKey.split("-").map(Number);
  const next = `${m === 12 ? y + 1 : y}-${pad(m === 12 ? 1 : m + 1)}-01`;
  return { from: new Date(startOfZonedDay(first, tz)), to: new Date(startOfZonedDay(next, tz)) };
}

export function addMonthsToKey(monthKey: string, n: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** "Mon 5 Oct" style date + time formatting in a timezone. */
export function formatSlotTime(iso: string | Date, tz: string, hour12: boolean): string {
  const d = new TZDate(new Date(iso).getTime(), tz);
  const h = d.getHours();
  const mm = pad(d.getMinutes());
  if (!hour12) return `${pad(h)}:${mm}`;
  return `${h % 12 === 0 ? 12 : h % 12}:${mm}${h < 12 ? "am" : "pm"}`;
}
