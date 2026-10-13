import { eq } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";
import { activities, contacts } from "@/lib/db/schema";
import type { ActivityType } from "@/lib/types";

export type LogActivityInput = {
  contactId: string | null;
  type: ActivityType;
  title: string;
  body?: string | null;
  meta?: Record<string, unknown>;
  actorId?: string | null;
  eventId?: string | null;
};

/** Append an entry to a contact's journey timeline and bump last_activity_at. */
export async function logActivity(input: LogActivityInput, tx: Tx = db) {
  const [row] = await tx
    .insert(activities)
    .values({
      contactId: input.contactId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      meta: input.meta ?? {},
      actorId: input.actorId ?? null,
      eventId: input.eventId ?? null,
    })
    .returning();
  if (input.contactId) {
    await tx.update(contacts).set({ lastActivityAt: new Date() }).where(eq(contacts.id, input.contactId));
  }
  return row;
}
