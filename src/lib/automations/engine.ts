import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";
import {
  automationLogs,
  automationRuns,
  automations,
  bookingPages,
  contacts,
  emailTemplates,
  eventAttendees,
  events,
  tags,
  tasks,
  users,
  type Automation,
  type AutomationRun,
  type Event,
} from "@/lib/db/schema";
import { buildContactWhere } from "@/lib/contacts/filters";
import { addTagToContact, changeStage, publicContact, removeTagFromContact } from "@/lib/contacts";
import { logActivity } from "@/lib/activity";
import { sendEmail } from "@/lib/email/send";
import { buildMergeContext } from "@/lib/email/context";
import { applyMergeTags } from "@/lib/email/merge-tags";
import { cancelJobsByPrefix, enqueueJob } from "@/lib/jobs/queue";
import type { JobHandler } from "@/lib/jobs/handlers";
import { notifyUsers } from "@/lib/notify";
import { getSetting } from "@/lib/settings";
import { fullName } from "@/lib/format";
import type { AutomationRunStatus, AutomationStep, AutomationTrigger, TriggerContext, TriggerType } from "@/lib/types";
import { describeStep, formatWait, waitToMs } from "./meta";

// ---------------------------------------------------------------------------
// Automations engine.
//
// Job types (registered in src/lib/jobs/handlers.ts through `automationJobHandlers`):
//  - "automation.trigger"  { type, contactId, context }  → enrol the contact into every matching active automation
//  - "automation.step"     { runId, stepIndex }          → execute the run from `currentStep` until a wait / exit / end
//
// Step jobs use dedupe keys `automation:<runId>:<stepIndex>` (plus a suffix for re-schedules and
// retries) so a retried job never schedules the same step twice. Cancel a run's pending jobs with
// cancelJobsByPrefix(`automation:<runId>:`).
//
// Run lifecycle: active (queued/executing) ⇄ waiting (a future step job exists) → completed |
// exited (condition failed, event/registration cancelled) | failed (a step errored) | cancelled (manual).
// `currentStep` is the index of the NEXT step to execute.
// ---------------------------------------------------------------------------

/** How often a paused (or draft) automation re-checks whether it may advance its runs. */
export const PAUSED_RECHECK_MS = 60 * 60 * 1000;
/**
 * Loop guard: max enrolments of one contact into one automation per rolling hour, even with
 * `allowReentry` (e.g. an "add tag" step feeding a "tag added" trigger of the same automation).
 */
export const MAX_ENROLLMENTS_PER_HOUR = 10;

/** Transient step failures (webhook 5xx, email provider down…) are retried after these delays, then the run fails. */
export const STEP_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000];

const LIVE: AutomationRunStatus[] = ["active", "waiting"];

/** A step failed in a way that should not be retried (missing template, bad config…) → the run fails. */
export class StepError extends Error {}
/** A step failed for a transient reason (network, 5xx, email provider down) → retried with backoff first. */
export class RetryableStepError extends StepError {}

// ---------------------------------------------------------------------------
// Trigger matching
// ---------------------------------------------------------------------------

type MatchInfo = { campaignId: string | null; bookingPageId: string | null };

/** Resolve the campaign / booking page of the trigger context (the event's campaign, the meeting's booking page…). */
async function loadMatchInfo(context: TriggerContext): Promise<MatchInfo> {
  let campaignId: string | null = null;
  let bookingPageId: string | null = context.bookingPageId ?? null;
  if (context.eventId) {
    const [event] = await db
      .select({ campaignId: events.campaignId, bookingPageId: events.bookingPageId })
      .from(events)
      .where(eq(events.id, context.eventId));
    campaignId = event?.campaignId ?? null;
    bookingPageId ??= event?.bookingPageId ?? null;
  }
  if (!campaignId && bookingPageId) {
    const [page] = await db.select({ campaignId: bookingPages.campaignId }).from(bookingPages).where(eq(bookingPages.id, bookingPageId));
    campaignId = page?.campaignId ?? null;
  }
  return { campaignId, bookingPageId };
}

/**
 * Does an automation's trigger accept this trigger event? Every configured filter must match;
 * unset (null / empty) filters accept anything.
 */
