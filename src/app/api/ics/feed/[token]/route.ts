import { and, eq, isNull } from "drizzle-orm";
import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { buildCalendarFeed } from "@/lib/analytics/feed";

/**
 * Personal calendar feed (webcal/ICS subscription). The secret token in the URL is the
 * authentication, so this route is public by design; deactivated users get a 404.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/ics/feed/[token]">) {
  const { token } = await ctx.params;
  if (!token || token.length < 16) return new Response("Not found", { status: 404 });
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.calendarToken, token), isNull(users.deactivatedAt)));
  if (!user) return new Response("Not found", { status: 404 });
  const ics = await buildCalendarFeed(user);
  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="relay.ics"',
      "cache-control": "private, max-age=300",
    },
  });
}
