"use server";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { contacts, events, notifications, tags, users } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { contactSearchWhere } from "@/lib/contacts/filters";
import { fullName } from "@/lib/format";
import { ilike } from "drizzle-orm";

/** Shared lookups for pickers & the command menu. */
export async function searchContactsAction(q: string, limit = 8) {
  await requireUser();
  const rows = await db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      company: contacts.company,
    })
    .from(contacts)
    .where(contactSearchWhere(q))
    .orderBy(desc(contacts.lastActivityAt))
    .limit(Math.min(limit, 50));
  return rows.map((r) => ({ ...r, name: fullName(r) }));
}

export async function searchEventsAction(q: string, limit = 8) {
  await requireUser();
  return db
    .select({ id: events.id, title: events.title, startsAt: events.startsAt, kind: events.kind })
    .from(events)
    .where(q.trim() ? ilike(events.title, `%${q.trim()}%`) : undefined)
    .orderBy(desc(events.startsAt))
    .limit(Math.min(limit, 50));
}

export async function listTagsAction() {
  await requireUser();
  return db.select().from(tags).orderBy(tags.name);
}

export async function listUsersAction() {
  await requireUser();
  return db
    .select({ id: users.id, name: users.name, email: users.email, color: users.color, role: users.role })
    .from(users)
    .where(isNull(users.deactivatedAt))
    .orderBy(users.name);
}

export async function markNotificationsReadAction(ids?: string[]) {
  const user = await requireUser();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, user.id),
        isNull(notifications.readAt),
        ids?.length ? inArray(notifications.id, ids) : undefined,
      ),
    );
  revalidatePath("/", "layout");
}
