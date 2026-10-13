"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { activities, contacts, emailTemplates, savedViews, tags, users } from "@/lib/db/schema";
import { isAdmin, requireUser } from "@/lib/auth";
import { fail, ok, zodFail } from "@/lib/action";
import { logActivity } from "@/lib/activity";
import { getStages } from "@/lib/settings";
import { EventFullError, registerForEvent } from "@/lib/events/registration";
import { sendEmail } from "@/lib/email/send";
import { escapeHtml } from "@/lib/email/merge-tags";
import { unsubscribeByToken, resubscribeByToken } from "@/lib/email/tracking";
import { decodeFilter, filterGroupSchema, sanitizeFilterGroup } from "@/lib/contacts/filter-codec";
import { coerceCustomInput, listCustomFieldDefs } from "@/lib/contacts/custom-fields";
import { listActivities, toActivityDTO } from "@/lib/contacts/detail";
import { resolveSelection, type ContactSelection } from "@/lib/contacts/query";
import {
  bulkAddTag,
  bulkAddToEvent,
  bulkAssignOwner,
  bulkChangeStage,
  bulkDelete,
  bulkRemoveTag,
} from "@/lib/contacts/bulk";
import {
  ContactConflictError,
  ContactValidationError,
  createContact,
  deleteContacts,
  setContactTags,
  updateContact,
  type ContactPatch,
} from "@/lib/contacts/update";
import type { ActivityDTO, ContactActionResult } from "@/lib/contacts/dto";

const id = z.uuid("Invalid id");
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const contactInputSchema = z.object({
  firstName: optText(100),
  lastName: optText(100),
  email: optText(254),
  phone: optText(40),
  company: optText(200),
  jobTitle: optText(200),
  website: optText(300),
  city: optText(120),
  country: optText(120),
  timezone: optText(80),
  stage: z.string().trim().min(1).max(60).optional(),
  ownerId: id.nullish().transform((v) => v ?? null),
  dealValue: z.number().int("Deal value must be a whole number").min(0).max(10_000_000_000).nullish().transform((v) => v ?? null),
  notes: z.string().max(10_000).nullish().transform((v) => (v && v.trim() ? v : null)),
  customFields: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
});
export type ContactInput = z.input<typeof contactInputSchema>;

function revalidateContact(contactId?: string) {
  revalidatePath("/contacts");
  revalidatePath("/pipeline");
  if (contactId) revalidatePath(`/contacts/${contactId}`);
}

function conflictFail(err: ContactConflictError) {
  return { ok: false as const, error: err.message, fieldErrors: { [err.field]: [err.message] }, duplicateId: err.existingId };
}

async function validatedPatch(input: unknown): Promise<
  | { ok: true; patch: ContactPatch & { stage?: string }; tagNames?: string[] }
  | { ok: false; result: ReturnType<typeof fail> }
> {
  const parsed = contactInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, result: zodFail(parsed.error) };
  const d = parsed.data;
  if (d.stage) {
    const stages = await getStages();
    if (!stages.some((s) => s.key === d.stage)) return { ok: false, result: fail("Unknown stage", { stage: ["Choose a valid stage"] }) };
  }
  const defs = await listCustomFieldDefs();
  const custom = coerceCustomInput(defs, d.customFields);
  if (Object.keys(custom.errors).length) return { ok: false, result: fail("Some custom fields are invalid", custom.errors) };
  const patch: ContactPatch = {
    firstName: d.firstName,
    lastName: d.lastName,
    email: d.email,
    phone: d.phone,
    company: d.company,
    jobTitle: d.jobTitle,
    website: d.website,
    city: d.city,
    country: d.country,
    timezone: d.timezone,
    ownerId: d.ownerId,
    dealValue: d.dealValue,
    notes: d.notes,
    customFields: custom.values,
  };
  if (d.stage) patch.stage = d.stage;
  return { ok: true, patch, tagNames: d.tags };
}

export async function createContactAction(input: ContactInput): Promise<ContactActionResult<{ id: string }>> {
  const user = await requireUser();
  const v = await validatedPatch(input);
  if (!v.ok) return v.result;
  const { patch, tagNames } = v;
  try {
    const customFields = Object.fromEntries(Object.entries(patch.customFields ?? {}).filter(([, val]) => val != null));
    const contact = await createContact(
      {
        firstName: patch.firstName,
        lastName: patch.lastName,
        email: patch.email,
        phone: patch.phone,
        company: patch.company,
        jobTitle: patch.jobTitle,
        website: patch.website,
        city: patch.city,
        country: patch.country,
        timezone: patch.timezone,
        stage: patch.stage,
        ownerId: patch.ownerId,
        dealValue: patch.dealValue,
        notes: patch.notes,
        customFields,
        tagNames,
      },
      { actorId: user.id },
    );
    revalidateContact();
    return ok({ id: contact.id }, "Contact created");
  } catch (err) {
    if (err instanceof ContactConflictError) return conflictFail(err);
    if (err instanceof ContactValidationError) return fail(err.message, err.field ? { [err.field]: [err.message] } : undefined);
    throw err;
  }
}

