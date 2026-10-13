import { and, count, countDistinct, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { bookingPages, events, pageViews, users, type BookingPage } from "@/lib/db/schema";
import { slugify } from "@/lib/format";
import { appBaseUrl } from "@/lib/urls";

/** A slug no other booking page uses (appends -2, -3… when taken). */
export async function uniqueSlug(base: string, exceptId?: string): Promise<string> {
  const root = slugify(base) || "booking";
  for (let i = 1; i < 200; i++) {
    const candidate = i === 1 ? root : `${root.slice(0, 55)}-${i}`;
    const [hit] = await db
      .select({ id: bookingPages.id })
      .from(bookingPages)
      .where(exceptId ? and(eq(bookingPages.slug, candidate), ne(bookingPages.id, exceptId)) : eq(bookingPages.slug, candidate))
      .limit(1);
    if (!hit) return candidate;
  }
  return `${root.slice(0, 40)}-${Date.now().toString(36)}`;
}

/** Origin used for absolute public links (env APP_URL, else the current request host). */
export async function requestOrigin(): Promise<string> {
  if (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL) return appBaseUrl();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return appBaseUrl();
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

export type PageListItem = BookingPage & {
  hostUsers: { id: string; name: string; color: string }[];
  bookings30: number;
  views30: number;
};

/** All booking pages with hosts, bookings (30 days) and unique page views (30 days). */
export async function listPagesWithStats(now: Date = new Date()): Promise<PageListItem[]> {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const [pages, bookings, views, allUsers] = await Promise.all([
    db.select().from(bookingPages).orderBy(sql`${bookingPages.createdAt} desc`),
    db
      .select({ pageId: events.bookingPageId, n: count() })
      .from(events)
      .where(and(eq(events.kind, "meeting"), gte(events.createdAt, since)))
      .groupBy(events.bookingPageId),
    db
      .select({ pageId: pageViews.targetId, n: countDistinct(pageViews.visitorHash) })
      .from(pageViews)
      .where(and(eq(pageViews.kind, "booking"), gte(pageViews.createdAt, since)))
      .groupBy(pageViews.targetId),
    db.select({ id: users.id, name: users.name, color: users.color }).from(users),
  ]);
  const userById = new Map(allUsers.map((u) => [u.id, u]));
  const bookingMap = new Map(bookings.map((b) => [b.pageId, Number(b.n)]));
  const viewMap = new Map(views.map((v) => [v.pageId, Number(v.n)]));
  return pages.map((p) => ({
    ...p,
    hostUsers: p.hostIds.map((id) => userById.get(id)).filter((u): u is NonNullable<typeof u> => !!u),
    bookings30: bookingMap.get(p.id) ?? 0,
    views30: viewMap.get(p.id) ?? 0,
  }));
}

export async function getPageStats(pageId: string, now: Date = new Date()) {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const [[b], [v]] = await Promise.all([
    db.select({ n: count() }).from(events).where(and(eq(events.bookingPageId, pageId), eq(events.kind, "meeting"), gte(events.createdAt, since))),
    db
      .select({ n: countDistinct(pageViews.visitorHash) })
      .from(pageViews)
      .where(and(eq(pageViews.kind, "booking"), eq(pageViews.targetId, pageId), gte(pageViews.createdAt, since))),
  ]);
  return { bookings30: Number(b?.n ?? 0), views30: Number(v?.n ?? 0) };
}

export async function activeUsers(ids?: string[]) {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      color: users.color,
      timezone: users.timezone,
      availability: users.availability,
      dateOverrides: users.dateOverrides,
      deactivatedAt: users.deactivatedAt,
    })
    .from(users)
    .where(ids ? inArray(users.id, ids) : undefined)
    .orderBy(users.name);
}

/** Current time in ms (a named helper so server components can read the clock without tripping the render-purity lint rule). */
export function serverNowMs(): number {
  return Date.now();
}
