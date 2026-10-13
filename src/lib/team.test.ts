import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb, createTestUser } from "@/test/setup-db";

const { db } = await setupTestDb();
const { users, sessions, invites, messages } = await import("@/lib/db/schema");
const team = await import("./team");
const { sha256 } = await import("@/lib/crypto");

async function newSession(userId: string) {
  await db.insert(sessions).values({ id: `s-${Math.random()}`, userId, expiresAt: new Date(Date.now() + 864e5) });
}

describe("team rules", () => {
  it("only owners can grant or revoke the owner role", async () => {
    const owner = await createTestUser({ role: "owner" });
    const admin = await createTestUser({ role: "admin" });
    const member = await createTestUser({ role: "member" });
    await expect(team.changeUserRole(admin, member.id, "owner")).rejects.toThrow(/owner/i);
    await expect(team.changeUserRole(admin, owner.id, "admin")).rejects.toThrow(/owner/i);
    await team.changeUserRole(owner, member.id, "owner");
    const [m] = await db.select().from(users).where(eq(users.id, member.id));
    expect(m.role).toBe("owner");
    // admins can still manage non-owner roles
    const other = await createTestUser({ role: "member" });
    await team.changeUserRole(admin, other.id, "admin");
    const [o] = await db.select().from(users).where(eq(users.id, other.id));
    expect(o.role).toBe("admin");
  });

  it("members can't manage the team", async () => {
    const member = await createTestUser({ role: "member" });
    const other = await createTestUser({ role: "member" });
    await expect(team.changeUserRole(member, other.id, "admin")).rejects.toThrow();
    await expect(team.setUserActive(member, other.id, false)).rejects.toThrow();
    await expect(team.createInvite({ actor: member, email: "x@y.io", role: "member" })).rejects.toThrow();
  });

  it("protects the last owner from demotion and deactivation", async () => {
    // A fresh DB per file: remove every other owner so exactly one remains.
    await db.delete(users);
    const owner = await createTestUser({ role: "owner" });
    const admin = await createTestUser({ role: "admin" });
    await expect(team.changeUserRole(owner, owner.id, "admin")).rejects.toThrow(/at least one owner/i);
    await expect(team.setUserActive(owner, owner.id, false)).rejects.toThrow(/own account/i);

    // A second owner makes it possible; then the last-owner rule applies to the remaining one.
    await team.changeUserRole(owner, admin.id, "owner");
    await team.changeUserRole(owner, owner.id, "admin");
    const second = { id: admin.id, role: "owner" as const };
    await expect(team.changeUserRole(second, admin.id, "member")).rejects.toThrow(/at least one owner/i);
    const first = { id: owner.id, role: "admin" as const };
    await expect(team.setUserActive(first, admin.id, false)).rejects.toThrow(/owner/i);
    expect(await team.countActiveOwners()).toBe(1);
  });

  it("deactivating a user ends their sessions; reactivating restores access", async () => {
    const owner = await createTestUser({ role: "owner" });
    const member = await createTestUser({ role: "member" });
    await newSession(member.id);
    await newSession(member.id);
    await team.setUserActive(owner, member.id, false);
    const [m] = await db.select().from(users).where(eq(users.id, member.id));
    expect(m.deactivatedAt).toBeTruthy();
    expect(await db.select().from(sessions).where(eq(sessions.userId, member.id))).toHaveLength(0);
    await team.setUserActive(owner, member.id, true);
    const [m2] = await db.select().from(users).where(eq(users.id, member.id));
    expect(m2.deactivatedAt).toBeNull();
  });

  it("an admin can't deactivate an owner; deactivated owners don't count", async () => {
    const owner = await createTestUser({ role: "owner" });
    const owner2 = await createTestUser({ role: "owner" });
    const admin = await createTestUser({ role: "admin" });
    await expect(team.setUserActive(admin, owner.id, false)).rejects.toThrow(/owner/i);
    const before = await team.countActiveOwners();
    await team.setUserActive(owner, owner2.id, false);
    expect(await team.countActiveOwners()).toBe(before - 1);
  });
});

describe("invitations", () => {
  it("creates a 7-day invite whose token hash matches the accept-page lookup", async () => {
    const owner = await createTestUser({ role: "owner" });
    const { invite, token, url } = await team.createInvite({ actor: owner, email: "  New.Person@Example.com ", role: "member" });
    expect(invite.email).toBe("new.person@example.com");
    expect(invite.tokenHash).toBe(sha256(token));
    expect(invite.tokenHash).not.toContain(token);
    expect(url).toMatch(new RegExp(`/invite/${token}$`));
    const days = (invite.expiresAt.getTime() - Date.now()) / 864e5;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
    expect((await team.findValidInvite(token))?.id).toBe(invite.id);
    expect(await team.findValidInvite("nope-nope-nope")).toBeNull();

    // expired invites no longer validate
    await db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invites.id, invite.id));
    expect(await team.findValidInvite(token)).toBeNull();
    const list = await team.listPendingInvites();
    expect(list.find((i) => i.id === invite.id)?.expired).toBe(true);
  });

  it("re-inviting replaces the old pending invite; revoke removes it", async () => {
    const owner = await createTestUser({ role: "owner" });
    const a = await team.createInvite({ actor: owner, email: "again@example.com", role: "member" });
    const b = await team.createInvite({ actor: owner, email: "again@example.com", role: "admin" });
    expect(await team.findValidInvite(a.token)).toBeNull();
    expect((await team.findValidInvite(b.token))?.role).toBe("admin");
    await team.revokeInvite(owner, b.invite.id);
    expect(await team.findValidInvite(b.token)).toBeNull();
  });

  it("rejects existing users, bad emails and owner invites from admins", async () => {
    const owner = await createTestUser({ role: "owner" });
    const admin = await createTestUser({ role: "admin" });
    const existing = await createTestUser({ email: "taken@example.com", role: "member" });
    await expect(team.createInvite({ actor: owner, email: existing.email, role: "member" })).rejects.toThrow(/already has an account/i);
    await expect(team.createInvite({ actor: owner, email: "not-an-email", role: "member" })).rejects.toThrow(/valid email/i);
    await expect(team.createInvite({ actor: admin, email: "boss@example.com", role: "owner" })).rejects.toThrow(/owner/i);
    await team.setUserActive(owner, existing.id, false);
    await expect(team.createInvite({ actor: owner, email: existing.email, role: "member" })).rejects.toThrow(/deactivated/i);
  });

  it("emails the invite link (simulated in outbox mode)", async () => {
    const res = await team.emailInvite({ to: "invitee@example.com", url: "http://localhost:3000/invite/abc", role: "admin", inviterName: "Sam" });
    expect(res.status).toBe("simulated");
    const [msg] = await db.select().from(messages).where(eq(messages.toEmail, "invitee@example.com"));
    expect(msg.kind).toBe("transactional");
    expect(msg.html).toContain("/invite/abc");
    expect(msg.html).toContain("an admin");
  });
});

describe("calendar token", () => {
  it("is created once and can be regenerated", async () => {
    const u = await createTestUser();
    const t1 = await team.ensureCalendarToken(u.id);
    expect(t1.length).toBeGreaterThan(20);
    expect(await team.ensureCalendarToken(u.id)).toBe(t1);
    const t2 = await team.regenerateCalendarToken(u.id);
    expect(t2).not.toBe(t1);
    expect(await team.ensureCalendarToken(u.id)).toBe(t2);
    expect(team.calendarFeedUrl(t2)).toMatch(/\/api\/ics\/feed\//);
  });
});
