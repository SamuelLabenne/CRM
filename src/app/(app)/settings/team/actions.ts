"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, zodFail, type ActionResult } from "@/lib/action";
import { db } from "@/lib/db";
import { invites } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { TeamError, changeUserRole, createInvite, emailInvite, revokeInvite, setUserActive } from "@/lib/team";
import { uuid } from "../_lib/schemas";

const role = z.enum(["owner", "admin", "member"]);

async function guard<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof TeamError) return fail(err.message);
    console.error("[settings/team]", err);
    return fail("Something went wrong. Please try again.");
  }
}

export async function changeRoleAction(input: { userId: string; role: "owner" | "admin" | "member" }): Promise<ActionResult> {
  const actor = await requireAdmin();
  const parsed = z.object({ userId: uuid, role }).safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  return guard(async () => {
    await changeUserRole(actor, parsed.data.userId, parsed.data.role);
    revalidatePath("/settings/team");
    return ok(undefined, "Role updated");
  });
}

export async function setActiveAction(input: { userId: string; active: boolean }): Promise<ActionResult> {
  const actor = await requireAdmin();
  const parsed = z.object({ userId: uuid, active: z.boolean() }).safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  return guard(async () => {
    await setUserActive(actor, parsed.data.userId, parsed.data.active);
    revalidatePath("/settings/team");
    return ok(undefined, parsed.data.active ? "User reactivated" : "User deactivated and signed out");
  });
}

export type InviteResult = {
  email: string;
  url: string;
  /** What happened to the invitation email. */
  emailStatus: "sent" | "simulated" | "failed" | "skipped";
  emailError?: string;
};

async function issueInvite(actor: Awaited<ReturnType<typeof requireAdmin>>, email: string, inviteRole: "owner" | "admin" | "member"): Promise<ActionResult<InviteResult>> {
  const { invite, url } = await createInvite({ actor, email, role: inviteRole });
  const res = await emailInvite({ to: invite.email, url, role: invite.role, inviterName: actor.name });
  revalidatePath("/settings/team");
  return ok(
    {
      email: invite.email,
      url,
      emailStatus: res.status,
      emailError: res.status === "failed" ? res.error : res.status === "skipped" ? res.reason : undefined,
    },
    "",
  );
}

export async function inviteAction(input: { email: string; role: "owner" | "admin" | "member" }): Promise<ActionResult<InviteResult>> {
  const actor = await requireAdmin();
  const parsed = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email address"), role }).safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  return guard(() => issueInvite(actor, parsed.data.email, parsed.data.role));
}

/** Creates a fresh link for a pending invite (the old link stops working) and emails it again. */
export async function resendInviteAction(inviteId: string): Promise<ActionResult<InviteResult>> {
  const actor = await requireAdmin();
  const parsed = uuid.safeParse(inviteId);
  if (!parsed.success) return fail("Invalid invitation");
  return guard(async () => {
    const [invite] = await db.select().from(invites).where(eq(invites.id, parsed.data));
    if (!invite || invite.acceptedAt) return fail("This invitation no longer exists.");
    return issueInvite(actor, invite.email, invite.role);
  });
}

export async function revokeInviteAction(inviteId: string): Promise<ActionResult> {
  const actor = await requireAdmin();
  const parsed = uuid.safeParse(inviteId);
  if (!parsed.success) return fail("Invalid invitation");
  return guard(async () => {
    await revokeInvite(actor, parsed.data);
    revalidatePath("/settings/team");
    return ok(undefined, "Invitation revoked");
  });
}
