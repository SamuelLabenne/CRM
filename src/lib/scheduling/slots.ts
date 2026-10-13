import { and, count, eq, gt, inArray, isNull, lt, max, ne } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";
import { events, users, type BookingPage } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings";
import {
  computeSlots,
  hostsFreeAt,
  resolveTimezone,
  type BusyInterval,
  type HostLoad,
  type Slot,
  type SlotConfig,
  type SlotHost,
} from "./slots-core";

// The slot engine: pure functions live in ./slots-core (re-exported here); this file adds
// the database loader that feeds them (hosts, busy intervals, round-robin load).
export * from "./slots-core";

const DAY_MS = 86_400_000;

export type SlotPage = Pick<
  BookingPage,
  | "id"
  | "hostIds"
  | "durationMinutes"
  | "bufferBeforeMinutes"
  | "bufferAfterMinutes"
  | "minNoticeMinutes"
  | "maxDaysAhead"
  | "slotIncrementMinutes"
  | "dailyLimit"
>;

export function slotConfigOf(page: SlotPage): SlotConfig {
  return {
    durationMinutes: page.durationMinutes,
    bufferBeforeMinutes: page.bufferBeforeMinutes,
    bufferAfterMinutes: page.bufferAfterMinutes,
    minNoticeMinutes: page.minNoticeMinutes,
    maxDaysAhead: page.maxDaysAhead,
    slotIncrementMinutes: page.slotIncrementMinutes,
    dailyLimit: page.dailyLimit,
  };
}

/** Active hosts of a page with their effective timezone (user tz → workspace tz → UTC). */
export async function loadSlotHosts(hostIds: string[], tx: Tx = db, workspaceTimezone?: string): Promise<SlotHost[]> {
  if (!hostIds.length) return [];
  // NB: inside a transaction pass `workspaceTimezone` – getSetting() uses the global connection.
  const wsTz = workspaceTimezone ?? (await getSetting("workspace")).timezone;
  const rows = await tx
    .select({
      id: users.id,
      timezone: users.timezone,
      availability: users.availability,
      dateOverrides: users.dateOverrides,
    })
    .from(users)
    .where(and(inArray(users.id, hostIds), isNull(users.deactivatedAt)));
  // keep the page's host order (it is the round-robin tie-break order)
  const order = new Map(hostIds.map((id, i) => [id, i]));
  return rows
    .map((u) => ({
      id: u.id,
      timezone: resolveTimezone(u.timezone, wsTz),
      availability: u.availability,
      dateOverrides: u.dateOverrides ?? [],
    }))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** Non-cancelled events & meetings of the hosts around [from, to) (padded for buffers and day limits). */
export async function loadBusyIntervals(
  hostIds: string[],
  from: Date,
  to: Date,
  opts: { excludeEventId?: string | null; tx?: Tx } = {},
): Promise<BusyInterval[]> {
  if (!hostIds.length) return [];
  const tx = opts.tx ?? db;
  const rows = await tx
    .select({ hostId: events.hostId, startsAt: events.startsAt, endsAt: events.endsAt, kind: events.kind })
    .from(events)
    .where(
      and(
        inArray(events.hostId, hostIds),
        ne(events.status, "cancelled"),
        gt(events.endsAt, new Date(from.getTime() - 2 * DAY_MS)),
        lt(events.startsAt, new Date(to.getTime() + 2 * DAY_MS)),
        opts.excludeEventId ? ne(events.id, opts.excludeEventId) : undefined,
      ),
    );
  return rows
    .filter((r): r is typeof r & { hostId: string } => r.hostId != null)
    .map((r) => ({ hostId: r.hostId, start: r.startsAt, end: r.endsAt, isMeeting: r.kind === "meeting" }));
}

/** Round-robin inputs: last assignment from this page and upcoming meeting count per host. */
export async function loadHostLoads(
  pageId: string,
  hostIds: string[],
  now: Date = new Date(),
  tx: Tx = db,
): Promise<Record<string, HostLoad>> {
  const loads: Record<string, HostLoad> = Object.fromEntries(hostIds.map((id) => [id, { lastAssignedAt: null, upcoming: 0 }]));
  if (!hostIds.length) return loads;
  const [last, upcoming] = await Promise.all([
    tx
      .select({ hostId: events.hostId, last: max(events.createdAt) })
      .from(events)
      .where(
        and(
          eq(events.bookingPageId, pageId),
          eq(events.kind, "meeting"),
          ne(events.status, "cancelled"),
          inArray(events.hostId, hostIds),
        ),
      )
      .groupBy(events.hostId),
    tx
      .select({ hostId: events.hostId, n: count() })
      .from(events)
      .where(
        and(
          eq(events.kind, "meeting"),
          ne(events.status, "cancelled"),
          gt(events.startsAt, now),
          inArray(events.hostId, hostIds),
        ),
      )
      .groupBy(events.hostId),
  ]);
  for (const r of last) if (r.hostId && loads[r.hostId]) loads[r.hostId].lastAssignedAt = r.last ?? null;
  for (const r of upcoming) if (r.hostId && loads[r.hostId]) loads[r.hostId].upcoming = Number(r.n);
  return loads;
}

export type AvailabilityOptions = {
  now?: Date;
  /** Only slots starting in [from, to). Defaults to now … now + maxDaysAhead + 2 days. */
  from?: Date;
  to?: Date;
  /** Ignore this event when computing busy time (rescheduling a meeting). */
  excludeEventId?: string | null;
  /** Workspace timezone (fallback for hosts without one). Required when running inside a transaction. */
  workspaceTimezone?: string;
  tx?: Tx;
};

/** Everything the engine needs for a page, loaded in a few queries. */
export async function loadSlotInput(page: SlotPage, opts: AvailabilityOptions = {}) {
  const now = opts.now ?? new Date();
  const from = opts.from ?? now;
  const to = opts.to ?? new Date(now.getTime() + (page.maxDaysAhead + 2) * DAY_MS);
  const hosts = await loadSlotHosts(page.hostIds, opts.tx, opts.workspaceTimezone);
  const busy = await loadBusyIntervals(
    hosts.map((h) => h.id),
    from,
    to,
    { excludeEventId: opts.excludeEventId, tx: opts.tx },
  );
  return { config: slotConfigOf(page), hosts, busy, now, from, to };
}

/** Available slots (UTC ISO) of a booking page. */
export async function getAvailableSlots(page: SlotPage, opts: AvailabilityOptions = {}): Promise<Slot[]> {
  const input = await loadSlotInput(page, opts);
  return computeSlots(input);
}

/**
 * Hosts that are free at exactly `start` (empty array = not bookable any more).
 * Use inside a transaction (with `opts.tx`) to avoid double booking.
 */
export async function getFreeHostsAt(page: SlotPage, start: Date, opts: Omit<AvailabilityOptions, "from" | "to"> = {}) {
  const now = opts.now ?? new Date();
  const input = await loadSlotInput(page, {
    ...opts,
    now,
    from: start,
    to: new Date(start.getTime() + 1),
  });
  return { hostIds: hostsFreeAt(input, start), hosts: input.hosts };
}
