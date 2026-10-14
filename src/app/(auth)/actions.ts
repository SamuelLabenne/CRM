"use server";

import { redirect } from "next/navigation";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { invites, users } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession } from "@/lib/auth/session";
import { needsSetup, ensureSystemData } from "@/lib/system";
import { setSetting } from "@/lib/settings";
import { loadSampleData } from "@/lib/sample-data";
import { fail, zodFail, type ActionResult } from "@/lib/action";
import { safeEqual, sha256 } from "@/lib/crypto";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
  next: z.string().optional(),
});

export async function loginAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return zodFail(parsed.error);
  const { email, password, next } = parsed.data;
  const [user] = await db.select().from(users).where(eq(users.email, email));
  const valid = user && !user.deactivatedAt && (await verifyPassword(password, user.passwordHash));
  if (!valid) {
    await new Promise((r) => setTimeout(r, 400));
    return fail("Incorrect email or password.");
  }
  await createSession(user.id);
  redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

const setupSchema = z.object({
  workspaceName: z.string().trim().min(1, "Workspace name is required").max(80),
  name: z.string().trim().min(1, "Your name is required").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters"),
  timezone: z.string().min(1).default("UTC"),
  setupCode: z.string().optional(),
  sampleData: z.string().optional(),
});

export async function setupAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  if (!(await needsSetup())) return fail("This workspace is already set up. Please sign in.");
  const parsed = setupSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return zodFail(parsed.error);
  const d = parsed.data;
  const requiredCode = process.env.SETUP_CODE;
  if (requiredCode && !safeEqual((d.setupCode ?? "").trim(), requiredCode)) {
    return fail("The setup code is incorrect.", { setupCode: ["Incorrect setup code"] });
  }
  let tz = d.timezone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  const [user] = await db
    .insert(users)
    .values({ email: d.email, name: d.name, passwordHash: await hashPassword(d.password), role: "owner", timezone: tz })
    .returning();
  await setSetting("workspace", { name: d.workspaceName, timezone: tz });
  // Send from the verified domain when one is configured (EMAIL_FROM); replies always go to the owner.
  await setSetting("email", { fromName: d.workspaceName, fromEmail: process.env.EMAIL_FROM || d.email, replyTo: d.email });
  await ensureSystemData();
  if (d.sampleData === "on") {
    try {
      await loadSampleData(user.id);
    } catch (err) {
      console.error("[setup] sample data failed", err);
    }
  }
  await createSession(user.id);
  redirect("/dashboard?welcome=1");
}

const acceptSchema = z.object({
  token: z.string().min(10),
  name: z.string().trim().min(1, "Your name is required"),
  password: z.string().min(8, "Use at least 8 characters"),
});

export async function acceptInviteAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = acceptSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return zodFail(parsed.error);
  const { token, name, password } = parsed.data;
  const [invite] = await db
    .select()
    .from(invites)
    .where(and(eq(invites.tokenHash, sha256(token)), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())));
  if (!invite) return fail("This invitation is invalid or has expired.");
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, invite.email));
  if (exists) return fail("An account with this email already exists. Please sign in.");
  const [user] = await db
    .insert(users)
    .values({ email: invite.email, name, passwordHash: await hashPassword(password), role: invite.role })
    .returning();
  await db.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, invite.id));
  await createSession(user.id);
  redirect("/dashboard");
}
