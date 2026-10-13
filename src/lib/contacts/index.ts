import { and, eq, sql } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";
import { contactTags, contacts, tags, type Contact, type NewContact } from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { emitTrigger } from "@/lib/automations/triggers";
import { emitWebhook } from "@/lib/webhooks";
import { fullName } from "@/lib/format";
import type { ContactSource, LeadStatus, Utm } from "@/lib/types";

export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export function normalizePhone(phone: string | null | undefined): string | null {
  const p = (phone ?? "").trim();
  if (!p) return null;
  const digits = p.replace(/[^\d+]/g, "");
  return digits.length >= 6 ? digits : null;
}

/** "Ada Lovelace" → { firstName: "Ada", lastName: "Lovelace" } */
export function splitName(name: string | null | undefined): { firstName: string | null; lastName: string | null } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: null, lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") || null };
}

export type UpsertContactInput = Partial<
  Pick<
    NewContact,
    | "firstName"
    | "lastName"
    | "email"
    | "phone"
    | "company"
    | "jobTitle"
    | "website"
    | "city"
    | "country"
    | "timezone"
    | "stage"
    | "ownerId"
    | "dealValue"
    | "notes"
  >
> & {
  customFields?: Record<string, unknown>;
  utm?: Utm;
  tagIds?: string[];
};

export type UpsertOptions = {
  source: ContactSource;
  actorId?: string | null;
  /** Overwrite non-empty fields on an existing contact (default: only fill blanks). */
  overwrite?: boolean;
  tx?: Tx;
};

/**
 * Find a contact by email (then phone) or create it. Existing contacts only get
 * blank fields filled unless `overwrite` is set. Emits contact_created
 * automations/webhooks for new contacts.
 */
export async function upsertContact(
  input: UpsertContactInput,
  opts: UpsertOptions,
): Promise<{ contact: Contact; created: boolean }> {
  const tx = opts.tx ?? db;
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  if (!email && !phone && !input.firstName && !input.lastName) {
    throw new Error("A contact needs at least a name, email or phone.");
  }

  let existing: Contact | undefined;
  if (email) [existing] = await tx.select().from(contacts).where(eq(contacts.email, email)).limit(1);
  if (!existing && phone) [existing] = await tx.select().from(contacts).where(eq(contacts.phone, phone)).limit(1);

  const fields = {
    firstName: input.firstName?.trim() || null,
    lastName: input.lastName?.trim() || null,
    email,
    phone,
    company: input.company?.trim() || null,
    jobTitle: input.jobTitle?.trim() || null,
    website: input.website?.trim() || null,
    city: input.city?.trim() || null,
    country: input.country?.trim() || null,
    timezone: input.timezone || null,
    ownerId: input.ownerId ?? null,
    dealValue: input.dealValue ?? null,
    notes: input.notes ?? null,
  };

  if (existing) {
    const patch: Partial<NewContact> = {};
    for (const [k, v] of Object.entries(fields) as [keyof typeof fields, unknown][]) {
      if (v == null || v === "") continue;
      if (opts.overwrite || existing[k] == null || existing[k] === "") (patch as Record<string, unknown>)[k] = v;
    }
    if (input.stage && opts.overwrite) patch.stage = input.stage;
    if (input.customFields && Object.keys(input.customFields).length) {
      const merged = { ...existing.customFields };
      for (const [k, v] of Object.entries(input.customFields)) {
        if (v == null || v === "") continue;
        if (opts.overwrite || merged[k] == null || merged[k] === "") merged[k] = v;
      }
      patch.customFields = merged;
    }
    if (input.utm && Object.keys(existing.utm ?? {}).length === 0 && Object.values(input.utm).some(Boolean)) {
      patch.utm = input.utm;
    }
    let contact = existing;
    if (Object.keys(patch).length) {
      [contact] = await tx.update(contacts).set(patch).where(eq(contacts.id, existing.id)).returning();
    }
    if (input.tagIds?.length) {
      for (const tagId of input.tagIds) await addTagToContact(contact.id, tagId, { actorId: opts.actorId, tx });
    }
    return { contact, created: false };
  }

  const [contact] = await tx
    .insert(contacts)
    .values({
      ...fields,
      stage: input.stage ?? "new",
      source: opts.source,
      customFields: input.customFields ?? {},
      utm: input.utm ?? {},
      lastActivityAt: new Date(),
    })
    .returning();

  await logActivity(
    {
      contactId: contact.id,
      type: "contact_created",
      title: `Contact created (${opts.source})`,
      actorId: opts.actorId ?? null,
    },
    tx,
  );
  if (input.tagIds?.length) {
    for (const tagId of input.tagIds) await addTagToContact(contact.id, tagId, { actorId: opts.actorId, tx });
  }
  await emitTrigger("contact_created", contact.id, {}, tx);
  await emitWebhook("contact.created", { contact: publicContact(contact) }, tx);
  return { contact, created: true };
}

