import { and, asc, desc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { audienceWhere, countAudience, emailableWhere } from "@/lib/audience";
import {
  broadcasts,
  contacts,
  emailEvents,
  eventAttendees,
  messages,
  type Broadcast,
} from "@/lib/db/schema";
import { getSetting } from "@/lib/settings";
import { cancelJobsByPrefix, enqueueJob } from "@/lib/jobs/queue";
import type { JobHandler } from "@/lib/jobs/handlers";
import { notifyUsers } from "@/lib/notify";
import { sendEmail } from "./send";
import { isEmailBodyEmpty } from "./html";
import type { BroadcastInput } from "./schemas";

// ---------------------------------------------------------------------------
// Broadcasts: draft → scheduled/sending → sent. Sending runs as background jobs
// ("broadcast.send") in resumable batches.
//
// Job dedupe keys all start with `broadcast:<id>:` so a schedule can be cancelled
// with cancelJobsByPrefix(`broadcast:<id>:`).
// ---------------------------------------------------------------------------

export class BroadcastError extends Error {}

export const BROADCAST_BATCH_SIZE = 50;
/** Max wall-clock time one job run spends sending before it re-enqueues itself. */
const RUN_BUDGET_MS = 25_000;
/** Editable statuses (a cancelled broadcast returns to draft when edited). */
export const EDITABLE_STATUSES: Broadcast["status"][] = ["draft", "cancelled"];

export const jobPrefix = (broadcastId: string) => `broadcast:${broadcastId}:`;

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

function contentFields(input: BroadcastInput) {
  return {
    name: input.name,
    subject: input.subject,
    preheader: input.preheader?.trim() ? input.preheader.trim() : null,
    contentJson: input.contentJson ?? null,
    contentHtml: input.contentHtml,
    templateId: input.templateId ?? null,
    campaignId: input.campaignId ?? null,
    audience: input.audience,
  };
}

/** Create a draft or update an existing draft/cancelled broadcast. */
export async function saveBroadcast(input: BroadcastInput, userId: string | null): Promise<Broadcast> {
  if (input.id) {
    const [existing] = await db.select().from(broadcasts).where(eq(broadcasts.id, input.id));
    if (!existing) throw new BroadcastError("Broadcast not found");
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      throw new BroadcastError(
        existing.status === "scheduled"
          ? "This broadcast is scheduled. Cancel the schedule to edit it."
          : "This broadcast has already been sent and can't be edited. Duplicate it instead.",
      );
    }
    const [row] = await db
      .update(broadcasts)
      .set({ ...contentFields(input), status: "draft", scheduledAt: null })
      .where(eq(broadcasts.id, input.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(broadcasts)
    .values({ ...contentFields(input), createdById: userId })
    .returning();
  return row;
}

export async function duplicateBroadcast(id: string, userId: string | null): Promise<Broadcast> {
  const [src] = await db.select().from(broadcasts).where(eq(broadcasts.id, id));
  if (!src) throw new BroadcastError("Broadcast not found");
  const [row] = await db
    .insert(broadcasts)
    .values({
      name: `${src.name} (copy)`.slice(0, 120),
      subject: src.subject,
      preheader: src.preheader,
      contentJson: src.contentJson,
      contentHtml: src.contentHtml,
      templateId: src.templateId,
      campaignId: src.campaignId,
      audience: src.audience,
      status: "draft",
      createdById: userId,
    })
    .returning();
  return row;
}

export async function deleteBroadcast(id: string): Promise<void> {
  const [src] = await db.select().from(broadcasts).where(eq(broadcasts.id, id));
  if (!src) throw new BroadcastError("Broadcast not found");
  if (src.status === "scheduled" || src.status === "sending" || src.status === "sent") {
    throw new BroadcastError("Only drafts, cancelled and failed broadcasts can be deleted.");
  }
  await cancelJobsByPrefix(jobPrefix(id));
  await db.delete(broadcasts).where(eq(broadcasts.id, id));
}

// ---------------------------------------------------------------------------
// Send / schedule / cancel
// ---------------------------------------------------------------------------

/** Validation shown to the user before a broadcast can be sent. Returns an error message or null. */
export async function validateForSend(b: Pick<Broadcast, "name" | "subject" | "contentHtml" | "audience">): Promise<string | null> {
  if (!b.name.trim()) return "Give the broadcast a name.";
  if (!b.subject.trim()) return "Add a subject line.";
  if (isEmailBodyEmpty(b.contentHtml)) return "The email body is empty.";
  const recipients = await countAudience(b.audience);
  if (recipients === 0) return "No eligible recipients: the audience is empty, or everyone in it is unsubscribed.";
  return null;
}

/**
 * Send a draft now (`scheduledAt` omitted) or schedule it. Enqueues the "broadcast.send" job
 * (the caller should `kickJobs()` afterwards for immediate sends).
 */
export async function queueBroadcast(id: string, opts: { scheduledAt?: Date | null } = {}): Promise<Broadcast> {
  const [b] = await db.select().from(broadcasts).where(eq(broadcasts.id, id));
  if (!b) throw new BroadcastError("Broadcast not found");
  if (!EDITABLE_STATUSES.includes(b.status)) {
    throw new BroadcastError(b.status === "scheduled" ? "This broadcast is already scheduled." : "This broadcast has already been sent.");
  }
  const problem = await validateForSend(b);
  if (problem) throw new BroadcastError(problem);

  const at = opts.scheduledAt ?? null;
  if (at && at.getTime() <= Date.now() + 30_000) throw new BroadcastError("Pick a send time at least a minute in the future.");

  const now = Date.now();
  const [row] = await db
    .update(broadcasts)
    .set(at ? { status: "scheduled", scheduledAt: at } : { status: "sending", scheduledAt: null, sentAt: null })
    .where(and(eq(broadcasts.id, id), inArray(broadcasts.status, EDITABLE_STATUSES)))
    .returning();
  if (!row) throw new BroadcastError("This broadcast was changed by someone else. Reload and try again.");

  await enqueueJob(
    "broadcast.send",
    { broadcastId: id },
    { runAt: at ?? new Date(now), dedupeKey: `${jobPrefix(id)}${at ? at.getTime() : now}`, maxAttempts: 5 },
  );
  return row;
}

/** Cancel a scheduled broadcast, or stop one that is currently sending. */
export async function cancelBroadcast(id: string): Promise<Broadcast> {
  const [b] = await db.select().from(broadcasts).where(eq(broadcasts.id, id));
  if (!b) throw new BroadcastError("Broadcast not found");
  if (b.status !== "scheduled" && b.status !== "sending") throw new BroadcastError("Only scheduled or sending broadcasts can be cancelled.");
  await cancelJobsByPrefix(jobPrefix(id));
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(eq(messages.broadcastId, id));
  const [row] = await db
    .update(broadcasts)
    .set({ status: "cancelled", scheduledAt: null, ...(b.status === "sending" ? { recipientCount: n } : {}) })
    .where(and(eq(broadcasts.id, id), inArray(broadcasts.status, ["scheduled", "sending"])))
    .returning();
  if (!row) throw new BroadcastError("This broadcast has already finished sending.");
  return row;
}

// ---------------------------------------------------------------------------
// Sending (job handler)
// ---------------------------------------------------------------------------

export type RunBroadcastOptions = {
  /** Keyset cursor: only contacts with id > afterId are considered (set by the previous run). */
  afterId?: string | null;
  batchSize?: number;
  /** Stop after this many batches and re-enqueue (default: as many as fit in the time budget). */
  maxBatches?: number;
  budgetMs?: number;
};

export type RunBroadcastResult = {
  /** Emails created in this run (sent, simulated or failed). */
  sent: number;
  /** Contacts skipped because sendEmail refused them (e.g. unsubscribed in the meantime). */
  skipped: number;
  /** True when the broadcast reached its final state. */
  finished: boolean;
  /** Why nothing was done (not due, cancelled, missing…). */
  noop?: string;
};

/**
 * Send one broadcast in resumable batches. Safe to call repeatedly: contacts that already
 * have a message for this broadcast are skipped, and progress is tracked with a keyset cursor.
 */
export async function runBroadcastSend(broadcastId: string, opts: RunBroadcastOptions = {}): Promise<RunBroadcastResult> {
  const result: RunBroadcastResult = { sent: 0, skipped: 0, finished: false };
  const batchSize = Math.max(1, opts.batchSize ?? BROADCAST_BATCH_SIZE);
  const budgetMs = opts.budgetMs ?? RUN_BUDGET_MS;

  let [b] = await db.select().from(broadcasts).where(eq(broadcasts.id, broadcastId));
  if (!b) return { ...result, noop: "missing" };
  if (b.status === "scheduled") {
    // A stale job from an earlier schedule must not fire early.
    if (b.scheduledAt && b.scheduledAt.getTime() > Date.now() + 60_000) return { ...result, noop: "not due" };
    [b] = await db
      .update(broadcasts)
      .set({ status: "sending" })
      .where(and(eq(broadcasts.id, broadcastId), eq(broadcasts.status, "scheduled")))
      .returning();
    if (!b) return { ...result, noop: "changed" };
  } else if (b.status !== "sending") {
    return { ...result, noop: b.status };
  }

  const broadcast = b;
  const emailCfg = await getSetting("email");
  // Resend rate-limits to a few requests per second.
  const throttleMs = emailCfg.provider === "resend" ? 220 : 0;
  const audience = broadcast.audience;
  const baseWhere = await audienceWhere(audience);
  const started = Date.now();
  let afterId = opts.afterId ?? null;
  let batches = 0;
  let exhausted = false;

  const stillSending = async () => {
    const [row] = await db.select({ status: broadcasts.status }).from(broadcasts).where(eq(broadcasts.id, broadcastId));
    return row?.status === "sending";
  };

  while (!exhausted) {
    const rows = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          emailableWhere,
          baseWhere,
          afterId ? gt(contacts.id, afterId) : undefined,
          sql`not exists (select 1 from ${messages} where ${messages.broadcastId} = ${broadcastId} and ${messages.contactId} = ${contacts.id})`,
        ),
      )
      .orderBy(asc(contacts.id))
      .limit(batchSize);
    if (!rows.length) {
      exhausted = true;
      break;
    }

    // For event audiences, make {{event.*}} and {{attendee.*}} tags work.
    const attendeeByContact = new Map<string, string>();
    if (audience.type === "event") {
      const att = await db
        .select({ id: eventAttendees.id, contactId: eventAttendees.contactId })
        .from(eventAttendees)
        .where(and(eq(eventAttendees.eventId, audience.eventId), inArray(eventAttendees.contactId, rows.map((r) => r.id))));
      for (const a of att) attendeeByContact.set(a.contactId, a.id);
    }

    let stopped = false;
    for (const [i, r] of rows.entries()) {
      if (i > 0 && i % 10 === 0 && !(await stillSending())) {
        stopped = true;
        break;
      }
      afterId = r.id;
      try {
        const res = await sendEmail({
          contactId: r.id,
          subject: broadcast.subject,
          html: broadcast.contentHtml,
          preheader: broadcast.preheader,
          kind: "broadcast",
          marketing: true,
          broadcastId: broadcast.id,
          templateId: broadcast.templateId,
          eventId: audience.type === "event" ? audience.eventId : null,
          attendeeId: attendeeByContact.get(r.id) ?? null,
          actorId: broadcast.createdById,
        });
        if (res.status === "skipped") result.skipped++;
        else result.sent++;
      } catch (err) {
        // One bad recipient must not block the rest of the send.
        console.error(`[broadcast ${broadcastId}] sending to ${r.id} failed`, err);
        result.skipped++;
      }
      if (throttleMs) await new Promise((res) => setTimeout(res, throttleMs));
    }
    if (stopped) return { ...result, noop: "stopped" };

    batches++;
    if (rows.length < batchSize) {
      exhausted = true;
      break;
    }
    if (!(await stillSending())) return { ...result, noop: "stopped" };
    if ((opts.maxBatches && batches >= opts.maxBatches) || Date.now() - started > budgetMs) break;
  }

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(eq(messages.broadcastId, broadcastId));

  if (!exhausted) {
    // More recipients remain: record progress and continue in a fresh job.
    await db.update(broadcasts).set({ recipientCount: n }).where(and(eq(broadcasts.id, broadcastId), eq(broadcasts.status, "sending")));
    await enqueueJob(
      "broadcast.send",
      { broadcastId, afterId },
      { dedupeKey: `${jobPrefix(broadcastId)}after:${afterId}`, maxAttempts: 5 },
    );
    return result;
  }

  const [done] = await db
    .update(broadcasts)
    .set({ status: n === 0 ? "failed" : "sent", sentAt: new Date(), recipientCount: n })
    .where(and(eq(broadcasts.id, broadcastId), eq(broadcasts.status, "sending")))
    .returning();
  result.finished = true;
  if (done && done.createdById) {
    await notifyUsers({
      to: [done.createdById],
      type: "broadcast_sent",
      title: n === 0 ? `Broadcast failed: ${done.name}` : `Broadcast sent: ${done.name}`,
      body: n === 0 ? "There were no eligible recipients at send time." : `Delivered to ${n} recipient${n === 1 ? "" : "s"}.`,
      href: `/emails/broadcasts/${done.id}`,
    }).catch(() => {});
  }
  return result;
}

export const broadcastJobHandlers: Record<string, JobHandler> = {
  "broadcast.send": async (payload, job) => {
    const broadcastId = String(payload.broadcastId ?? "");
    if (!broadcastId) return;
    try {
      await runBroadcastSend(broadcastId, { afterId: typeof payload.afterId === "string" ? payload.afterId : null });
    } catch (err) {
      // On the final attempt, don't leave the broadcast stuck in "sending".
      if (job && job.attempts >= job.maxAttempts) {
        await db
          .update(broadcasts)
          .set({ status: "failed" })
          .where(and(eq(broadcasts.id, broadcastId), inArray(broadcasts.status, ["sending", "scheduled"])));
      }
      throw err;
    }
  },
};

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export type BroadcastStats = {
  /** Messages created for this broadcast. */
  total: number;
  /** sent + simulated */
  delivered: number;
  opened: number;
  clicked: number;
  /** failed + bounced */
  failed: number;
  queued: number;
  /** Recipients who unsubscribed after receiving this broadcast. */
  unsubscribed: number;
};

const DELIVERED = sql`${messages.status} in ('sent','simulated')`;

export async function getBroadcastStats(broadcastId: string): Promise<BroadcastStats> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      delivered: sql<number>`(count(*) filter (where ${DELIVERED}))::int`,
      opened: sql<number>`(count(*) filter (where ${messages.openedAt} is not null))::int`,
      clicked: sql<number>`(count(*) filter (where ${messages.clickedAt} is not null))::int`,
      failed: sql<number>`(count(*) filter (where ${messages.status} in ('failed','bounced')))::int`,
      queued: sql<number>`(count(*) filter (where ${messages.status} = 'queued'))::int`,
    })
    .from(messages)
    .where(eq(messages.broadcastId, broadcastId));
  const [unsub] = await db
    .select({ n: sql<number>`count(distinct ${contacts.id})::int` })
    .from(messages)
    .innerJoin(contacts, eq(contacts.id, messages.contactId))
    .where(
      and(
        eq(messages.broadcastId, broadcastId),
        eq(contacts.emailStatus, "unsubscribed"),
        sql`${contacts.unsubscribedAt} >= (select min(m2.created_at) from messages m2 where m2.broadcast_id = ${broadcastId})`,
      ),
    );
  return {
    total: row?.total ?? 0,
    delivered: row?.delivered ?? 0,
    opened: row?.opened ?? 0,
    clicked: row?.clicked ?? 0,
    failed: row?.failed ?? 0,
    queued: row?.queued ?? 0,
    unsubscribed: unsub?.n ?? 0,
  };
}

