// Create / update / tag / delete a single contact with the same side effects everywhere
// (timeline activity, stage-change automations, webhooks, duplicate protection).
import { and, eq, inArray, ne, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { contactTags, contacts, type Contact } from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { emitWebhook } from "@/lib/webhooks";
import {
  addTagToContact,
  changeStage,
  ensureTag,
  normalizeEmail,
  normalizePhone,
  publicContact,
  removeTagFromContact,
  upsertContact,
  type UpsertContactInput,
} from "@/lib/contacts";

/** Thrown when another contact already uses the same email / phone. */
export class ContactConflictError extends Error {
  constructor(
    public field: "email" | "phone",
    public existingId: string,
  ) {
    super(field === "email" ? "A contact with this email already exists." : "A contact with this phone number already exists.");
  }
}

/** Thrown for invalid user input (shown to the user as-is). */
export class ContactValidationError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

export async function findDuplicate(
  email: string | null,
  phone: string | null,
  excludeId?: string,
): Promise<{ field: "email" | "phone"; id: string } | null> {
  const conds = [];
  if (email) conds.push(eq(contacts.email, email));
  if (phone) conds.push(eq(contacts.phone, phone));
  if (!conds.length) return null;
  const rows = await db
    .select({ id: contacts.id, email: contacts.email })
    .from(contacts)
    .where(and(or(...conds), excludeId ? ne(contacts.id, excludeId) : undefined))
    .limit(2);
  if (!rows.length) return null;
  const byEmail = email ? rows.find((r) => r.email === email) : undefined;
  return byEmail ? { field: "email", id: byEmail.id } : { field: "phone", id: rows[0].id };
}

const blank = (v: string | null | undefined) => (v == null || v.trim() === "" ? null : v.trim());

/** Resolve tag names to ids, creating missing tags. */
export async function resolveTagNames(names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const tag = await ensureTag(name.slice(0, 60));
    if (tag && !ids.includes(tag.id)) ids.push(tag.id);
  }
  return ids;
}

export type CreateContactInput = Omit<UpsertContactInput, "tagIds"> & { tagNames?: string[] };

/** Create a contact from the UI. Refuses (instead of silently merging) when the email/phone already exists. */
export async function createContact(input: CreateContactInput, opts: { actorId?: string | null }) {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  if (input.email?.trim() && !email) throw new ContactValidationError("Enter a valid email address.", "email");
  if (input.phone?.trim() && !phone) throw new ContactValidationError("Enter a valid phone number.", "phone");
  if (!email && !phone && !blank(input.firstName) && !blank(input.lastName)) {
    throw new ContactValidationError("A contact needs at least a name, email or phone.");
  }
  const dup = await findDuplicate(email, phone);
  if (dup) throw new ContactConflictError(dup.field, dup.id);
  const tagIds = await resolveTagNames(input.tagNames ?? []);
  const { tagNames: _ignored, ...rest } = input;
  void _ignored;
  const { contact } = await upsertContact({ ...rest, tagIds }, { source: "manual", actorId: opts.actorId ?? null });
  return contact;
}

export type ContactPatch = Partial<{
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  website: string | null;
  city: string | null;
  country: string | null;
  timezone: string | null;
  stage: string;
  ownerId: string | null;
  dealValue: number | null;
  notes: string | null;
  /** Merged into the existing custom fields; a null value removes the key. */
  customFields: Record<string, unknown>;
}>;

const FIELD_LABELS: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  company: "Company",
  jobTitle: "Job title",
  website: "Website",
  city: "City",
  country: "Country",
  timezone: "Timezone",
  ownerId: "Owner",
  dealValue: "Deal value",
  notes: "Notes",
  customFields: "Custom fields",
};

/**
 * Edit a contact. Stage changes go through `changeStage` (activity + automations); everything else
 * is a plain update logged as one `contact_updated` activity listing the changed fields.
 */
