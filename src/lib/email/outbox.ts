import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { automations, broadcasts, contacts, emailEvents, emailTemplates, events, messages } from "@/lib/db/schema";
import type { MessageKind, MessageStatus } from "@/lib/types";
import { OUTBOX_KINDS, OUTBOX_STATUSES } from "./schemas";

export type OutboxFilters = {
  kind?: string | null;
  status?: string | null;
  q?: string | null;
  page?: number;
  pageSize?: number;
};

function likeEscape(s: string) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Paginated message log (without the heavy html/text columns). */
export async function listMessages(f: OutboxFilters = {}) {
  const pageSize = f.pageSize ?? 50;
  const page = Math.max(1, f.page ?? 1);
  const q = f.q?.trim();
  const where = and(
    f.kind && (OUTBOX_KINDS as readonly string[]).includes(f.kind) ? eq(messages.kind, f.kind as MessageKind) : undefined,
    f.status && (OUTBOX_STATUSES as readonly string[]).includes(f.status) ? eq(messages.status, f.status as MessageStatus) : undefined,
    q ? or(ilike(messages.toEmail, `%${likeEscape(q)}%`), ilike(messages.subject, `%${likeEscape(q)}%`), ilike(messages.toName, `%${likeEscape(q)}%`)) : undefined,
  );
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(messages).where(where);
  const rows = await db
    .select({
      id: messages.id,
      contactId: messages.contactId,
      toEmail: messages.toEmail,
      toName: messages.toName,
      subject: messages.subject,
      kind: messages.kind,
      status: messages.status,
      provider: messages.provider,
      error: messages.error,
      openCount: messages.openCount,
      clickCount: messages.clickCount,
      sentAt: messages.sentAt,
      createdAt: messages.createdAt,
      broadcastId: messages.broadcastId,
    })
    .from(messages)
    .where(where)
    .orderBy(desc(messages.createdAt), asc(messages.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** A single message with everything the detail page shows. */
export async function getMessageDetail(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [m] = await db.select().from(messages).where(eq(messages.id, id));
  if (!m) return null;
  const [contact, broadcast, automation, event, template, evts] = await Promise.all([
    m.contactId
      ? db.select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email }).from(contacts).where(eq(contacts.id, m.contactId))
      : [],
    m.broadcastId ? db.select({ id: broadcasts.id, name: broadcasts.name }).from(broadcasts).where(eq(broadcasts.id, m.broadcastId)) : [],
    m.automationId ? db.select({ id: automations.id, name: automations.name }).from(automations).where(eq(automations.id, m.automationId)) : [],
    m.eventId ? db.select({ id: events.id, title: events.title }).from(events).where(eq(events.id, m.eventId)) : [],
    m.templateId ? db.select({ id: emailTemplates.id, name: emailTemplates.name }).from(emailTemplates).where(eq(emailTemplates.id, m.templateId)) : [],
    db.select().from(emailEvents).where(eq(emailEvents.messageId, id)).orderBy(desc(emailEvents.createdAt)).limit(100),
  ]);
  return {
    message: m,
    contact: contact[0] ?? null,
    broadcast: broadcast[0] ?? null,
    automation: automation[0] ?? null,
    event: event[0] ?? null,
    template: template[0] ?? null,
    events: evts,
  };
}
