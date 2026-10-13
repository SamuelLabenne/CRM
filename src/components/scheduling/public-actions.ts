"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { fail, ok, zodFail, type ActionResult } from "@/lib/action";
import { kickJobs } from "@/lib/jobs/kick";
import { googleCalendarLink } from "@/lib/ics";
import { attendeeIcsPath, attendeeManagePath } from "@/lib/urls";
import { eventLocationText } from "@/lib/email/context";
import {
  BOOKING_ERRORS,
  createBooking,
  getBookingPageBySlug,
  getRescheduleContext,
  rescheduleMeeting,
  startBooking,
  submitQualification,
} from "@/lib/scheduling/booking";
import { getAvailableSlots, isValidTimezone } from "@/lib/scheduling/slots";
import type { Event } from "@/lib/db/schema";

// Public (unauthenticated) server actions behind /book/[slug], /embed/book/[slug] and /m/[token]/reschedule.
// Everything is validated with zod and re-checked on the server (slot availability, qualification).

const MAX_RANGE_MS = 45 * 86_400_000;
const FAKE_CAPTURE = "00000000-0000-4000-8000-000000000000";

const slugSchema = z.string().trim().min(1).max(80);
const isoSchema = z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), "Invalid date");
const tzSchema = z.string().max(80).refine((v) => isValidTimezone(v), "Unknown timezone");

function parseRange(from: string, to: string): { from: Date; to: Date } | null {
  const f = new Date(from);
  const t = new Date(to);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || t <= f || t.getTime() - f.getTime() > MAX_RANGE_MS) return null;
  return { from: f, to: t };
}

// ---------------------------------------------------------------------------
// Step 1 & 2
// ---------------------------------------------------------------------------

const startSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1, "Please enter your name").max(120),
  email: z.string().trim().max(254).pipe(z.email("Please enter a valid email address")),
  phone: z.string().trim().max(40).optional(),
  /** Honeypot – real visitors never fill this in. */
  website: z.string().max(200).optional(),
  utm: z.record(z.string().max(40), z.string().max(200)).optional(),
});

export async function startBookingAction(
  input: z.input<typeof startSchema>,
): Promise<ActionResult<{ captureId: string; next: "questions" | "calendar" }>> {
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const v = parsed.data;
  if (v.website) return ok({ captureId: FAKE_CAPTURE, next: "calendar" as const }); // bots: pretend it worked
  const page = await getBookingPageBySlug(v.slug);
  if (!page || !page.isActive) return fail(BOOKING_ERRORS.inactive);
  try {
    const res = await startBooking(page, { name: v.name, email: v.email, phone: v.phone, utm: v.utm });
    return ok({ captureId: res.captureId, next: res.next });
  } catch (err) {
    console.error("[booking] start failed", err);
    return fail("Something went wrong. Please try again.");
  }
}

const qualifySchema = z.object({
  slug: slugSchema,
  captureId: z.string().uuid(),
  answers: z.record(z.string().max(80), z.unknown()),
});

export async function submitQualificationAction(
  input: z.input<typeof qualifySchema>,
): Promise<ActionResult<{ qualified: true } | { qualified: false; message: string; redirectUrl: string | null }> & { fieldErrors?: Record<string, string[] | undefined> }> {
  const parsed = qualifySchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const page = await getBookingPageBySlug(parsed.data.slug);
  if (!page || !page.isActive) return fail(BOOKING_ERRORS.inactive);
  const res = await submitQualification(page, parsed.data.captureId, parsed.data.answers);
  if (!res.ok) {
    return fail(res.error, res.fieldErrors ? Object.fromEntries(Object.entries(res.fieldErrors).map(([k, m]) => [k, [m]])) : undefined);
  }
  if (res.qualified) return ok({ qualified: true as const });
  return ok({ qualified: false as const, message: res.message, redirectUrl: res.redirectUrl });
}

// ---------------------------------------------------------------------------
// Step 3: slots & confirm
// ---------------------------------------------------------------------------

const slotsSchema = z.object({ slug: slugSchema, from: isoSchema, to: isoSchema });

/** Available start times (UTC ISO) in [from, to). */
export async function getSlotsAction(input: z.input<typeof slotsSchema>): Promise<ActionResult<{ slots: string[] }>> {
  const parsed = slotsSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const range = parseRange(parsed.data.from, parsed.data.to);
  if (!range) return fail("Invalid date range");
  const page = await getBookingPageBySlug(parsed.data.slug);
  if (!page || !page.isActive) return fail(BOOKING_ERRORS.inactive);
  const slots = await getAvailableSlots(page, { from: range.from, to: range.to });
  return ok({ slots: slots.map((s) => s.start) });
}