export type BroadcastListMetrics = { total: number; delivered: number; opened: number; clicked: number };

/** Per-broadcast totals for a page of broadcasts (list view). */
export async function getBroadcastListMetrics(ids: string[]): Promise<Map<string, BroadcastListMetrics>> {
  const out = new Map<string, BroadcastListMetrics>();
  if (!ids.length) return out;
  const rows = await db
    .select({
      broadcastId: messages.broadcastId,
      total: sql<number>`count(*)::int`,
      delivered: sql<number>`(count(*) filter (where ${DELIVERED}))::int`,
      opened: sql<number>`(count(*) filter (where ${messages.openedAt} is not null))::int`,
      clicked: sql<number>`(count(*) filter (where ${messages.clickedAt} is not null))::int`,
    })
    .from(messages)
    .where(inArray(messages.broadcastId, ids))
    .groupBy(messages.broadcastId);
  for (const r of rows) if (r.broadcastId) out.set(r.broadcastId, { total: r.total, delivered: r.delivered, opened: r.opened, clicked: r.clicked });
  return out;
}

export type TopLink = { url: string; clicks: number; uniqueClicks: number };

export async function getBroadcastTopLinks(broadcastId: string, limit = 10): Promise<TopLink[]> {
  const rows = await db
    .select({
      url: emailEvents.url,
      clicks: sql<number>`count(*)::int`,
      uniqueClicks: sql<number>`count(distinct ${emailEvents.messageId})::int`,
    })
    .from(emailEvents)
    .innerJoin(messages, eq(messages.id, emailEvents.messageId))
    .where(and(eq(messages.broadcastId, broadcastId), eq(emailEvents.type, "click")))
    .groupBy(emailEvents.url)
    .orderBy(desc(sql`count(*)`), asc(emailEvents.url))
    .limit(limit);
  return rows.filter((r): r is { url: string; clicks: number; uniqueClicks: number } => Boolean(r.url));
}

