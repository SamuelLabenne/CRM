import { and, asc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, eventAttendees, events, users, type User } from "@/lib/db/schema";
import { randomToken } from "@/lib/crypto";
import { eventLocationText } from "@/lib/email/context";
import { buildIcs, type IcsEvent } from "@/lib/ics";
import { getSetting } from "@/lib/settings";
import { absoluteUrl } from "@/lib/urls";
import { num } from "./metrics";

const DAY = 864e5;

/** Returns the user's personal calendar-feed token, creating one when missing. */
export async function ensureCalendarToken(userId: string): Promise<string> {
  const [user] = await db.select({ token: users.calendarToken }).from(users).where(eq(users.id, userId));
  if (!user) throw new Error("User not found");
  if (user.token) return user.token;
  const token = randomToken(24);
  const [updated] = await db
    .update(users)
    .set({ calendarToken: sql`coalesce(${users.calendarToken}, ${token})` })
    .where(eq(users.id, userId))
    .returning({ token: users.calendarToken });
  return updated?.token ?? token;
}

/** Replaces the token (invalidates the old subscription URL). */
export async function rotateCalendarToken(userId: string): Promise<string> {
  const token = randomToken(24);
  await db.update(users).set({ calendarToken: token }).where(eq(users.id, userId));
  return token;
}

/**
 * ICS body for a user's personal feed: events & meetings they host (everything for admins),
 * from 30 days ago to 180 days ahead. Cancelled and draft events are left out.
 */
export async function buildCalendarFeed(user: Pick<User, "id" | "role" | "name">, now: Date = new Date()): Promise<string> {
  const ws = await getSetting("workspace");
  const admin = user.role === "owner" || user.role === "admin";
  const rows = await db
    .select({ event: events, campaignName: campaigns.name, hostName: users.name })
    .from(events)
    .leftJoin(campaigns, eq(campaigns.id, events.campaignId))
    .leftJoin(users, eq(users.id, events.hostId))
    .where(
      and(
        gte(events.startsAt, new Date(now.getTime() - 30 * DAY)),
        lt(events.startsAt, new Date(now.getTime() + 180 * DAY)),
        inArray(events.status, ["scheduled", "completed"]),
        admin ? undefined : eq(events.hostId, user.id),
      ),
    )
    .orderBy(asc(events.startsAt))
    .limit(2000);

  const ids = rows.map((r) => r.event.id);
  const counts = ids.length
    ? await db
        .select({ eventId: eventAttendees.eventId, n: sql<number>`count(*)::int` })
        .from(eventAttendees)
        .where(and(inArray(eventAttendees.eventId, ids), ne(eventAttendees.status, "cancelled"), ne(eventAttendees.status, "waitlisted")))
        .groupBy(eventAttendees.eventId)
    : [];
  const countMap = new Map(counts.map((c) => [c.eventId, num(c.n)]));

  const ics: IcsEvent[] = rows.map(({ event, campaignName, hostName }) => {
    const registered = countMap.get(event.id) ?? 0;
    const url = absoluteUrl(`/events/${event.id}`);
    const description = [
      event.kind === "meeting" ? "Meeting" : `Event (${event.type})`,
      campaignName ? `Campaign: ${campaignName}` : null,
      hostName && admin ? `Host: ${hostName}` : null,
      event.kind === "event" ? `Registered: ${registered}${event.capacity ? ` / ${event.capacity}` : ""}` : null,
      event.meetingUrl ? `Join: ${event.meetingUrl}` : null,
      event.description,
      `Open in Relay: ${url}`,
    ]
      .filter(Boolean)
      .join("\n");
    return {
      uid: `${event.id}@relay`,
      title: event.title,
      description,
      location: event.meetingUrl || eventLocationText(event),
      url,
      start: event.startsAt,
      end: event.endsAt,
      status: "CONFIRMED",
      updatedAt: event.updatedAt,
    };
  });
  return buildIcs(ics, `${ws.name} – ${user.name}`);
}
