import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, type Tx } from "@/lib/db";
import {
  automationLogs,
  automationRuns,
  automations,
  contacts,
  emailTemplates,
  eventAttendees,
  jobs,
  savedViews,
  tags,
  type Automation,
} from "@/lib/db/schema";
import { buildContactWhere } from "@/lib/contacts/filters";
import { enqueueJob } from "@/lib/jobs/queue";
import { getSetting } from "@/lib/settings";
import type { AutomationStatus, AutomationStep, AutomationTrigger, TriggerContext } from "@/lib/types";
import { enrollContact, ENROLL_SKIP_LABELS, type EnrollSkipReason } from "./engine";
import { pruneTriggerConfig, validateAutomation, type AutomationIssue } from "./meta";
import type { AutomationInput } from "./schema";

// Higher-level automation operations used by the server actions (and other modules,
// e.g. "add these contacts to an automation" → enrollContacts).

// ---------------------------------------------------------------------------
// Validation for activation
// ---------------------------------------------------------------------------

/** Strict validation: structure (meta.validateAutomation) plus references to templates, tags and stages that must still exist. */
export async function activationIssues(input: {
  name: string;
  trigger: AutomationTrigger;
  steps: AutomationStep[];
}): Promise<AutomationIssue[]> {
  const issues = validateAutomation(input);
  const templateIds = new Set<string>();
  const tagIds = new Set<string>();
  for (const s of input.steps) {
    if (s.type === "send_email" && s.templateId) templateIds.add(s.templateId);
    if ((s.type === "add_tag" || s.type === "remove_tag") && s.tagId) tagIds.add(s.tagId);
  }
  const [tpls, tgs, stages] = await Promise.all([
    templateIds.size ? db.select({ id: emailTemplates.id }).from(emailTemplates).where(inArray(emailTemplates.id, [...templateIds])) : [],
    tagIds.size ? db.select({ id: tags.id }).from(tags).where(inArray(tags.id, [...tagIds])) : [],
    input.steps.some((s) => s.type === "set_stage") ? getSetting("stages") : [],
  ]);
  const haveTemplates = new Set(tpls.map((t) => t.id));
  const haveTags = new Set(tgs.map((t) => t.id));
  const haveStages = new Set(stages.map((s) => s.key));
  for (const s of input.steps) {
    if (s.type === "send_email" && s.templateId && !haveTemplates.has(s.templateId)) {
      issues.push({ field: "step", stepId: s.id, message: "This email template no longer exists" });
    }
    if ((s.type === "add_tag" || s.type === "remove_tag") && s.tagId && !haveTags.has(s.tagId)) {
      issues.push({ field: "step", stepId: s.id, message: "This tag no longer exists" });
    }
    if (s.type === "set_stage" && s.stage && !haveStages.has(s.stage)) {
      issues.push({ field: "step", stepId: s.id, message: "This pipeline stage no longer exists" });
    }
  }
  if (input.trigger.type === "tag_added" && input.trigger.config?.tagId) {
    const [t] = await db.select({ id: tags.id }).from(tags).where(eq(tags.id, input.trigger.config.tagId));
    if (!t) issues.push({ field: "trigger", message: "The tag in the trigger no longer exists" });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Jobs & runs
// ---------------------------------------------------------------------------

/** Cancel every pending "automation.step" job that belongs to a run of this automation. */
export async function cancelAutomationJobs(automationId: string, tx: Tx = db) {
  await tx
    .update(jobs)
    .set({ status: "cancelled", dedupeKey: sql`${jobs.dedupeKey} || ':cancelled:' || ${jobs.id}` })
    .where(
      and(
        eq(jobs.type, "automation.step"),
        eq(jobs.status, "pending"),
        sql`${jobs.payload} ->> 'runId' in (select ${automationRuns.id}::text from ${automationRuns} where ${automationRuns.automationId} = ${automationId})`,
      ),
    );
}

/** Delete an automation: pending step jobs are cancelled, runs and logs cascade. Sent messages keep their history. */
export async function deleteAutomation(id: string) {
  await db.transaction(async (tx) => {
    await cancelAutomationJobs(id, tx);
    await tx.delete(automations).where(eq(automations.id, id));
  });
}

/** After un-pausing: runs that were parked by the hourly "still paused?" check continue right away. */
export async function resumeAutomationRuns(automationId: string) {
  await db
    .update(jobs)
    .set({ runAt: new Date() })
    .where(
      and(
        eq(jobs.type, "automation.step"),
        eq(jobs.status, "pending"),
        sql`${jobs.payload} ->> 'paused' = 'true'`,
        sql`${jobs.payload} ->> 'runId' in (select ${automationRuns.id}::text from ${automationRuns} where ${automationRuns.automationId} = ${automationId})`,
      ),
    );
}

/** Retry a failed run from the step that failed. */
export async function retryRun(runId: string): Promise<boolean> {
  const [run] = await db.select().from(automationRuns).where(eq(automationRuns.id, runId));
  if (!run || run.status !== "failed") return false;
  await db.transaction(async (tx) => {
    await tx
      .update(automationRuns)
      .set({ status: "active", lastError: null, completedAt: null, nextRunAt: null })
      .where(eq(automationRuns.id, runId));
    await tx.insert(automationLogs).values({
      runId,
      automationId: run.automationId,
      stepIndex: run.currentStep,
      stepType: "retry",
      status: "ok",
      message: "Retried manually",
    });
    await enqueueJob(
      "automation.step",
      { runId, stepIndex: run.currentStep },
      { dedupeKey: `automation:${runId}:${run.currentStep}:retry:${Date.now()}` },
      tx,
    );
  });
  return true;
}

// ---------------------------------------------------------------------------
// Save / status
// ---------------------------------------------------------------------------

export type SaveResult =
  | { ok: true; automation: Automation }
  | { ok: false; error: string; issues: AutomationIssue[] };

function uniqueStepIds(steps: AutomationStep[]): AutomationStep[] {
  const seen = new Set<string>();
  return steps.map((s) => {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      return s;
    }
    const id = nanoid(8);
    seen.add(id);
    return { ...s, id } as AutomationStep;
  });
}

/** Create or update an automation. Activating requires the strict validation to pass. */
export async function saveAutomation(
  input: Omit<AutomationInput, "trigger" | "steps"> & { trigger: AutomationTrigger; steps: AutomationStep[] },
  opts: { userId?: string | null } = {},
): Promise<SaveResult> {
  const trigger: AutomationTrigger = { type: input.trigger.type, config: pruneTriggerConfig(input.trigger.type, input.trigger.config) };
  const steps = uniqueStepIds(input.steps);

  if (input.status === "active") {
    const issues = await activationIssues({ name: input.name, trigger, steps });
    if (issues.length) {
      return { ok: false, error: `Can't activate yet: ${issues[0].message}`, issues };
    }
  }

  const values = {
    name: input.name.trim(),
    description: input.description ?? null,
    status: input.status,
    trigger,
    steps,
    allowReentry: input.allowReentry,
  };

  if (input.id) {
    const [before] = await db.select({ status: automations.status }).from(automations).where(eq(automations.id, input.id));
    if (!before) return { ok: false, error: "Automation not found", issues: [] };
    const [automation] = await db.update(automations).set(values).where(eq(automations.id, input.id)).returning();
    if (before.status !== "active" && values.status === "active") await resumeAutomationRuns(automation.id);
    return { ok: true, automation };
  }
  const [automation] = await db
    .insert(automations)
    .values({ ...values, createdById: opts.userId ?? null })
    .returning();
  return { ok: true, automation };
}

/** Change only the status (list-page toggle). Activating validates the saved automation. */
export async function setAutomationStatus(id: string, status: AutomationStatus): Promise<SaveResult> {
  const [a] = await db.select().from(automations).where(eq(automations.id, id));
  if (!a) return { ok: false, error: "Automation not found", issues: [] };
  if (status === "active") {
    const issues = await activationIssues(a);
    if (issues.length) return { ok: false, error: `Can't activate yet: ${issues[0].message}`, issues };
  }
  const [updated] = await db.update(automations).set({ status }).where(eq(automations.id, id)).returning();
  if (a.status !== "active" && status === "active") await resumeAutomationRuns(id);
  return { ok: true, automation: updated };
}

export async function duplicateAutomation(id: string, userId?: string | null): Promise<Automation | null> {
  const [a] = await db.select().from(automations).where(eq(automations.id, id));
  if (!a) return null;
  const [copy] = await db
    .insert(automations)
    .values({
      name: `${a.name} (copy)`.slice(0, 120),
      description: a.description,
      status: "draft",
      trigger: a.trigger,
      steps: a.steps.map((s) => ({ ...s, id: nanoid(8) }) as AutomationStep),
      allowReentry: a.allowReentry,
      createdById: userId ?? null,
    })
    .returning();
  return copy;
}

// ---------------------------------------------------------------------------
// Manual enrolment
// ---------------------------------------------------------------------------

export const MAX_MANUAL_ENROLLMENT = 5000;

/** Contact ids matching a smart view (capped). */
export async function resolveViewContactIds(viewId: string, limit = MAX_MANUAL_ENROLLMENT + 1): Promise<string[] | null> {
  const [view] = await db.select().from(savedViews).where(eq(savedViews.id, viewId));
  if (!view) return null;
  const rows = await db.select({ id: contacts.id }).from(contacts).where(buildContactWhere(view.filters)).limit(limit);
  return rows.map((r) => r.id);
}

export type EnrollSummary = {
  total: number;
  enrolled: number;
  skipped: Partial<Record<EnrollSkipReason, number>>;
  truncated: boolean;
};

/**
 * Manually enrol contacts (picked ids and/or everyone in a smart view). Works for any ACTIVE automation
 * regardless of its trigger type – for non-"manual" triggers the run simply has no trigger context, so
 * steps that need an event (wait until event, attendance conditions) require `eventId`, which is then used as
 * the run's event context (and the contact's registration is looked up as the attendee). The same re-entry
 * rules and rate limit as for triggers apply.
 */
export async function enrollContacts(input: {
  automationId: string;
  contactIds?: string[];
  viewId?: string | null;
  eventId?: string | null;
  actorId?: string | null;
}): Promise<EnrollSummary> {
  const [automation] = await db.select().from(automations).where(eq(automations.id, input.automationId));
  if (!automation) throw new Error("Automation not found");
  if (automation.status !== "active") throw new Error("Activate the automation before enrolling contacts");

  const ids = new Set(input.contactIds ?? []);
  let truncated = false;
  if (input.viewId) {
    const viewIds = await resolveViewContactIds(input.viewId);
    if (!viewIds) throw new Error("Smart view not found");
    if (viewIds.length > MAX_MANUAL_ENROLLMENT) truncated = true;
    for (const id of viewIds.slice(0, MAX_MANUAL_ENROLLMENT)) ids.add(id);
  }
  const all = [...ids];

  const attendeeByContact = new Map<string, string>();
  if (input.eventId && all.length) {
    for (let i = 0; i < all.length; i += 500) {
      const rows = await db
        .select({ id: eventAttendees.id, contactId: eventAttendees.contactId })
        .from(eventAttendees)
        .where(and(eq(eventAttendees.eventId, input.eventId), inArray(eventAttendees.contactId, all.slice(i, i + 500))));
      for (const r of rows) attendeeByContact.set(r.contactId, r.id);
    }
  }

  const summary: EnrollSummary = { total: all.length, enrolled: 0, skipped: {}, truncated };
  for (const contactId of all) {
    const context: TriggerContext = input.eventId ? { eventId: input.eventId, attendeeId: attendeeByContact.get(contactId) } : {};
    const res = await enrollContact(automation, contactId, context, { source: "manual", actorId: input.actorId });
    if (res.enrolled) summary.enrolled++;
    else summary.skipped[res.reason] = (summary.skipped[res.reason] ?? 0) + 1;
  }
  return summary;
}

export function describeEnrollSummary(s: EnrollSummary): string {
  const parts: string[] = [`Enrolled ${s.enrolled} of ${s.total} contact${s.total === 1 ? "" : "s"}`];
  const skipped = Object.entries(s.skipped) as [EnrollSkipReason, number][];
  if (skipped.length) parts.push(`skipped: ${skipped.map(([r, n]) => `${n} ${ENROLL_SKIP_LABELS[r]}`).join(", ")}`);
  if (s.truncated) parts.push(`limited to the first ${MAX_MANUAL_ENROLLMENT} contacts of the view`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export type AutomationStats = {
  /** Every run ever started. */
  total: number;
  /** Currently in progress (active + waiting). */
  active: number;
  completed: number;
  exited: number;
  failed: number;
  cancelled: number;
};

const emptyStats = (): AutomationStats => ({ total: 0, active: 0, completed: 0, exited: 0, failed: 0, cancelled: 0 });

export async function getAutomationStats(ids: string[]): Promise<Map<string, AutomationStats>> {
  const out = new Map<string, AutomationStats>(ids.map((id) => [id, emptyStats()]));
  if (!ids.length) return out;
  const rows = await db
    .select({ automationId: automationRuns.automationId, status: automationRuns.status, n: sql<number>`count(*)::int` })
    .from(automationRuns)
    .where(inArray(automationRuns.automationId, ids))
    .groupBy(automationRuns.automationId, automationRuns.status);
  for (const r of rows) {
    const s = out.get(r.automationId) ?? emptyStats();
    s.total += r.n;
    if (r.status === "active" || r.status === "waiting") s.active += r.n;
    else s[r.status] += r.n;
    out.set(r.automationId, s);
  }
  return out;
}

/** Recent runs of an automation (for the Runs tab). */
export async function listRuns(automationId: string, opts: { status?: string; limit: number; offset: number }) {
  const where = and(
    eq(automationRuns.automationId, automationId),
    opts.status === "in_progress"
      ? inArray(automationRuns.status, ["active", "waiting"])
      : opts.status
        ? eq(automationRuns.status, opts.status as "completed")
        : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({
        run: automationRuns,
        contact: {
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          email: contacts.email,
        },
      })
      .from(automationRuns)
      .innerJoin(contacts, eq(contacts.id, automationRuns.contactId))
      .where(where)
      .orderBy(desc(automationRuns.startedAt))
      .limit(opts.limit)
      .offset(opts.offset),
    db.select({ n: sql<number>`count(*)::int` }).from(automationRuns).where(where),
  ]);
  return { rows, total: total?.n ?? 0 };
}

/** Recent log entries of an automation (for the Logs tab). */
export async function listLogs(automationId: string, opts: { status?: string; limit: number; offset: number }) {
  const where = and(
    eq(automationLogs.automationId, automationId),
    opts.status ? eq(automationLogs.status, opts.status as "ok") : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({
        log: automationLogs,
        contact: {
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          email: contacts.email,
        },
      })
      .from(automationLogs)
      .innerJoin(automationRuns, eq(automationRuns.id, automationLogs.runId))
      .innerJoin(contacts, eq(contacts.id, automationRuns.contactId))
      .where(where)
      .orderBy(desc(automationLogs.createdAt), desc(automationLogs.id))
      .limit(opts.limit)
      .offset(opts.offset),
    db.select({ n: sql<number>`count(*)::int` }).from(automationLogs).where(where),
  ]);
  return { rows, total: total?.n ?? 0 };
}