export async function updateContactAction(contactId: string, input: ContactInput): Promise<ContactActionResult<{ id: string }>> {
  const user = await requireUser();
  if (!id.safeParse(contactId).success) return fail("Contact not found");
  const v = await validatedPatch(input);
  if (!v.ok) return v.result;
  try {
    const res = await updateContact(contactId, v.patch, { actorId: user.id });
    if (!res) return fail("Contact not found");
    if (v.tagNames) await setContactTags(contactId, v.tagNames, { actorId: user.id });
    revalidateContact(contactId);
    return ok({ id: contactId }, "Contact saved");
  } catch (err) {
    if (err instanceof ContactConflictError) return conflictFail(err);
    if (err instanceof ContactValidationError) return fail(err.message, err.field ? { [err.field]: [err.message] } : undefined);
    throw err;
  }
}

export async function deleteContactAction(contactId: string) {
  await requireUser();
  if (!id.safeParse(contactId).success) return fail("Contact not found");
  const n = await deleteContacts([contactId]);
  revalidateContact();
  return n ? ok(undefined, "Contact deleted") : fail("Contact not found");
}

export async function setContactOwnerAction(contactId: string, ownerId: string | null) {
  const user = await requireUser();
  const parsed = z.object({ contactId: id, ownerId: id.nullable() }).safeParse({ contactId, ownerId });
  if (!parsed.success) return zodFail(parsed.error);
  if (ownerId) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, ownerId));
    if (!u) return fail("User not found");
  }
  const res = await updateContact(contactId, { ownerId }, { actorId: user.id });
  if (!res) return fail("Contact not found");
  revalidateContact(contactId);
  return ok(undefined, ownerId ? "Owner updated" : "Owner cleared");
}

export async function setContactTagsAction(contactId: string, names: string[]) {
  const user = await requireUser();
  const parsed = z.object({ contactId: id, names: z.array(z.string().trim().min(1).max(60)).max(50) }).safeParse({ contactId, names });
  if (!parsed.success) return zodFail(parsed.error);
  await setContactTags(contactId, parsed.data.names, { actorId: user.id });
  revalidateContact(contactId);
  return ok(undefined, "Tags updated");
}

export async function setEmailStatusAction(contactId: string, status: "subscribed" | "unsubscribed") {
  await requireUser();
  const parsed = z.object({ contactId: id, status: z.enum(["subscribed", "unsubscribed"]) }).safeParse({ contactId, status });
  if (!parsed.success) return zodFail(parsed.error);
  const [c] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!c) return fail("Contact not found");
  if (status === "unsubscribed") await unsubscribeByToken(c.unsubscribeToken);
  else await resubscribeByToken(c.unsubscribeToken);
  revalidateContact(contactId);
  return ok(undefined, status === "unsubscribed" ? "Contact unsubscribed from marketing emails" : "Contact re-subscribed");
}

// ---------------------------------------------------------------------------
// Journey: notes & calls
// ---------------------------------------------------------------------------

export async function addNoteAction(contactId: string, input: { type: "note" | "call"; body: string }): Promise<ReturnType<typeof ok<ActivityDTO>> | ReturnType<typeof fail>> {
  const user = await requireUser();
  const parsed = z
    .object({ contactId: id, type: z.enum(["note", "call"]), body: z.string().trim().min(1, "Write something first").max(10_000) })
    .safeParse({ contactId, ...input });
  if (!parsed.success) return zodFail(parsed.error);
  const [c] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contactId));
  if (!c) return fail("Contact not found");
  const row = await logActivity({
    contactId,
    type: parsed.data.type,
    title: parsed.data.type === "call" ? "Call logged" : "Note added",
    body: parsed.data.body,
    actorId: user.id,
  });
  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/contacts");
  return ok(toActivityDTO(row, user.name), parsed.data.type === "call" ? "Call logged" : "Note added");
}

export async function deleteActivityAction(activityId: string) {
  const user = await requireUser();
  if (!id.safeParse(activityId).success) return fail("Not found");
  const [a] = await db.select().from(activities).where(eq(activities.id, activityId));
  if (!a) return fail("Not found");
  if (a.type !== "note" && a.type !== "call") return fail("Only notes and calls can be deleted");
  if (a.actorId !== user.id && !isAdmin(user)) return fail("You can only delete your own notes");
  await db.delete(activities).where(eq(activities.id, activityId));
  if (a.contactId) revalidatePath(`/contacts/${a.contactId}`);
  return ok(undefined, "Entry deleted");
}