export const RECIPIENT_FILTERS = ["all", "delivered", "opened", "clicked", "failed"] as const;
export type RecipientFilter = (typeof RECIPIENT_FILTERS)[number];

export async function listBroadcastRecipients(
  broadcastId: string,
  opts: { filter?: RecipientFilter; page?: number; pageSize?: number } = {},
) {
  const pageSize = opts.pageSize ?? 25;
  const page = Math.max(1, opts.page ?? 1);
  let extra: SQL | undefined;
  switch (opts.filter) {
    case "delivered":
      extra = DELIVERED;
      break;
    case "opened":
      extra = sql`${messages.openedAt} is not null`;
      break;
    case "clicked":
      extra = sql`${messages.clickedAt} is not null`;
      break;
    case "failed":
      extra = sql`${messages.status} in ('failed','bounced')`;
      break;
  }
  const where = and(eq(messages.broadcastId, broadcastId), extra);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(messages).where(where);
  const rows = await db
    .select({
      id: messages.id,
      contactId: messages.contactId,
      toEmail: messages.toEmail,
      toName: messages.toName,
      status: messages.status,
      error: messages.error,
      sentAt: messages.sentAt,
      createdAt: messages.createdAt,
      openedAt: messages.openedAt,
      openCount: messages.openCount,
      clickedAt: messages.clickedAt,
      clickCount: messages.clickCount,
    })
    .from(messages)
    .where(where)
    .orderBy(desc(messages.createdAt), asc(messages.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Open rate = opened / delivered, click rate = clicked / delivered. */
export function rate(part: number, delivered: number): number | null {
  return delivered > 0 ? part / delivered : null;
}