export function triggerMatches(trigger: AutomationTrigger, type: TriggerType, context: TriggerContext, info: MatchInfo): boolean {
  if (trigger.type !== type) return false;
  const c = trigger.config ?? {};
  if (c.tagId && context.tagId !== c.tagId) return false;
  if (c.stage && context.stage !== c.stage) return false;
  if (c.eventId && context.eventId !== c.eventId) return false;
  if (c.campaignId && info.campaignId !== c.campaignId) return false;
  if (c.bookingPageId && info.bookingPageId !== c.bookingPageId) return false;
  if (c.outcome && context.outcome !== c.outcome) return false;
  return true;
}

/** Enrol the contact into every active automation whose trigger matches. */
export async function handleTrigger(input: { type: TriggerType; contactId: string; context?: TriggerContext }) {
  const context = input.context ?? {};
  const candidates = await db
    .select()
    .from(automations)
    .where(and(eq(automations.status, "active"), sql`${automations.trigger} ->> 'type' = ${input.type}`));
  const result = { matched: 0, enrolled: 0 };
  if (!candidates.length) return result;

  const needsInfo = candidates.some((a) => a.trigger.config?.campaignId || a.trigger.config?.bookingPageId);
  const info: MatchInfo = needsInfo
    ? await loadMatchInfo(context)
    : { campaignId: null, bookingPageId: context.bookingPageId ?? null };

  for (const automation of candidates) {
    if (!triggerMatches(automation.trigger, input.type, context, info)) continue;
    result.matched++;
    try {
      const res = await enrollContact(automation, input.contactId, context, { source: "trigger" });
      if (res.enrolled) result.enrolled++;
    } catch (err) {
      console.error(`[automations] could not enrol contact ${input.contactId} into "${automation.name}"`, err);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------

export type EnrollSkipReason =
  | "contact_not_found"
  | "not_active"
  | "already_active"
  | "already_enrolled"
  | "rate_limited";

export type EnrollResult = { enrolled: true; runId: string } | { enrolled: false; reason: EnrollSkipReason };

export const ENROLL_SKIP_LABELS: Record<EnrollSkipReason, string> = {
  contact_not_found: "contact not found",
  not_active: "automation is not active",
  already_active: "already in this automation",
  already_enrolled: "already went through this automation (re-entry is off)",
  rate_limited: "enrolled too many times in the last hour",
};

async function writeLog(
  tx: Tx,
  run: { id: string; automationId: string },
  entry: { stepIndex?: number | null; stepType?: string | null; status: "ok" | "skipped" | "error" | "exited"; message?: string | null },
) {
  await tx.insert(automationLogs).values({
    runId: run.id,
    automationId: run.automationId,
    stepIndex: entry.stepIndex ?? null,
    stepType: entry.stepType ?? null,
    status: entry.status,
    message: entry.message ?? null,
  });
}

/**
 * Create a run for the contact and queue its first step.
 *
 * Re-entry rules (`automation.allowReentry` = false, the default): a contact can only be in an
 * automation once – any earlier run (active, waiting, completed, exited or failed) blocks a new
 * one; runs the user cancelled don't count. With `allowReentry` a new run may start even while
 * another is active, but never more than MAX_ENROLLMENTS_PER_HOUR per contact per automation.
 */
export async function enrollContact(
  automation: Pick<Automation, "id" | "name" | "allowReentry" | "status">,
  contactId: string,
  context: TriggerContext = {},
  opts: { source: "trigger" | "manual"; actorId?: string | null } = { source: "trigger" },
): Promise<EnrollResult> {
  if (automation.status !== "active") return { enrolled: false, reason: "not_active" };
  return db.transaction(async (tx) => {
    // Serialise concurrent enrolments of the same contact into the same automation.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`automation-enroll:${automation.id}:${contactId}`}))`);

    const [contact] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contactId));
    if (!contact) return { enrolled: false, reason: "contact_not_found" } as const;

    const previous = await tx
      .select({ status: automationRuns.status })
      .from(automationRuns)
      .where(and(eq(automationRuns.automationId, automation.id), eq(automationRuns.contactId, contactId)));
    if (!automation.allowReentry) {
      if (previous.some((r) => LIVE.includes(r.status))) return { enrolled: false, reason: "already_active" } as const;
      if (previous.some((r) => r.status !== "cancelled")) return { enrolled: false, reason: "already_enrolled" } as const;
    }

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [recent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(automationRuns)
      .where(
        and(
          eq(automationRuns.automationId, automation.id),
          eq(automationRuns.contactId, contactId),
          gte(automationRuns.startedAt, hourAgo),
        ),
      );
    if ((recent?.n ?? 0) >= MAX_ENROLLMENTS_PER_HOUR) {
      console.warn(`[automations] "${automation.name}": enrolment of contact ${contactId} skipped (rate limit)`);
      return { enrolled: false, reason: "rate_limited" } as const;
    }

    const [run] = await tx
      .insert(automationRuns)
      .values({ automationId: automation.id, contactId, context, status: "active", currentStep: 0 })
      .returning();
    await writeLog(tx, run, {
      stepType: "enrolled",
      status: "ok",
      message: opts.source === "manual" ? "Enrolled manually" : "Enrolled by trigger",
    });
    await logActivity(
      {
        contactId,
        type: "automation",
        title: `Entered automation “${automation.name}”`,
        actorId: opts.actorId ?? null,
        eventId: context.eventId ?? null,
        meta: { automationId: automation.id, runId: run.id },
      },
      tx,
    );
    await enqueueJob("automation.step", { runId: run.id, stepIndex: 0 }, { dedupeKey: `automation:${run.id}:0` }, tx);
    return { enrolled: true, runId: run.id } as const;
  });
}

// ---------------------------------------------------------------------------
// Run state helpers
// ---------------------------------------------------------------------------

type Finish = {
  status: Extract<AutomationRunStatus, "completed" | "exited" | "failed" | "cancelled">;
  message: string;
  stepIndex?: number | null;
  stepType?: string | null;
  error?: string;
};

/** Move a live run into a terminal state. Returns false if it was no longer live. */
async function finishRun(run: AutomationRun, automation: Pick<Automation, "name"> | null, f: Finish): Promise<boolean> {
  const done = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(automationRuns)
      .set({
        status: f.status,
        completedAt: new Date(),
        nextRunAt: null,
        lastError: f.status === "failed" ? (f.error ?? f.message) : null,
      })
      .where(and(eq(automationRuns.id, run.id), inArray(automationRuns.status, LIVE)))
      .returning({ id: automationRuns.id });
    if (!updated) return false;
    await writeLog(tx, run, {
      stepIndex: f.stepIndex ?? null,
      stepType: f.stepType ?? (f.status === "completed" ? "end" : null),
      status: f.status === "failed" ? "error" : f.status === "exited" || f.status === "cancelled" ? "exited" : "ok",
      message: f.message,
    });
    const name = automation?.name ?? "automation";
    const title =
      f.status === "completed"
        ? `Completed automation “${name}”`
        : f.status === "exited"
          ? `Left automation “${name}”`
          : f.status === "failed"
            ? `Automation “${name}” failed`
            : `Removed from automation “${name}”`;
    await logActivity(
      {
        contactId: run.contactId,
        type: "automation",
        title,
        body: f.status === "completed" ? null : f.message,
        meta: { automationId: run.automationId, runId: run.id, status: f.status },
      },
      tx,
    );
    return true;
  });
  if (done) await cancelJobsByPrefix(`automation:${run.id}:`);
  return done;
}