export async function loadMoreActivitiesAction(contactId: string, before: string) {
  await requireUser();
  const parsed = z.object({ contactId: id, before: z.iso.datetime() }).safeParse({ contactId, before });
  if (!parsed.success) return [] as ActivityDTO[];
  return listActivities(contactId, { before: new Date(parsed.data.before) });
}

// ---------------------------------------------------------------------------
// Email & events
// ---------------------------------------------------------------------------

function plainToHtml(text: string) {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

export type SendEmailOutcome = { status: "sent" | "simulated" | "failed" | "skipped"; messageId?: string; detail?: string };

export async function sendContactEmailAction(
  contactId: string,
  input: { templateId?: string | null; subject: string; body: string },
): Promise<ReturnType<typeof ok<SendEmailOutcome>> | ReturnType<typeof fail>> {
  const user = await requireUser();
  const parsed = z
    .object({
      contactId: id,
      templateId: id.nullish(),
      subject: z.string().trim().min(1, "Add a subject").max(300),
      body: z.string().max(100_000),
    })
    .safeParse({ contactId, ...input });
  if (!parsed.success) return zodFail(parsed.error);
  const d = parsed.data;
  const [c] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!c) return fail("Contact not found");
  if (!c.email) return fail("This contact has no email address");

  let html: string;
  if (d.templateId) {
    const [t] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, d.templateId));
    if (!t) return fail("Template not found");
    html = t.contentHtml;
  } else {
    if (!d.body.trim()) return fail("Write a message first", { body: ["Write a message first"] });
    html = plainToHtml(d.body);
  }
  const res = await sendEmail({
    contactId,
    contact: c,
    subject: d.subject,
    html,
    kind: "manual",
    marketing: false,
    templateId: d.templateId ?? null,
    actorId: user.id,
  });
  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/contacts");
  if (res.status === "skipped") return ok<SendEmailOutcome>({ status: "skipped", detail: res.reason });
  if (res.status === "failed") return ok<SendEmailOutcome>({ status: "failed", messageId: res.messageId, detail: res.error });
  return ok<SendEmailOutcome>({ status: res.status, messageId: res.messageId });
}

export async function addContactToEventAction(contactId: string, eventId: string, silent = false) {
  const user = await requireUser();
  const parsed = z.object({ contactId: id, eventId: id }).safeParse({ contactId, eventId });
  if (!parsed.success) return fail("Pick an event");
  try {
    const r = await registerForEvent({ eventId, contactId, source: "manual", actorId: user.id, silent });
    revalidatePath(`/contacts/${contactId}`);
    revalidatePath(`/events/${eventId}`);
    if (!r.created) return ok(undefined, "Already registered for this event");
    return ok(undefined, r.waitlisted ? "Event is full – added to the waitlist" : "Registered for the event");
  } catch (err) {
    if (err instanceof EventFullError) return fail("This event is full and has no waitlist.");
    return fail(err instanceof Error ? err.message : "Could not register this contact");
  }
}

// ---------------------------------------------------------------------------
// Bulk actions
// ---------------------------------------------------------------------------

const quickSchema = z.object({
  stage: z.string().max(60).optional(),
  lead: z.string().max(40).optional(),
  tag: z.string().max(60).optional(),
  owner: z.string().max(60).optional(),
  email: z.string().max(40).optional(),
  source: z.string().max(40).optional(),
});

const selectionSchema = z.union([
  z.object({ ids: z.array(id).min(1).max(500) }),
  z.object({ all: z.literal(true), q: z.string().max(200).optional(), f: z.string().max(10_000).optional(), quick: quickSchema.optional() }),
]);

const bulkOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_tag"), tagName: z.string().trim().min(1, "Enter a tag").max(60) }),
  z.object({ op: z.literal("remove_tag"), tagId: id }),
  z.object({ op: z.literal("stage"), stage: z.string().min(1).max(60) }),
  z.object({ op: z.literal("owner"), ownerId: id.nullable() }),
  z.object({ op: z.literal("event"), eventId: id, silent: z.boolean().default(false) }),
  z.object({ op: z.literal("delete") }),
]);

export type BulkSelectionInput = z.input<typeof selectionSchema>;
export type BulkOpInput = z.input<typeof bulkOpSchema>;

