"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, ok, zodFail, type ActionResult } from "@/lib/action";
import { getSetting } from "@/lib/settings";
import { createQuickEvent, moveCalendarEvent, wallTimeToDate } from "@/lib/analytics/calendar";
import { ensureCalendarToken, rotateCalendarToken } from "@/lib/analytics/feed";
import { absoluteUrl, calendarFeedPath } from "@/lib/urls";

const EVENT_TYPES = ["webinar", "workshop", "meetup", "conference", "class", "meeting", "call", "other"] as const;

const quickCreateSchema = z.object({
  title: z.string().trim().min(1, "Give the event a title").max(200),
  type: z.enum(EVENT_TYPES),
  /** Wall-clock times in the workspace timezone: "2026-10-14T09:00". */
  start: z.string().min(1, "Choose a start time"),
  end: z.string().min(1, "Choose an end time"),
  campaignId: z.uuid().nullable().optional(),
});

/** Quick-create from the calendar: a scheduled event hosted by the current user. */
export async function quickCreateEventAction(input: z.input<typeof quickCreateSchema>): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = quickCreateSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const d = parsed.data;
  const ws = await getSetting("workspace");
  const startsAt = wallTimeToDate(d.start, ws.timezone);
  const endsAt = wallTimeToDate(d.end, ws.timezone);
  if (!startsAt) return fail("Enter a valid start time.", { start: ["Enter a valid start time"] });
  if (!endsAt) return fail("Enter a valid end time.", { end: ["Enter a valid end time"] });
  if (endsAt <= startsAt) return fail("The end must be after the start.", { end: ["The end must be after the start"] });
  const event = await createQuickEvent({
    title: d.title,
    type: d.type,
    startsAt,
    endsAt,
    campaignId: d.campaignId ?? null,
    hostId: user.id,
  });
  revalidatePath("/calendar");
  revalidatePath("/events");
  revalidatePath("/dashboard");
  return ok({ id: event.id }, "Event created");
}

const moveSchema = z.object({
  eventId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
});

/** Drag / resize on the calendar: update the times and re-plan reminders. */
export async function moveEventAction(input: z.input<typeof moveSchema>): Promise<ActionResult<{ attendees: number }>> {
  await requireUser();
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const res = await moveCalendarEvent(parsed.data.eventId, new Date(parsed.data.startsAt), new Date(parsed.data.endsAt));
  if (!res.ok) return fail(res.error);
  revalidatePath("/calendar");
  revalidatePath("/events");
  revalidatePath(`/events/${parsed.data.eventId}`);
  revalidatePath("/dashboard");
  return ok({ attendees: res.attendees }, "Event rescheduled");
}

async function feedUrl(token: string) {
  // Prefer the host the user is browsing on (works for localhost, previews and custom domains).
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) {
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
    return `${proto}://${host}${calendarFeedPath(token)}`;
  }
  return absoluteUrl(calendarFeedPath(token));
}

/** The current user's personal ICS feed URL (token generated on first use). */
export async function getCalendarFeedAction(): Promise<ActionResult<{ url: string }>> {
  const user = await requireUser();
  const token = await ensureCalendarToken(user.id);
  return ok({ url: await feedUrl(token) });
}

/** Issue a new feed URL; the old one stops working. */
export async function resetCalendarFeedAction(): Promise<ActionResult<{ url: string }>> {
  const user = await requireUser();
  const token = await rotateCalendarToken(user.id);
  return ok({ url: await feedUrl(token) }, "Calendar link reset");
}