/** Cancel a live run (and its pending step jobs). */
export async function cancelRun(runId: string, opts: { reason?: string } = {}): Promise<boolean> {
  const [run] = await db.select().from(automationRuns).where(eq(automationRuns.id, runId));
  if (!run || !LIVE.includes(run.status)) return false;
  const [automation] = await db.select({ name: automations.name }).from(automations).where(eq(automations.id, run.automationId));
  return finishRun(run, automation ?? null, { status: "cancelled", message: opts.reason ?? "Run cancelled" });
}

async function advanceTo(
  run: AutomationRun,
  idx: number,
  log: { stepType: string; status: "ok" | "skipped"; message: string },
): Promise<AutomationRun | null> {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(automationRuns)
      .set({ currentStep: idx + 1, lastError: null })
      .where(and(eq(automationRuns.id, run.id), eq(automationRuns.currentStep, idx), inArray(automationRuns.status, LIVE)))
      .returning();
    if (!updated) return null; // somebody else advanced / cancelled the run
    await writeLog(tx, run, { stepIndex: idx, ...log });
    return updated;
  });
}

async function scheduleWait(
  run: AutomationRun,
  idx: number,
  until: Date,
  log: { stepType: string; message: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(automationRuns)
      .set({ currentStep: idx + 1, status: "waiting", nextRunAt: until, lastError: null })
      .where(and(eq(automationRuns.id, run.id), eq(automationRuns.currentStep, idx), inArray(automationRuns.status, LIVE)))
      .returning({ id: automationRuns.id });
    if (!updated) return false;
    await writeLog(tx, run, { stepIndex: idx, status: "ok", ...log });
    await enqueueJob(
      "automation.step",
      { runId: run.id, stepIndex: idx + 1 },
      { runAt: until, dedupeKey: `automation:${run.id}:${idx + 1}` },
      tx,
    );
    return true;
  });
}