/** Shape used in webhook payloads / API responses. */
export function publicContact(c: Contact) {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    name: fullName(c),
    email: c.email,
    phone: c.phone,
    company: c.company,
    jobTitle: c.jobTitle,
    stage: c.stage,
    leadStatus: c.leadStatus,
    source: c.source,
    emailStatus: c.emailStatus,
    customFields: c.customFields,
    utm: c.utm,
    createdAt: c.createdAt,
  };
}

const LEAD_STATUS_RANK: Record<LeadStatus, number> = {
  potential: 0,
  disqualified: 1,
  qualified: 1,
  registered: 2,
  booked: 2,
};

/**
 * Move a contact along the funnel (potential → qualified/disqualified → registered/booked).
 * Never downgrades (e.g. a booked contact who starts another form stays booked)
 * unless `force` is set.
 */
export async function setLeadStatus(
  contactId: string,
  status: LeadStatus,
  opts: { force?: boolean; tx?: Tx } = {},
) {
  const tx = opts.tx ?? db;
  const [c] = await tx.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!c || c.leadStatus === status) return;
  if (!opts.force && c.leadStatus && LEAD_STATUS_RANK[c.leadStatus] > LEAD_STATUS_RANK[status]) return;
  await tx
    .update(contacts)
    .set({
      leadStatus: status,
      initialLeadStatus: c.initialLeadStatus ?? status,
      leadStatusChangedAt: new Date(),
    })
    .where(eq(contacts.id, contactId));
  await logActivity({ contactId, type: "lead_status_changed", title: `Lead status: ${status}` }, tx);
}

export async function addTagToContact(
  contactId: string,
  tagId: string,
  opts: { actorId?: string | null; tx?: Tx } = {},
) {
  const tx = opts.tx ?? db;
  const inserted = await tx.insert(contactTags).values({ contactId, tagId }).onConflictDoNothing().returning();
  if (!inserted.length) return false;
  const [tag] = await tx.select().from(tags).where(eq(tags.id, tagId));
  await logActivity(
    { contactId, type: "tag_added", title: `Tagged “${tag?.name ?? "tag"}”`, actorId: opts.actorId ?? null, meta: { tagId } },
    tx,
  );
  await emitTrigger("tag_added", contactId, { tagId }, tx);
  return true;
}

export async function removeTagFromContact(
  contactId: string,
  tagId: string,
  opts: { actorId?: string | null; tx?: Tx } = {},
) {
  const tx = opts.tx ?? db;
  const removed = await tx
    .delete(contactTags)
    .where(and(eq(contactTags.contactId, contactId), eq(contactTags.tagId, tagId)))
    .returning();
  if (!removed.length) return false;
  const [tag] = await tx.select().from(tags).where(eq(tags.id, tagId));
  await logActivity(
    { contactId, type: "tag_removed", title: `Removed tag “${tag?.name ?? "tag"}”`, actorId: opts.actorId ?? null, meta: { tagId } },
    tx,
  );
  return true;
}

/** Get a tag by (case-insensitive) name, creating it if needed. */
export async function ensureTag(name: string, color?: string, tx: Tx = db) {
  const clean = name.trim();
  const [found] = await tx
    .select()
    .from(tags)
    .where(sql`lower(${tags.name}) = ${clean.toLowerCase()}`)
    .limit(1);
  if (found) return found;
  const [created] = await tx
    .insert(tags)
    .values({ name: clean, color: color ?? "#64748b" })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await tx.select().from(tags).where(eq(tags.name, clean)).limit(1);
  return again;
}

export async function changeStage(
  contactId: string,
  stage: string,
  opts: { actorId?: string | null; tx?: Tx } = {},
) {
  const tx = opts.tx ?? db;
  const [c] = await tx.select({ stage: contacts.stage }).from(contacts).where(eq(contacts.id, contactId));
  if (!c || c.stage === stage) return false;
  await tx.update(contacts).set({ stage }).where(eq(contacts.id, contactId));
  await logActivity(
    {
      contactId,
      type: "stage_changed",
      title: `Stage changed to ${stage}`,
      actorId: opts.actorId ?? null,
      meta: { from: c.stage, to: stage },
    },
    tx,
  );
  await emitTrigger("stage_changed", contactId, { stage }, tx);
  return true;
}
