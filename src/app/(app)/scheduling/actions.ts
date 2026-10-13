"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { bookingPages } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { fail, ok, zodFail, type ActionResult } from "@/lib/action";
import { DEFAULT_PAGE_NOTIFICATIONS } from "@/lib/scheduling/defaults";
import { uniqueSlug } from "@/lib/scheduling/pages";
import { bookingPageInputSchema, pruneRules, SLUG_RE } from "@/lib/scheduling/schema";
import { getAvailableSlots, groupSlotsByDate, resolveTimezone } from "@/lib/scheduling/slots";
import { getSetting } from "@/lib/settings";

const createSchema = z.object({
  title: z.string().trim().min(1, "Give the page a title").max(120),
  description: z.string().trim().max(4000).optional(),
  durationMinutes: z.number().int().min(5).max(480),
  locationType: z.enum(["online", "in_person", "phone"]),
  hostIds: z.array(z.string().uuid()).min(1, "Choose at least one host").max(50),
});

export async function createBookingPageAction(input: z.input<typeof createSchema>): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const v = parsed.data;
  const slug = await uniqueSlug(v.title);
  const [row] = await db
    .insert(bookingPages)
    .values({
      slug,
      title: v.title,
      description: v.description || null,
      durationMinutes: v.durationMinutes,
      locationType: v.locationType,
      hostIds: v.hostIds,
      notifications: DEFAULT_PAGE_NOTIFICATIONS,
      createdById: user.id,
      isActive: true,
    })
    .returning({ id: bookingPages.id });
  revalidatePath("/scheduling");
  return ok({ id: row.id }, "Booking page created");
}

export async function updateBookingPageAction(id: string, input: z.input<typeof bookingPageInputSchema>): Promise<ActionResult<{ slug: string }>> {
  await requireUser();
  const parsed = bookingPageInputSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const v = parsed.data;
  const [current] = await db.select({ id: bookingPages.id }).from(bookingPages).where(eq(bookingPages.id, id));
  if (!current) return fail("This booking page no longer exists.");
  if (!SLUG_RE.test(v.slug)) return fail("Use lowercase letters, numbers and dashes only", { slug: ["Use lowercase letters, numbers and dashes only"] });
  const free = await uniqueSlug(v.slug, id);
  if (free !== v.slug) return fail("That link is already used by another booking page.", { slug: ["That link is already used by another booking page."] });

  await db
    .update(bookingPages)
    .set({
      slug: v.slug,
      title: v.title,
      description: v.description,
      durationMinutes: v.durationMinutes,
      locationType: v.locationType,
      location: v.location,
      meetingUrl: v.meetingUrl,
      hostIds: v.hostIds,
      bufferBeforeMinutes: v.bufferBeforeMinutes,
      bufferAfterMinutes: v.bufferAfterMinutes,
      minNoticeMinutes: v.minNoticeMinutes,
      maxDaysAhead: v.maxDaysAhead,
      slotIncrementMinutes: v.slotIncrementMinutes,
      dailyLimit: v.dailyLimit,
      questions: v.questions.map((q) => ({
        ...q,
        options: q.type === "select" || q.type === "multiselect" ? (q.options ?? []) : undefined,
        mapTo: q.mapTo || null,
      })),
      disqualifyRules: pruneRules(v.disqualifyRules, v.questions.map((q) => q.id)),
      disqualifyMessage: v.disqualifyMessage,
      disqualifyRedirectUrl: v.disqualifyRedirectUrl,
      confirmationMessage: v.confirmationMessage,
      redirectUrl: v.redirectUrl,
      notifications: {
        ...v.notifications,
        confirmation: { ...v.notifications.confirmation, templateId: v.notifications.confirmation.templateId ?? null },
        cancellation: { ...v.notifications.cancellation, templateId: v.notifications.cancellation.templateId ?? null },
        reminders: v.notifications.reminders.map((r) => ({ ...r, templateId: r.templateId ?? null })),
        followUps: v.notifications.followUps.map((f) => ({ ...f, templateId: f.templateId ?? null })),
      },
      campaignId: v.campaignId,
      color: v.color,
      isActive: v.isActive,
    })
    .where(eq(bookingPages.id, id));
  revalidatePath("/scheduling");
  revalidatePath(`/scheduling/${id}`);
  revalidatePath(`/book/${v.slug}`);
  return ok({ slug: v.slug }, "Booking page saved");
}

export async function setPageActiveAction(id: string, isActive: boolean): Promise<ActionResult> {
  await requireUser();
  const [page] = await db.select({ slug: bookingPages.slug, hostIds: bookingPages.hostIds }).from(bookingPages).where(eq(bookingPages.id, id));
  if (!page) return fail("This booking page no longer exists.");
  if (isActive && !page.hostIds.length) return fail("Add at least one host before activating this page.");
  await db.update(bookingPages).set({ isActive }).where(eq(bookingPages.id, id));
  revalidatePath("/scheduling");
  revalidatePath(`/scheduling/${id}`);
  revalidatePath(`/book/${page.slug}`);
  return ok(undefined, isActive ? "Booking page is live" : "Booking page paused");
}

export async function duplicateBookingPageAction(id: string): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const [page] = await db.select().from(bookingPages).where(eq(bookingPages.id, id));
  if (!page) return fail("This booking page no longer exists.");
  const slug = await uniqueSlug(`${page.slug}-copy`);
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = page;
  void _id;
  void _c;
  void _u;
  const [row] = await db
    .insert(bookingPages)
    .values({ ...rest, slug, title: `${page.title} (copy)`, isActive: false, createdById: user.id })
    .returning({ id: bookingPages.id });
  revalidatePath("/scheduling");
  return ok({ id: row.id }, "Booking page duplicated (paused)");
}

export async function deleteBookingPageAction(id: string): Promise<ActionResult> {
  await requireUser();
  const [page] = await db.select({ slug: bookingPages.slug }).from(bookingPages).where(eq(bookingPages.id, id));
  if (!page) return ok();
  await db.delete(bookingPages).where(eq(bookingPages.id, id));
  revalidatePath("/scheduling");
  revalidatePath(`/book/${page.slug}`);
  return ok(undefined, "Booking page deleted");
}

/** Next available days for the Availability tab preview (uses the saved settings). */
export async function previewAvailabilityAction(id: string): Promise<ActionResult<{ days: { date: string; times: string[] }[]; timezone: string }>> {
  await requireUser();
  const [page] = await db.select().from(bookingPages).where(eq(bookingPages.id, id));
  if (!page) return fail("This booking page no longer exists.");
  const ws = await getSetting("workspace");
  const tz = resolveTimezone(ws.timezone);
  const slots = await getAvailableSlots(page, {});
  const grouped = groupSlotsByDate(slots.map((s) => s.start), tz);
  const days = Object.entries(grouped)
    .slice(0, 5)
    .map(([date, times]) => ({ date, times }));
  return ok({ days, timezone: tz });
}
