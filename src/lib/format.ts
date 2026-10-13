import { formatDistanceToNowStrict } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { format as dfFormat } from "date-fns";

type NameLike = { firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null };

export function fullName(c: NameLike | null | undefined): string {
  if (!c) return "Unknown";
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return name || c.email || c.phone || "Unnamed contact";
}

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Format a date in a specific IANA timezone. Patterns are date-fns patterns. */
export function formatInTz(date: Date | string | number, tz: string, pattern = "d MMM yyyy, HH:mm"): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return dfFormat(new TZDate(d, tz), pattern);
}

export function formatDate(date: Date | string | number | null | undefined, tz: string, pattern = "d MMM yyyy") {
  if (!date) return "";
  return formatInTz(date, tz, pattern);
}

export function formatDateTime(date: Date | string | number | null | undefined, tz: string) {
  if (!date) return "";
  return formatInTz(date, tz, "EEE d MMM yyyy, HH:mm");
}

export function formatTimeRange(start: Date, end: Date, tz: string) {
  const sameDay = formatInTz(start, tz, "yyyy-MM-dd") === formatInTz(end, tz, "yyyy-MM-dd");
  return sameDay
    ? `${formatInTz(start, tz, "EEE d MMM yyyy, HH:mm")} – ${formatInTz(end, tz, "HH:mm")}`
    : `${formatInTz(start, tz, "EEE d MMM, HH:mm")} – ${formatInTz(end, tz, "EEE d MMM yyyy, HH:mm")}`;
}

export function timeAgo(date: Date | string | number | null | undefined): string {
  if (!date) return "never";
  return formatDistanceToNowStrict(new Date(date), { addSuffix: true });
}

export function formatMoney(value: number | null | undefined, currency = "AUD") {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

export function formatNumber(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-AU").format(value);
}

/** 0.4567 → "45.7%". Returns "—" for NaN/Infinity. */
export function formatPercent(ratio: number | null | undefined, digits = 1) {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits).replace(/\.0$/, "")}%`;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function pluralize(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
