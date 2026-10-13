import type { AttendeeStatus } from "@/lib/types";

// Metric definitions shared by the dashboard, reports and calendar (see "Key metrics" in docs/SPEC.md).

/** Attendee statuses that count as a registration / booked seat (everything except waitlisted & cancelled). */
export const REGISTERED_STATUSES: AttendeeStatus[] = ["registered", "confirmed", "attended", "no_show"];

/** Message statuses that count as delivered (simulated = outbox provider). */
export const DELIVERED_STATUSES = ["sent", "simulated"] as const;

/** a / b, or null when b is 0 (never NaN/Infinity). */
export function ratio(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null;
  return a / b;
}

/** Show-up rate = attended / (attended + no_show). */
export function showUpRate(attended: number, noShow: number): number | null {
  return ratio(attended, attended + noShow);
}

/** Relative change vs the previous period (0.12 = +12%). Null when there is nothing to compare with. */
export function relativeDelta(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / Math.abs(previous);
}

/** Difference between two rates (percentage points as a ratio: 0.05 = +5 pts). */
export function rateDelta(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null) return null;
  return current - previous;
}

/** Postgres returns count()/sum() as number or string depending on the driver. */
export function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
