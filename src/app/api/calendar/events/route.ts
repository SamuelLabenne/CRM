import { type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getCalendarEvents } from "@/lib/analytics/calendar";

const flag = (def: boolean) =>
  z
    .enum(["0", "1"])
    .optional()
    .transform((v) => (v == null ? def : v === "1"));

const querySchema = z.object({
  start: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid start"),
  end: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid end"),
  types: z.string().optional(),
  campaign: z.uuid().optional(),
  mine: flag(false),
  events: flag(true),
  meetings: flag(true),
  campaigns: flag(true),
  broadcasts: flag(true),
  tasks: flag(true),
  cancelled: flag(false),
});

const EVENT_TYPES = ["webinar", "workshop", "meetup", "conference", "class", "meeting", "call", "other"] as const;

/** FullCalendar event feed for the visible range, filtered by the calendar toolbar. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid query" }, { status: 400 });
  const q = parsed.data;
  const start = new Date(q.start);
  const end = new Date(q.end);
  if (end <= start || end.getTime() - start.getTime() > 400 * 864e5) {
    return Response.json({ error: "Invalid date range" }, { status: 400 });
  }
  const types = (q.types?.split(",") ?? []).filter((t): t is (typeof EVENT_TYPES)[number] => (EVENT_TYPES as readonly string[]).includes(t));

  const data = await getCalendarEvents({
    start,
    end,
    events: q.events,
    meetings: q.meetings,
    campaigns: q.campaigns,
    broadcasts: q.broadcasts,
    tasks: q.tasks,
    cancelled: q.cancelled,
    types,
    campaignId: q.campaign ?? null,
    mineUserId: q.mine ? user.id : null,
  });
  return Response.json(data, { headers: { "cache-control": "private, no-store" } });
}