/** Re-queue the run's current step later without advancing it (paused automation, moved event). */
async function rescheduleCurrent(run: AutomationRun, runAt: Date, tag: "paused" | "moved", extra: Record<string, unknown> = {}) {
  await db.transaction(async (tx) => {
    if (tag === "moved") {
      await tx.update(automationRuns).set({ status: "waiting", nextRunAt: runAt }).where(eq(automationRuns.id, run.id));
    }
    await enqueueJob(
      "automation.step",
      { runId: run.id, stepIndex: run.currentStep, ...extra },
      {
        runAt,
        dedupeKey:
          tag === "paused"
            ? `automation:${run.id}:${run.currentStep}:paused:${Math.floor(runAt.getTime() / PAUSED_RECHECK_MS)}`
            : `automation:${run.id}:${run.currentStep}:moved:${runAt.getTime()}`,
      },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

function eventAnchorTime(event: Pick<Event, "startsAt" | "endsAt">, step: Extract<AutomationStep, { type: "wait_until_event" }>) {
  const anchor = step.anchor === "end" ? event.endsAt : event.startsAt;
  return new Date(anchor.getTime() + step.offsetMinutes * 60_000);
}

async function resolveAttendee(context: TriggerContext, contactId: string) {
  if (context.attendeeId) {
    const [a] = await db
      .select({ id: eventAttendees.id, status: eventAttendees.status })
      .from(eventAttendees)
      .where(eq(eventAttendees.id, context.attendeeId));
    if (a) return a;
  }
  if (context.eventId) {
    const [a] = await db
      .select({ id: eventAttendees.id, status: eventAttendees.status })
      .from(eventAttendees)
      .where(and(eq(eventAttendees.eventId, context.eventId), eq(eventAttendees.contactId, contactId)));
    if (a) return a;
  }
  return null;
}

const stamp = (d: Date) => `${d.toISOString().replace("T", " ").slice(0, 16)} UTC`;

// ---------------------------------------------------------------------------
// Step execution
// ---------------------------------------------------------------------------

type StepOutcome =
  | { type: "continue"; status?: "ok" | "skipped"; message: string }
  | { type: "wait"; until: Date; message: string }
  | { type: "exit"; message: string };

async function executeStep(
  automation: Automation,
  run: AutomationRun,
  step: AutomationStep,
  idx: number,
): Promise<StepOutcome> {
  const ctx = run.context ?? {};
  const contactId = run.contactId;

  switch (step.type) {
    case "send_email": {
      const [tpl] = step.templateId ? await db.select().from(emailTemplates).where(eq(emailTemplates.id, step.templateId)) : [];
      if (!tpl) throw new StepError("Email template not found – it may have been deleted");
      const attendee = ctx.eventId || ctx.attendeeId ? await resolveAttendee(ctx, contactId) : null;
      const res = await sendEmail({
        contactId,
        eventId: ctx.eventId ?? null,
        attendeeId: attendee?.id ?? null,
        subject: tpl.subject,
        html: tpl.contentHtml,
        preheader: tpl.preheader,
        kind: "automation",
        marketing: true,
        automationId: automation.id,
        templateId: tpl.id,
      });
      if (res.status === "failed") throw new RetryableStepError(`Email failed: ${res.error}`);
      if (res.status === "skipped") return { type: "continue", status: "skipped", message: `Email “${tpl.name}” not sent: ${res.reason}` };
      return { type: "continue", message: `Sent “${tpl.name}”${res.status === "simulated" ? " (simulated)" : ""}` };
    }

    case "wait": {
      const ms = waitToMs(step.amount, step.unit);
      if (ms <= 0) return { type: "continue", status: "skipped", message: "Wait of 0 – continuing" };
      const until = new Date(Date.now() + ms);
      return { type: "wait", until, message: `Waiting ${formatWait(step.amount, step.unit)} (until ${stamp(until)})` };
    }

    case "wait_until_event": {
      if (!ctx.eventId) {
        throw new StepError(
          "This step needs an event, but this run has none. Use an event or meeting trigger, or pick an event when enrolling manually.",
        );
      }
      const [event] = await db.select().from(events).where(eq(events.id, ctx.eventId));
      if (!event) throw new StepError("The event for this run no longer exists");
      if (event.status === "cancelled") return { type: "exit", message: `“${event.title}” was cancelled` };
      const target = eventAnchorTime(event, step);
      const label = describeStep(step);
      if (target.getTime() <= Date.now()) {
        return { type: "continue", message: `${label}: that moment has already passed – continuing` };
      }
      return { type: "wait", until: target, message: `${label} (until ${stamp(target)})` };
    }

    case "condition": {
      const where = buildContactWhere(step.filter);
      if (where) {
        const rows = await db
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.id, contactId), where))
          .limit(1);
        if (!rows.length) return { type: "exit", message: "Condition not met – the contact doesn't match the filter" };
      }
      if (step.attendance?.length) {
        const attendee = await resolveAttendee(ctx, contactId);
        if (!attendee) return { type: "exit", message: "Condition not met – no registration found for this event" };
        if (!step.attendance.includes(attendee.status)) {
          return { type: "exit", message: `Condition not met – attendance is “${attendee.status.replace("_", " ")}”` };
        }
      }
      return { type: "continue", message: "Condition met" };
    }

    case "add_tag": {
      const [tag] = step.tagId ? await db.select().from(tags).where(eq(tags.id, step.tagId)) : [];
      if (!tag) throw new StepError("Tag not found – it may have been deleted");
      const added = await addTagToContact(contactId, tag.id);
      return { type: "continue", message: added ? `Added tag “${tag.name}”` : `Already tagged “${tag.name}”` };
    }

    case "remove_tag": {
      const [tag] = step.tagId ? await db.select().from(tags).where(eq(tags.id, step.tagId)) : [];
      if (!tag) throw new StepError("Tag not found – it may have been deleted");
      const removed = await removeTagFromContact(contactId, tag.id);
      return { type: "continue", message: removed ? `Removed tag “${tag.name}”` : `Contact didn't have tag “${tag.name}”` };
    }

    case "set_stage": {
      const stages = await getSetting("stages");
      const stage = stages.find((s) => s.key === step.stage);
      if (!stage) throw new StepError(`Unknown pipeline stage “${step.stage}”`);
      const changed = await changeStage(contactId, stage.key);
      return { type: "continue", message: changed ? `Moved to stage “${stage.label}”` : `Already in stage “${stage.label}”` };
    }

    case "create_task": {
      const { ctx: merge, contact, event } = await buildMergeContext({ contactId, eventId: ctx.eventId, attendeeId: ctx.attendeeId });
      const title = applyMergeTags(step.title, merge, { html: false }).trim() || "Follow up";
      let assigneeId = step.assigneeId || contact?.ownerId || null;
      if (assigneeId) {
        const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, assigneeId));
        if (!u) assigneeId = null;
      }
      const dueAt = new Date(Date.now() + Math.max(0, step.dueInDays) * 86_400_000);
      await db.insert(tasks).values({ title, dueAt, contactId, eventId: event?.id ?? null, assigneeId });
      await logActivity({
        contactId,
        type: "task_created",
        title: `Task created: ${title}`,
        eventId: event?.id ?? null,
        meta: { automationId: automation.id },
      });
      if (assigneeId) {
        await notifyUsers({ to: [assigneeId], type: "task", title: `New task: ${title}`, body: contact ? fullName(contact) : null, href: "/tasks" });
      }
      return { type: "continue", message: `Created task “${title}”` };
    }

    case "notify_team": {
      const { ctx: merge, contact } = await buildMergeContext({ contactId, eventId: ctx.eventId, attendeeId: ctx.attendeeId });
      const title = applyMergeTags(step.message, merge, { html: false }).trim() || `Automation “${automation.name}” fired`;
      await notifyUsers({
        to: step.userIds?.length ? step.userIds : "admins",
        type: "automation",
        title,
        body: `${contact ? fullName(contact) : "A contact"} · ${automation.name}`,
        href: `/contacts/${contactId}`,
      });
      return { type: "continue", message: `Notified the team: “${title}”` };
    }

    case "webhook": {
      let url: URL;
      try {
        url = new URL(step.url.trim());
      } catch {
        throw new StepError("Webhook URL is not valid");
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new StepError("Webhook URL must be http(s)");
      const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
      if (!contact) throw new StepError("Contact not found");
      const body = JSON.stringify({
        event: "automation.webhook",
        automation: { id: automation.id, name: automation.name },
        run: { id: run.id, step: idx },
        contact: publicContact(contact),
        context: ctx,
        sentAt: new Date().toISOString(),
      });
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Relay-Automations/1.0",
          "x-relay-event": "automation.webhook",
        },
        body,
        signal: AbortSignal.timeout(10_000),
      }).catch((err: unknown) => {
        throw new RetryableStepError(`Webhook request failed: ${err instanceof Error ? err.message : String(err)}`);
      });
      if (!res.ok) {
        const msg = `Webhook responded ${res.status}`;
        throw res.status >= 500 || res.status === 429 || res.status === 408 ? new RetryableStepError(msg) : new StepError(msg);
      }
      return { type: "continue", message: `Webhook delivered (${res.status})` };
    }
  }
}

