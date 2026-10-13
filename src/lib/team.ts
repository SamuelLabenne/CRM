import { and, asc, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { invites, sessions, users, type User } from "@/lib/db/schema";
import { randomToken, sha256 } from "@/lib/crypto";
import { absoluteUrl, calendarFeedPath } from "@/lib/urls";
import { getSetting } from "@/lib/settings";
import { sendEmail, type SendEmailResult } from "@/lib/email/send";
import { escapeHtml } from "@/lib/email/merge-tags";
import type { UserRole } from "@/lib/types";

// ---------------------------------------------------------------------------
// Team management rules (roles, deactivation, invitations).
// Server actions in src/app/(app)/settings/team/actions.ts are thin wrappers.
// ---------------------------------------------------------------------------

/** Raised for expected rule violations; the message is safe to show to the user. */
export class TeamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamError";
  }
}

export const USER_ROLES: UserRole[] = ["owner", "admin", "member"];
export const INVITE_TTL_DAYS = 7;

export const ROLE_LABEL: Record<UserRole, string> = { owner: "Owner", admin: "Admin", member: "Member" };
export const ROLE_DESCRIPTION: Record<UserRole, string> = {
  owner: "Full access, including billing-level changes and other owners.",
  admin: "Manage settings, team members and all data.",
  member: "Work with contacts, events and emails. No access to settings.",
};

/** The user performing an action (only id and role matter for the rules). */
export type TeamActor = Pick<User, "id" | "role">;

export type TeamMember = Pick<
  User,
  "id" | "name" | "email" | "role" | "color" | "title" | "lastLoginAt" | "deactivatedAt" | "createdAt"
>;

const memberColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  color: users.color,
  title: users.title,
  lastLoginAt: users.lastLoginAt,
  deactivatedAt: users.deactivatedAt,
  createdAt: users.createdAt,
};

function isAdminRole(role: UserRole) {
  return role === "owner" || role === "admin";
}

function assertAdmin(actor: TeamActor) {
  if (!isAdminRole(actor.role)) throw new TeamError("Only owners and admins can manage the team.");
}

/** All users (never includes password hashes), active first. */
export async function listTeam(): Promise<TeamMember[]> {
  return db.select(memberColumns).from(users).orderBy(sql`${users.deactivatedAt} is not null`, asc(users.name));
}

/** Number of active (not deactivated) owners, optionally ignoring one user. */
export async function countActiveOwners(exceptUserId?: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(
      and(
        eq(users.role, "owner"),
        isNull(users.deactivatedAt),
        exceptUserId ? ne(users.id, exceptUserId) : undefined,
      ),
    );
  return row?.n ?? 0;
}

async function loadUser(id: string): Promise<User> {
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u) throw new TeamError("That user no longer exists.");
  return u;
}

/**
 * Change a user's role.
 * - Only owners can grant or revoke the owner role.
 * - The last active owner can never be demoted.
 */
export async function changeUserRole(actor: TeamActor, targetId: string, role: UserRole): Promise<void> {
  assertAdmin(actor);
  if (!USER_ROLES.includes(role)) throw new TeamError("Unknown role.");
  const target = await loadUser(targetId);
  if (target.role === role) return;
  if (actor.role !== "owner" && (role === "owner" || target.role === "owner")) {
    throw new TeamError("Only an owner can grant or revoke the owner role.");
  }
  if (target.role === "owner" && !target.deactivatedAt && (await countActiveOwners(target.id)) < 1) {
    throw new TeamError("Relay needs at least one owner. Make someone else an owner first.");
  }
  await db.update(users).set({ role }).where(eq(users.id, target.id));
}

/**
 * Deactivate (sign out + block sign-in) or reactivate a user.
 * You can't deactivate yourself or the last active owner; only owners can deactivate owners.
 */