export async function updateContact(
  id: string,
  patch: ContactPatch,
  opts: { actorId?: string | null } = {},
): Promise<{ contact: Contact; changed: string[] } | null> {
  const [existing] = await db.select().from(contacts).where(eq(contacts.id, id));
  if (!existing) return null;

  const set: Partial<Contact> = {};
  const changed: string[] = [];
  const textKeys = ["firstName", "lastName", "company", "jobTitle", "website", "city", "country", "timezone", "notes"] as const;
  for (const k of textKeys) {
    if (patch[k] === undefined) continue;
    const next = blank(patch[k]);
    if (next !== (existing[k] ?? null)) {
      set[k] = next;
      changed.push(k);
    }
  }

  if (patch.email !== undefined) {
    const email = normalizeEmail(patch.email);
    if (blank(patch.email) && !email) {
      // Clearing the email
    } else if (!email) throw new ContactValidationError("Enter a valid email address.", "email");
    if (email !== existing.email) {
      set.email = email;
      changed.push("email");
    }
  }
  if (patch.phone !== undefined) {
    const phone = normalizePhone(patch.phone);
    if (blank(patch.phone) && !phone) {
      // Clearing the phone
    } else if (!phone) throw new ContactValidationError("Enter a valid phone number.", "phone");
    if (phone !== existing.phone) {
      set.phone = phone;
      changed.push("phone");
    }
  }
  if (patch.ownerId !== undefined && (patch.ownerId ?? null) !== existing.ownerId) {
    set.ownerId = patch.ownerId ?? null;
    changed.push("ownerId");
  }
  if (patch.dealValue !== undefined && (patch.dealValue ?? null) !== existing.dealValue) {
    set.dealValue = patch.dealValue ?? null;
    changed.push("dealValue");
  }
  if (patch.customFields) {
    const merged: Record<string, unknown> = { ...existing.customFields };
    for (const [k, v] of Object.entries(patch.customFields)) {
      if (v == null || v === "" || (Array.isArray(v) && !v.length)) delete merged[k];
      else merged[k] = v;
    }
    if (JSON.stringify(merged) !== JSON.stringify(existing.customFields)) {
      set.customFields = merged;
      changed.push("customFields");
    }
  }

  // A contact must stay identifiable.
  const after = { ...existing, ...set };
  if (!after.email && !after.phone && !after.firstName && !after.lastName) {
    throw new ContactValidationError("A contact needs at least a name, email or phone.");
  }
  if (set.email || set.phone) {
    const dup = await findDuplicate(set.email ?? null, set.phone ?? null, id);
    if (dup) throw new ContactConflictError(dup.field, dup.id);
  }

  let contact = existing;
  if (Object.keys(set).length) {
    [contact] = await db.update(contacts).set(set).where(eq(contacts.id, id)).returning();
    await logActivity({
      contactId: id,
      type: "contact_updated",
      title: `Updated ${changed.map((c) => FIELD_LABELS[c] ?? c).join(", ").toLowerCase()}`,
      actorId: opts.actorId ?? null,
      meta: { fields: changed },
    });
    await emitWebhook("contact.updated", { contact: publicContact(contact), changed });
  }

  if (patch.stage && patch.stage !== existing.stage) {
    if (await changeStage(id, patch.stage, { actorId: opts.actorId })) {
      changed.push("stage");
      [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
    }
  }
  return { contact, changed };
}

/** Make a contact's tags exactly `names` (created on the fly). Returns the final tag ids. */
export async function setContactTags(contactId: string, names: string[], opts: { actorId?: string | null } = {}) {
  const wanted = await resolveTagNames(names);
  const current = (await db.select({ tagId: contactTags.tagId }).from(contactTags).where(eq(contactTags.contactId, contactId))).map((r) => r.tagId);
  for (const tagId of wanted.filter((t) => !current.includes(t))) await addTagToContact(contactId, tagId, { actorId: opts.actorId });
  for (const tagId of current.filter((t) => !wanted.includes(t))) await removeTagFromContact(contactId, tagId, { actorId: opts.actorId });
  return wanted;
}

export async function deleteContacts(ids: string[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = await db.delete(contacts).where(inArray(contacts.id, chunk)).returning({ id: contacts.id });
    n += rows.length;
  }
  return n;
}
