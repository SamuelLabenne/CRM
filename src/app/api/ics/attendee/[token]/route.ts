import { eq } from "drizzle-orm";
import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { eventAttendees, events } from "@/lib/db/schema";
import { buildIcs } from "@/lib/ics";
import { eventLocationText } from "@/lib/email/context";
import { absoluteUrl, attendeeManagePath } from "@/lib/urls";
import { getSetting } from "@/lib/settings";

/** "Add to calendar" file for one registration / meeting. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/ics/attendee/[token]">) {
  const { token } = await ctx.params;
  const [row] = await db
    .select({ attendee: eventAttendees, event: events })
    .from(eventAttendees)
    .innerJoin(events, eq(events.id, eventAttendees.eventId))
    .where(eq(eventAttendees.manageToken, token));
  if (!row) return new Response("Not found", { status: 404 });
  const ws = await getSetting("workspace");
  const manage = absoluteUrl(attendeeManagePath(token));
  const ics = buildIcs(
    [
      {
        uid: `${row.attendee.id}@relay`,
        title: row.event.title,
        description: [row.event.description, row.event.meetingUrl ? `Join: ${row.event.meetingUrl}` : null, `Manage: ${manage}`]
          .filter(Boolean)
          .join("\n\n"),
        location: row.event.meetingUrl || eventLocationText(row.event),
        url: manage,
        start: row.event.startsAt,
        end: row.event.endsAt,
        status: row.attendee.status === "cancelled" || row.event.status === "cancelled" ? "CANCELLED" : "CONFIRMED",
        updatedAt: row.event.updatedAt,
      },
    ],
    ws.name,
  );
  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="event.ics"`,
    },
  });
}