export async function setUserActive(actor: TeamActor, targetId: string, active: boolean): Promise<void> {
  assertAdmin(actor);
  const target = await loadUser(targetId);
  if (active) {
    if (!target.deactivatedAt) return;
    await db.update(users).set({ deactivatedAt: null }).where(eq(users.id, target.id));
    return;
  }
  if (target.id === actor.id) throw new TeamError("You can't deactivate your own account.");
  if (target.deactivatedAt) return;
  if (target.role === "owner") {
    if (actor.role !== "owner") throw new TeamError("Only an owner can deactivate another owner.");
    if ((await countActiveOwners(target.id)) < 1) {
      throw new TeamError("You can't deactivate the last owner.");
    }
  }
  await db.update(users).set({ deactivatedAt: new Date() }).where(eq(users.id, target.id));
  await db.delete(sessions).where(eq(sessions.userId, target.id));
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export type InviteRow = {
  id: string;
  email: string;
  role: UserRole;
  expiresAt: Date;
  createdAt: Date;
  invitedByName: string | null;
  expired: boolean;
};

export function invitePath(token: string) {
  return `/invite/${token}`;
}

/** Pending (not yet accepted) invitations, newest first. Expired ones are flagged. */
export async function listPendingInvites(): Promise<InviteRow[]> {
  const rows = await db
    .select({
      id: invites.id,
      email: invites.email,
      role: invites.role,
      expiresAt: invites.expiresAt,
      createdAt: invites.createdAt,
      invitedByName: users.name,
    })
    .from(invites)
    .leftJoin(users, eq(users.id, invites.invitedById))
    .where(isNull(invites.acceptedAt))
    .orderBy(desc(invites.createdAt));
  const now = Date.now();
  return rows.map((r) => ({ ...r, expired: r.expiresAt.getTime() <= now }));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Create an invitation. The raw token is returned once (only its sha256 is stored) –
 * the caller shows the link and emails it. Re-inviting an address replaces older pending invites.
 */
export async function createInvite(input: { actor: TeamActor; email: string; role: UserRole }) {
  assertAdmin(input.actor);
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new TeamError("Enter a valid email address.");
  if (!USER_ROLES.includes(input.role)) throw new TeamError("Unknown role.");
  if (input.role === "owner" && input.actor.role !== "owner") {
    throw new TeamError("Only an owner can invite another owner.");
  }
  const [existing] = await db.select({ id: users.id, deactivatedAt: users.deactivatedAt }).from(users).where(eq(users.email, email));
  if (existing) {
    throw new TeamError(
      existing.deactivatedAt
        ? "This person already has an account that is deactivated. Reactivate it from the team list instead."
        : "Someone with this email already has an account.",
    );
  }
  const token = randomToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 864e5);
  const invite = await db.transaction(async (tx) => {
    await tx.delete(invites).where(and(eq(invites.email, email), isNull(invites.acceptedAt)));
    const [row] = await tx
      .insert(invites)
      .values({ email, role: input.role, tokenHash: sha256(token), invitedById: input.actor.id, expiresAt })
      .returning();
    return row;
  });
  return { invite, token, url: absoluteUrl(invitePath(token)) };
}

/** Look up a still-valid invite by its raw token (same rule the accept page uses). */
export async function findValidInvite(token: string) {
  const [row] = await db
    .select()
    .from(invites)
    .where(and(eq(invites.tokenHash, sha256(token)), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())));
  return row ?? null;
}

export async function revokeInvite(actor: TeamActor, inviteId: string): Promise<void> {
  assertAdmin(actor);
  await db.delete(invites).where(and(eq(invites.id, inviteId), isNull(invites.acceptedAt)));
}

/** Email the invitation link. Never throws – inspect the status. */
export async function emailInvite(input: {
  to: string;
  url: string;
  role: UserRole;
  inviterName: string;
}): Promise<SendEmailResult> {
  const ws = await getSetting("workspace");
  const name = escapeHtml(ws.name);
  const html = `<h2>You're invited to ${name}</h2>
<p>${escapeHtml(input.inviterName)} invited you to join <strong>${name}</strong> on Relay as ${input.role === "admin" ? "an" : "a"} ${ROLE_LABEL[input.role].toLowerCase()}.</p>
<p><a data-button href="${escapeHtml(input.url)}">Accept invitation</a></p>
<p>Or copy this link into your browser:<br>${escapeHtml(input.url)}</p>
<p>The link expires in ${INVITE_TTL_DAYS} days.</p>`;
  return sendEmail({
    to: input.to,
    kind: "transactional",
    marketing: false,
    subject: `You're invited to join ${ws.name}`,
    html,
  });
}

// ---------------------------------------------------------------------------
// Personal calendar feed token
// ---------------------------------------------------------------------------

/** Returns the user's calendar feed token, creating one on first use. */
export async function ensureCalendarToken(userId: string): Promise<string> {
  const [row] = await db.select({ token: users.calendarToken }).from(users).where(eq(users.id, userId));
  if (row?.token) return row.token;
  await db
    .update(users)
    .set({ calendarToken: randomToken(24) })
    .where(and(eq(users.id, userId), isNull(users.calendarToken)));
  const [again] = await db.select({ token: users.calendarToken }).from(users).where(eq(users.id, userId));
  if (!again?.token) throw new Error("Could not create a calendar token");
  return again.token;
}

/** Issue a new token; the previous feed URL stops working. */
export async function regenerateCalendarToken(userId: string): Promise<string> {
  const token = randomToken(24);
  await db.update(users).set({ calendarToken: token }).where(eq(users.id, userId));
  return token;
}

export function calendarFeedUrl(token: string) {
  return absoluteUrl(calendarFeedPath(token));
}
