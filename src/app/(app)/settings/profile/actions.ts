"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { sha256 } from "@/lib/crypto";
import { fail, ok, zodFail, type ActionResult } from "@/lib/action";
import { calendarFeedUrl, regenerateCalendarToken } from "@/lib/team";
import type { DateOverride, WeeklyAvailability } from "@/lib/types";
import { hexColor, isValidTimezone } from "../_lib/schemas";
import { AvailabilityError, normalizeAvailability, normalizeOverrides } from "../_lib/availability";

const profileSchema = z.object({
  name: z.string().trim().min(1, "Your name is required").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  title: z.string().trim().max(80).optional().default(""),
  // "" = use the workspace timezone
  timezone: z.string().trim().refine((v) => v === "" || isValidTimezone(v), "Choose a valid timezone"),
  color: hexColor,
});

export async function saveProfileAction(input: z.input<typeof profileSchema>): Promise<ActionResult> {
  const me = await requireUser();
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const d = parsed.data;
  const [clash] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, d.email), ne(users.id, me.id)));
  if (clash) return fail("Another account already uses this email.", { email: ["Another account already uses this email"] });
  try {
    await db
      .update(users)
      .set({ name: d.name, email: d.email, title: d.title || null, timezone: d.timezone || null, color: d.color.toLowerCase() })
      .where(eq(users.id, me.id));
  } catch (err) {
    console.error("[settings] profile save failed", err);
    return fail("Could not save your profile. Please try again.");
  }
  revalidatePath("/", "layout");
  return ok(undefined, "Profile saved");
}

const passwordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password"),
    next: z.string().min(8, "Use at least 8 characters").max(200),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { path: ["confirm"], message: "The passwords don't match" });

export async function changePasswordAction(input: z.input<typeof passwordSchema>): Promise<ActionResult> {
  const me = await requireUser();
  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const { current, next } = parsed.data;
  if (!(await verifyPassword(current, me.passwordHash))) {
    return fail("Your current password is incorrect.", { current: ["Incorrect password"] });
  }
  if (current === next) return fail("Choose a different password.", { next: ["Choose a different password"] });
  await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, me.id));
  // Sign out every other device; keep this one.
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  await db
    .delete(sessions)
    .where(token ? and(eq(sessions.userId, me.id), ne(sessions.id, sha256(token))) : eq(sessions.userId, me.id));
  return ok(undefined, "Password updated. Other devices were signed out.");
}

const rangeSchema = z.object({ start: z.string(), end: z.string() });
const availabilitySchema = z.object({
  /** null = use the default Mon–Fri 09:00–17:00 */
  availability: z.record(z.enum(["0", "1", "2", "3", "4", "5", "6"]), z.array(rangeSchema)).nullable(),
  dateOverrides: z.array(z.object({ date: z.string(), slots: z.array(rangeSchema) })).max(400),
});

export async function saveAvailabilityAction(input: {
  availability: WeeklyAvailability | null;
  dateOverrides: DateOverride[];
}): Promise<ActionResult<{ dateOverrides: DateOverride[] }>> {
  const me = await requireUser();
  const parsed = availabilitySchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  try {
    const availability = parsed.data.availability ? normalizeAvailability(parsed.data.availability) : null;
    const dateOverrides = normalizeOverrides(parsed.data.dateOverrides);
    await db.update(users).set({ availability, dateOverrides }).where(eq(users.id, me.id));
    revalidatePath("/settings/profile");
    return ok({ dateOverrides }, "Availability saved");
  } catch (err) {
    if (err instanceof AvailabilityError) return fail(err.message);
    throw err;
  }
}

export async function regenerateCalendarFeedAction(): Promise<ActionResult<{ url: string }>> {
  const me = await requireUser();
  const token = await regenerateCalendarToken(me.id);
  return ok({ url: calendarFeedUrl(token) }, "New calendar link created. The old link no longer works.");
}
