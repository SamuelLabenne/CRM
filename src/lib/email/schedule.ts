import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

/**
 * Parse the value of an `<input type="datetime-local">` ("2026-10-20T09:30") as wall-clock
 * time in the given IANA timezone and return the matching instant. Returns null when invalid.
 */
export function parseZonedLocal(input: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(input.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  try {
    const z = new TZDate(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0), 0, tz);
    const date = new Date(z.getTime());
    if (Number.isNaN(date.getTime())) return null;
    // Reject overflowed dates such as 2026-02-31 (which JS would roll into March).
    if (z.getMonth() !== Number(mo) - 1 || z.getDate() !== Number(d)) return null;
    return date;
  } catch {
    return null;
  }
}

/** Format an instant as an `<input type="datetime-local">` value in the given timezone. */
export function toZonedLocalInput(date: Date, tz: string): string {
  return format(new TZDate(date, tz), "yyyy-MM-dd'T'HH:mm");
}