/**
 * Called when a run wakes up after a "wait until event" step: don't send a reminder for an event
 * that was cancelled or a registration that was cancelled, and wait again if the event moved later.
 */
async function checkEventWaitResume(
  run: AutomationRun,
  automation: Automation,
  prev: Extract<AutomationStep, { type: "wait_until_event" }>,
): Promise<{ type: "go" } | { type: "exit"; message: string } | { type: "reschedule"; until: Date }> {
  const ctx = run.context ?? {};
  if (!ctx.eventId) return { type: "go" };
  const [event] = await db.select().from(events).where(eq(events.id, ctx.eventId));
  if (!event) return { type: "go" };
  const expectsCancellation = automation.trigger.type === "event_cancelled" || automation.trigger.type === "meeting_cancelled";
  if (!expectsCancellation) {
    if (event.status === "cancelled") return { type: "exit", message: `“${event.title}” was cancelled` };
    const attendee = await resolveAttendee(ctx, run.contactId);
    if (attendee?.status === "cancelled") return { type: "exit", message: "The registration was cancelled" };
  }
  const target = eventAnchorTime(event, prev);
  if (target.getTime() > Date.now() + 60_000) return { type: "reschedule", until: target };
  return { type: "go" };
}

/** Schedule another attempt at the run's current step. Returns false when the retries are used up. */
async function scheduleRetry(run: AutomationRun, idx: number, step: AutomationStep, message: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [failures] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(automationLogs)
      .where(and(eq(automationLogs.runId, run.id), eq(automationLogs.stepIndex, idx), eq(automationLogs.status, "error")));
    const attempt = failures?.n ?? 0;
    if (attempt >= STEP_RETRY_DELAYS_MS.length) return false;
    const runAt = new Date(Date.now() + STEP_RETRY_DELAYS_MS[attempt]);
    await tx
      .update(automationRuns)
      .set({ status: "waiting", nextRunAt: runAt, lastError: message })
      .where(and(eq(automationRuns.id, run.id), inArray(automationRuns.status, LIVE)));
    await writeLog(tx, run, {
      stepIndex: idx,
      stepType: step.type,
      status: "error",
      message: `${message} – retrying in ${Math.round(STEP_RETRY_DELAYS_MS[attempt] / 60_000)} min (attempt ${attempt + 2} of ${STEP_RETRY_DELAYS_MS.length + 1})`,
    });
    await enqueueJob(
      "automation.step",
      { runId: run.id, stepIndex: idx },
      { runAt, dedupeKey: `automation:${run.id}:${idx}:retry:${attempt + 1}` },
      tx,
    );
    return true;
  });
}

