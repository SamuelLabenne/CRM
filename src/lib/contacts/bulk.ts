// Bulk operations on many contacts at once (contacts list → bulk action bar).
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, users } from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { addTagToContact, changeStage, removeTagFromContact } from "@/lib/contacts";
import { deleteContacts, resolveTagNames } from "@/lib/contacts/update";
import { EventFullError, registerForEvent } from "@/lib/events/registration";

export async function bulkAddTag(ids: string[], tag: { id: string } | { name: string }, actorId?: string | null) {
  const tagId = "id" in tag ? tag.id : (await resolveTagNames([tag.name]))[0];
  if (!tagId) return { affected: 0, tagId: null };
  let affected = 0;
  for (const id of ids) if (await addTagToContact(id, tagId, { actorId })) affected++;
  return { affected, tagId };
}

export async function bulkRemoveTag(ids: string[], tagId: string, actorId?: string | null) {
  let affected = 0;
  for (const id of ids) if (await removeTagFromContact(id, tagId, { actorId })) affected++;
  return { affected };
}

export async function bulkChangeStage(ids: string[], stage: string, actorId?: string | null) {
  let affected = 0;
  for (const id of ids) if (await changeStage(id, stage, { actorId })) affected++;
  return { affected };
}

/** Assign (or clear, with null) the owner of many contacts. */
export async function bulkAssignOwner(ids: string[], ownerId: string | null, actorId?: string | null) {
  let ownerName = "nobody";
  if (ownerId) {
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, ownerId));
    if (!u) throw new Error("User not found");
    ownerName = u.name;
  }
  let affected = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const before = await db.select({ id: contacts.id, ownerId: contacts.ownerId }).from(contacts).where(inArray(contacts.id, chunk));
    const changing = before.filter((c) => c.ownerId !== ownerId).map((c) => c.id);
    if (!changing.length) continue;
    await db.update(contacts).set({ ownerId }).where(inArray(contacts.id, changing));
    for (const id of changing) {
      await logActivity({
        contactId: id,
        type: "contact_updated",
        title: ownerId ? `Owner set to ${ownerName}` : "Owner cleared",
        actorId,
        meta: { fields: ["ownerId"], ownerId },
      });
    }
    affected += changing.length;
  }
  return { affected };
}

export type BulkRegisterResult = {
  registered: number;
  waitlisted: number;
  alreadyRegistered: number;
  /** Not registered because the event is full (and has no waitlist). */
  full: number;
  failed: number;
};

/** Register many contacts for an event (source "manual"). Stops early once the event is full without a waitlist. */
export async function bulkAddToEvent(
  ids: string[],
  eventId: string,
  opts: { actorId?: string | null; silent?: boolean } = {},
): Promise<BulkRegisterResult> {
  const res: BulkRegisterResult = { registered: 0, waitlisted: 0, alreadyRegistered: 0, full: 0, failed: 0 };
  for (let i = 0; i < ids.length; i++) {
    try {
      const r = await registerForEvent({ eventId, contactId: ids[i], source: "manual", actorId: opts.actorId, silent: opts.silent });
      if (!r.created) res.alreadyRegistered++;
      else if (r.waitlisted) res.waitlisted++;
      else res.registered++;
    } catch (err) {
      if (err instanceof EventFullError) {
        res.full += ids.length - i;
        break;
      }
      res.failed++;
    }
  }
  return res;
}

export async function bulkDelete(ids: string[]) {
  return { affected: await deleteContacts(ids) };
}
