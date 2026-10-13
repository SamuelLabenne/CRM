// Server-side data loaders for the contact detail page.
import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { activities, users } from "@/lib/db/schema";
import type { ActivityDTO } from "@/lib/contacts/dto";

export const ACTIVITY_PAGE = 100;

export async function listActivities(contactId: string, opts: { before?: Date; limit?: number } = {}): Promise<ActivityDTO[]> {
  const rows = await db
    .select({ a: activities, actorName: users.name })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.actorId))
    .where(and(eq(activities.contactId, contactId), opts.before ? lt(activities.createdAt, opts.before) : undefined))
    .orderBy(desc(activities.createdAt), desc(activities.id))
    .limit(opts.limit ?? ACTIVITY_PAGE);
  return rows.map(({ a, actorName }) => toActivityDTO(a, actorName));
}

export function toActivityDTO(a: typeof activities.$inferSelect, actorName: string | null): ActivityDTO {
  return {
    id: a.id,
    type: a.type,
    title: a.title,
    body: a.body,
    meta: a.meta ?? {},
    actorName,
    eventId: a.eventId,
    createdAt: a.createdAt.toISOString(),
  };
}