export async function bulkContactsAction(selection: BulkSelectionInput, operation: BulkOpInput) {
  const user = await requireUser();
  const sel = selectionSchema.safeParse(selection);
  const op = bulkOpSchema.safeParse(operation);
  if (!sel.success) return zodFail(sel.error);
  if (!op.success) return zodFail(op.error);

  const target: ContactSelection =
    "ids" in sel.data
      ? { ids: sel.data.ids }
      : { query: { q: sel.data.q, filter: decodeFilter(sel.data.f), quick: sel.data.quick } };
  const ids = await resolveSelection(target);
  if (!ids.length) return fail("No contacts match the selection");
  const n = (count: number, noun = "contact") => `${count} ${noun}${count === 1 ? "" : "s"}`;

  const o = op.data;
  let message: string;
  switch (o.op) {
    case "add_tag": {
      const r = await bulkAddTag(ids, { name: o.tagName }, user.id);
      message = `Tagged ${n(r.affected)} with “${o.tagName}”${r.affected < ids.length ? ` (${ids.length - r.affected} already had it)` : ""}`;
      break;
    }
    case "remove_tag": {
      const r = await bulkRemoveTag(ids, o.tagId, user.id);
      message = `Removed the tag from ${n(r.affected)}`;
      break;
    }
    case "stage": {
      const stages = await getStages();
      const stage = stages.find((s) => s.key === o.stage);
      if (!stage) return fail("Unknown stage");
      const r = await bulkChangeStage(ids, o.stage, user.id);
      message = `Moved ${n(r.affected)} to ${stage.label}`;
      break;
    }
    case "owner": {
      try {
        const r = await bulkAssignOwner(ids, o.ownerId, user.id);
        message = o.ownerId ? `Assigned ${n(r.affected)}` : `Cleared the owner of ${n(r.affected)}`;
      } catch (err) {
        return fail(err instanceof Error ? err.message : "Could not assign owner");
      }
      break;
    }
    case "event": {
      const r = await bulkAddToEvent(ids, o.eventId, { actorId: user.id, silent: o.silent });
      const parts = [`${r.registered} registered`];
      if (r.waitlisted) parts.push(`${r.waitlisted} waitlisted`);
      if (r.alreadyRegistered) parts.push(`${r.alreadyRegistered} already registered`);
      if (r.full) parts.push(`${r.full} not added – event is full`);
      if (r.failed) parts.push(`${r.failed} failed`);
      revalidatePath(`/events/${o.eventId}`);
      revalidateContact();
      if (r.registered + r.waitlisted === 0 && (r.full || r.failed)) return fail(parts.join(", "));
      return ok({ ...r }, parts.join(", "));
    }
    case "delete": {
      const r = await bulkDelete(ids);
      message = `Deleted ${n(r.affected)}`;
      break;
    }
  }
  revalidateContact();
  return ok({ count: ids.length }, message);
}

// ---------------------------------------------------------------------------
// Smart views
// ---------------------------------------------------------------------------

const viewSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1, "Give the view a name").max(80),
  description: z.string().trim().max(300).nullish(),
  visibility: z.enum(["private", "shared"]),
  filters: filterGroupSchema.optional(),
});

export async function saveViewAction(input: z.input<typeof viewSchema>) {
  const user = await requireUser();
  const parsed = viewSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const d = parsed.data;
  if (d.id) {
    const [existing] = await db.select().from(savedViews).where(eq(savedViews.id, d.id));
    if (!existing) return fail("View not found");
    if (existing.ownerId !== user.id && !isAdmin(user)) return fail("Only the owner of a view can change it");
    await db
      .update(savedViews)
      .set({
        name: d.name,
        description: d.description || null,
        visibility: d.visibility,
        ...(d.filters ? { filters: sanitizeFilterGroup(d.filters as never) } : {}),
      })
      .where(eq(savedViews.id, d.id));
    revalidatePath("/contacts");
    return ok({ id: d.id }, "View updated");
  }
  if (!d.filters) return fail("Nothing to save");
  const [row] = await db
    .insert(savedViews)
    .values({
      name: d.name,
      description: d.description || null,
      visibility: d.visibility,
      filters: sanitizeFilterGroup(d.filters as never),
      ownerId: user.id,
    })
    .returning({ id: savedViews.id });
  revalidatePath("/contacts");
  return ok({ id: row.id }, "View saved");
}

export async function deleteViewAction(viewId: string) {
  const user = await requireUser();
  if (!id.safeParse(viewId).success) return fail("View not found");
  const [existing] = await db.select().from(savedViews).where(eq(savedViews.id, viewId));
  if (!existing) return fail("View not found");
  if (existing.ownerId !== user.id && !isAdmin(user)) return fail("Only the owner of a view can delete it");
  await db.delete(savedViews).where(eq(savedViews.id, viewId));
  revalidatePath("/contacts");
  return ok(undefined, "View deleted");
}

// ---------------------------------------------------------------------------
// Lookups for dialogs
// ---------------------------------------------------------------------------

/** Tag suggestions (existing tag names) for tag inputs. */
export async function listTagNamesAction() {
  await requireUser();
  const rows = await db.select({ id: tags.id, name: tags.name, color: tags.color }).from(tags).orderBy(tags.name);
  return rows;
}
