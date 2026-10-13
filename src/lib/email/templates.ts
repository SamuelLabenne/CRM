import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { automations, bookingPages, broadcasts, emailTemplates, events, type EmailTemplate } from "@/lib/db/schema";
import { SYSTEM_TEMPLATES, type SystemTemplateKey } from "./system-templates";
import type { TemplateInput } from "./schemas";

export class TemplateError extends Error {}

/** Where each built-in template is used (shown as a hint in the templates list and editor). */
export const SYSTEM_TEMPLATE_INFO: Record<SystemTemplateKey, string> = {
  event_confirmation: "Sent when someone registers for an event",
  event_waitlisted: "Sent when someone joins an event waitlist",
  event_reminder: "Sent before an event, per the event's reminders",
  event_cancellation: "Sent when a registration is cancelled",
  event_follow_up_attended: "Follow-up for people who attended an event",
  event_follow_up_no_show: "Follow-up for people who missed an event",
  meeting_confirmation: "Sent when a meeting is booked",
  meeting_reminder: "Sent before a booked meeting",
  meeting_cancellation: "Sent when a meeting is cancelled",
  meeting_follow_up: "Follow-up after a meeting",
  host_new_registration: "Internal email to the host on a new registration or booking",
};

export function systemTemplateInfo(key: string | null | undefined): string | null {
  return key && key in SYSTEM_TEMPLATE_INFO ? SYSTEM_TEMPLATE_INFO[key as SystemTemplateKey] : null;
}

/** Create or update a template. System templates keep their name & category. */
export async function saveTemplate(input: TemplateInput, userId: string | null): Promise<EmailTemplate> {
  if (input.id) {
    const [existing] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, input.id));
    if (!existing) throw new TemplateError("Template not found");
    const [row] = await db
      .update(emailTemplates)
      .set({
        name: existing.systemKey ? existing.name : input.name,
        category: existing.systemKey ? existing.category : input.category,
        subject: input.subject,
        preheader: input.preheader?.trim() ? input.preheader.trim() : null,
        contentJson: input.contentJson ?? null,
        contentHtml: input.contentHtml,
      })
      .where(eq(emailTemplates.id, input.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(emailTemplates)
    .values({
      name: input.name,
      category: input.category,
      subject: input.subject,
      preheader: input.preheader?.trim() ? input.preheader.trim() : null,
      contentJson: input.contentJson ?? null,
      contentHtml: input.contentHtml,
      createdById: userId,
    })
    .returning();
  return row;
}

/** Copy a template (the copy is never a system template). */
export async function duplicateTemplate(id: string, userId: string | null): Promise<EmailTemplate> {
  const [src] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, id));
  if (!src) throw new TemplateError("Template not found");
  const [row] = await db
    .insert(emailTemplates)
    .values({
      name: `${src.name} (copy)`.slice(0, 120),
      subject: src.subject,
      preheader: src.preheader,
      contentJson: src.contentJson,
      contentHtml: src.contentHtml,
      category: src.systemKey ? "other" : src.category,
      systemKey: null,
      createdById: userId,
    })
    .returning();
  return row;
}

/** Delete a custom template. Built-in templates cannot be deleted (reset them instead). */
export async function deleteTemplate(id: string): Promise<void> {
  const [src] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, id));
  if (!src) throw new TemplateError("Template not found");
  if (src.systemKey) throw new TemplateError("Built-in templates can't be deleted. Use “Reset to default” instead.");
  await db.delete(emailTemplates).where(eq(emailTemplates.id, id));
}

/** Restore a built-in template's name, subject, preheader and content to the shipped default. */
export async function resetSystemTemplate(id: string): Promise<EmailTemplate> {
  const [src] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, id));
  if (!src) throw new TemplateError("Template not found");
  const def = src.systemKey ? SYSTEM_TEMPLATES[src.systemKey as SystemTemplateKey] : undefined;
  if (!def) throw new TemplateError("Only built-in templates can be reset to default");
  const [row] = await db
    .update(emailTemplates)
    .set({
      name: def.name,
      subject: def.subject,
      preheader: def.preheader ?? null,
      contentHtml: def.html,
      contentJson: null,
    })
    .where(eq(emailTemplates.id, id))
    .returning();
  return row;
}

export type TemplateUsage = { broadcasts: number; automations: number; events: number; bookingPages: number };

const empty = (): TemplateUsage => ({ broadcasts: 0, automations: 0, events: 0, bookingPages: 0 });

function notificationTemplateIds(n: {
  confirmation?: { templateId?: string | null };
  cancellation?: { templateId?: string | null };
  reminders?: { templateId?: string | null }[];
  followUps?: { templateId?: string | null }[];
}): Set<string> {
  const ids = new Set<string>();
  const add = (v: string | null | undefined) => v && ids.add(v);
  add(n.confirmation?.templateId);
  add(n.cancellation?.templateId);
  for (const r of n.reminders ?? []) add(r.templateId);
  for (const f of n.followUps ?? []) add(f.templateId);
  return ids;
}

/** How many broadcasts / automations / events / booking pages reference each template. */
export async function getTemplateUsage(): Promise<Map<string, TemplateUsage>> {
  const usage = new Map<string, TemplateUsage>();
  const bump = (id: string, key: keyof TemplateUsage) => {
    const u = usage.get(id) ?? empty();
    u[key]++;
    usage.set(id, u);
  };
  const [bcs, autos, evs, pages] = await Promise.all([
    db.select({ templateId: broadcasts.templateId }).from(broadcasts),
    db.select({ steps: automations.steps }).from(automations),
    db.select({ notifications: events.notifications }).from(events),
    db.select({ notifications: bookingPages.notifications }).from(bookingPages),
  ]);
  for (const b of bcs) if (b.templateId) bump(b.templateId, "broadcasts");
  for (const a of autos) {
    const ids = new Set<string>();
    for (const s of a.steps ?? []) if (s.type === "send_email" && s.templateId) ids.add(s.templateId);
    for (const id of ids) bump(id, "automations");
  }
  for (const e of evs) for (const id of notificationTemplateIds(e.notifications ?? {})) bump(id, "events");
  for (const p of pages) for (const id of notificationTemplateIds(p.notifications ?? {})) bump(id, "bookingPages");
  return usage;
}

/** Human readable usage summary, e.g. "2 automations · 1 broadcast". */
export function describeUsage(u: TemplateUsage | undefined): string | null {
  if (!u) return null;
  const parts: string[] = [];
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  if (u.automations) parts.push(plural(u.automations, "automation"));
  if (u.events) parts.push(plural(u.events, "event"));
  if (u.bookingPages) parts.push(plural(u.bookingPages, "booking page"));
  if (u.broadcasts) parts.push(plural(u.broadcasts, "broadcast"));
  return parts.length ? parts.join(" · ") : null;
}
