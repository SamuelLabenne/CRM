import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { eventAttendees, events } from "@/lib/db/schema";
import { eventPublicPath, absoluteUrl } from "@/lib/urls";
import { jsonOk, parseQuery, withApiKey } from "../_lib/http";

const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) });

/** GET /api/v1/events – upcoming scheduled events (1:1 meetings are not listed). */
export const GET = withApiKey(async (req) => {
  const { limit } = parseQuery(req, query);
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.kind, "event"), eq(events.status, "scheduled"), gte(events.endsAt, new Date())))
    .orderBy(asc(events.startsAt))
    .limit(limit);
  const ids = rows.map((e) => e.id);
  const taken = ids.length
    ? await db
        .select({ eventId: eventAttendees.eventId, n: sql<number>`count(*)::int` })
        .from(eventAttendees)
        .where(and(inArray(eventAttendees.eventId, ids), inArray(eventAttendees.status, ["registered", "confirmed", "attended", "no_show"])))
        .groupBy(eventAttendees.eventId)
    : [];
  const seats = new Map(taken.map((t) => [t.eventId, t.n]));
  return jsonOk({
    data: rows.map((e) => {
      const registered = seats.get(e.id) ?? 0;
      return {
        id: e.id,
        title: e.title,
        description: e.description,
        type: e.type,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        timezone: e.timezone,
        locationType: e.locationType,
        location: e.location,
        capacity: e.capacity,
        registered,
        spotsLeft: e.capacity == null ? null : Math.max(0, e.capacity - registered),
        waitlistEnabled: e.waitlistEnabled,
        registrationOpen: e.registrationOpen,
        publicUrl: e.isPublic && e.slug ? absoluteUrl(eventPublicPath(e.slug)) : null,
      };
    }),
    limit,
  });
});