/**
 * Execute a run from its current step until it waits, exits, fails or completes.
 * `opts.stepIndex` (from the job payload) makes stale/duplicate jobs harmless.
 */
export async function processRun(runId: string, opts: { stepIndex?: number } = {}): Promise<void> {
  let [run] = await db.select().from(automationRuns).where(eq(automationRuns.id, runId));
  if (!run || !LIVE.includes(run.status)) return;
  if (opts.stepIndex != null && run.currentStep !== opts.stepIndex) return; // stale job

  const [automation] = await db.select().from(automations).where(eq(automations.id, run.automationId));
  if (!automation) {
    await finishRun(run, null, { status: "cancelled", message: "Automation no longer exists" });
    return;
  }

  // Paused (or back to draft): don't advance, look again in an hour. Resuming bumps these jobs to "now".
  if (automation.status !== "active") {
    await rescheduleCurrent(run, new Date(Date.now() + PAUSED_RECHECK_MS), "paused", { paused: true });
    return;
  }

  // Woke up after "wait until event"?
  const prev = automation.steps[run.currentStep - 1];
  if (opts.stepIndex != null && prev?.type === "wait_until_event") {
    const verdict = await checkEventWaitResume(run, automation, prev);
    if (verdict.type === "exit") {
      await finishRun(run, automation, { status: "exited", message: verdict.message, stepIndex: run.currentStep - 1, stepType: prev.type });
      return;
    }
    if (verdict.type === "reschedule") {
      await rescheduleCurrent(run, verdict.until, "moved");
      return;
    }
  }

  if (run.status !== "active" || run.nextRunAt) {
    [run] = await db.update(automationRuns).set({ status: "active", nextRunAt: null }).where(eq(automationRuns.id, run.id)).returning();
  }

  for (let guard = 0; guard <= automation.steps.length; guard++) {
    const idx = run.currentStep;
    const step = automation.steps[idx];
    if (!step) {
      await finishRun(run, automation, { status: "completed", message: "Run completed" });
      return;
    }

    let outcome: StepOutcome;
    try {
      outcome = await executeStep(automation, run, step, idx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof RetryableStepError && (await scheduleRetry(run, idx, step, message))) return;
      await finishRun(run, automation, { status: "failed", message, error: message, stepIndex: idx, stepType: step.type });
      return;
    }

    if (outcome.type === "continue") {
      const next = await advanceTo(run, idx, { stepType: step.type, status: outcome.status ?? "ok", message: outcome.message });
      if (!next) return;
      run = next;
    } else if (outcome.type === "wait") {
      await scheduleWait(run, idx, outcome.until, { stepType: step.type, message: outcome.message });
      return;
    } else {
      await finishRun(run, automation, { status: "exited", message: outcome.message, stepIndex: idx, stepType: step.type });
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Job handlers
// ---------------------------------------------------------------------------

export const automationJobHandlers: Record<string, JobHandler> = {
  "automation.trigger": async (payload) => {
    const contactId = typeof payload.contactId === "string" ? payload.contactId : null;
    const type = payload.type as TriggerType | undefined;
    if (!contactId || !type) return;
    await handleTrigger({ type, contactId, context: (payload.context as TriggerContext | undefined) ?? {} });
  },
  "automation.step": async (payload) => {
    const runId = typeof payload.runId === "string" ? payload.runId : null;
    if (!runId) return;
    await processRun(runId, { stepIndex: typeof payload.stepIndex === "number" ? payload.stepIndex : undefined });
  },
};
