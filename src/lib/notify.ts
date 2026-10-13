import { inArray, isNull, or, eq } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";
import { notifications, users } from "@/lib/db/schema";

export type NotifyInput = {
  /** Specific users, or "admins" (owner+admin) or "all" active users. */
  to: string[] | "admins" | "all";
  type: string;
  title: string;
  body?: string | null;
  href?: string | null;
};

/** Create in-app notifications (bell icon). */
export async function notifyUsers(input: NotifyInput, tx: Tx = db) {
  let userIds: string[];
  if (Array.isArray(input.to)) {
    userIds = input.to;
  } else {
    const rows = await tx
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(
        input.to === "admins"
          ? (or(eq(users.role, "owner"), eq(users.role, "admin")) as ReturnType<typeof eq>)
          : isNull(users.deactivatedAt),
      );
    userIds = rows.map((r) => r.id);
  }
  userIds = [...new Set(userIds.filter(Boolean))];
  if (!userIds.length) return;
  const existing = await tx.select({ id: users.id }).from(users).where(inArray(users.id, userIds));
  if (!existing.length) return;
  await tx.insert(notifications).values(
    existing.map((u) => ({
      userId: u.id,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
    })),
  );
}