export type BookingConfirmation = {
  title: string;
  startIso: string;
  endIso: string;
  hostName: string;
  locationType: Event["locationType"];
  locationText: string;
  meetingUrl: string | null;
  googleUrl: string;
  icsPath: string;
  managePath: string;
  reschedulePath: string;
  confirmationMessage: string | null;
  redirectUrl: string | null;
};

function confirmationFor(event: Event, token: string, hostName: string, extra: { confirmationMessage: string | null; redirectUrl: string | null }): BookingConfirmation {
  return {
    title: event.title,
    startIso: event.startsAt.toISOString(),
    endIso: event.endsAt.toISOString(),
    hostName,
    locationType: event.locationType,
    locationText: eventLocationText(event),
    meetingUrl: event.meetingUrl,
    googleUrl: googleCalendarLink({
      title: event.title,
      description: [event.description, event.meetingUrl].filter(Boolean).join("\n\n") || undefined,
      location: event.meetingUrl || eventLocationText(event),
      start: event.startsAt,
      end: event.endsAt,
    }),
    icsPath: attendeeIcsPath(token),
    managePath: attendeeManagePath(token),
    reschedulePath: `${attendeeManagePath(token)}/reschedule`,
    ...extra,
  };
}

const confirmSchema = z.object({
  slug: slugSchema,
  captureId: z.string().uuid(),
  start: isoSchema,
  timezone: tzSchema.optional(),
});

export async function confirmBookingAction(input: z.input<typeof confirmSchema>): Promise<ActionResult<BookingConfirmation>> {
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const v = parsed.data;
  const page = await getBookingPageBySlug(v.slug);
  if (!page || !page.isActive) return fail(BOOKING_ERRORS.inactive);
  let res;
  try {
    res = await createBooking({ page, start: new Date(v.start), captureId: v.captureId });
  } catch (err) {
    console.error("[booking] create failed", err);
    return fail("Something went wrong while booking. Please try again.");
  }
  if (!res.ok) return fail(BOOKING_ERRORS[res.error], { code: [res.error] });
  if (v.timezone) {
    await db.update(contacts).set({ timezone: v.timezone }).where(and(eq(contacts.id, res.contact.id), isNull(contacts.timezone)));
  }
  kickJobs();
  revalidatePath("/meetings");
  revalidatePath("/scheduling");
  return ok(
    confirmationFor(res.event, res.attendee.manageToken, res.hostName, {
      confirmationMessage: page.confirmationMessage,
      redirectUrl: page.redirectUrl,
    }),
  );
}

// ---------------------------------------------------------------------------
// Reschedule (from /m/[token]/reschedule)
// ---------------------------------------------------------------------------

const tokenSchema = z.string().trim().min(8).max(100);

export async function getRescheduleSlotsAction(input: { token: string; from: string; to: string }): Promise<ActionResult<{ slots: string[] }>> {
  const parsed = z.object({ token: tokenSchema, from: isoSchema, to: isoSchema }).safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const range = parseRange(parsed.data.from, parsed.data.to);
  if (!range) return fail("Invalid date range");
  const lookup = await getRescheduleContext(parsed.data.token);
  if (!lookup.ok) return fail("This meeting can no longer be rescheduled.");
  const slots = await getAvailableSlots(lookup.ctx.page, { from: range.from, to: range.to, excludeEventId: lookup.ctx.event.id });
  return ok({ slots: slots.map((s) => s.start) });
}

export async function rescheduleAction(input: { token: string; start: string; timezone?: string }): Promise<ActionResult<BookingConfirmation>> {
  const parsed = z.object({ token: tokenSchema, start: isoSchema, timezone: tzSchema.optional() }).safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const res = await rescheduleMeeting({ token: parsed.data.token, start: new Date(parsed.data.start) });
  if (!res.ok) {
    if (res.error === "unavailable") return fail("This meeting can no longer be rescheduled.");
    return fail(BOOKING_ERRORS[res.error === "no_host" ? "no_host" : "slot_unavailable"], { code: [res.error] });
  }
  kickJobs();
  revalidatePath("/meetings");
  return ok(confirmationFor(res.event, res.attendee.manageToken, res.hostName, { confirmationMessage: null, redirectUrl: null }));
}
