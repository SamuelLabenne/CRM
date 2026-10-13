"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { count, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { automationRuns, contacts, savedViews } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { fail, ok, zodFail, type ActionResult } from "@/lib/action";
import { kickJobs } from "@/lib/jobs/kick";
import { buildContactWhere } from "@/lib/contacts/filters";
import { cancelRun } from "@/lib/automations/engine";
import { createAutomationFromRecipe, createBlankAutomation } from "@/lib/automations/recipes";
import { automationInputSchema, toSteps, toTrigger } from "@/lib/automations/schema";
import {
  deleteAutomation,
  describeEnrollSummary,
  duplicateAutomation,
  enrollContacts,
  retryRun,
  saveAutomation,
  setAutomationStatus,
} from "@/lib/automations/service";
import type { AutomationStatus } from "@/lib/types";

const uuid = z.string().uuid();

function revalidate(id?: string) {
  revalidatePath("/automations");
  if (id) revalidatePath(`/automations/${id}`);
}

function issuesToFieldErrors(issues: { stepId?: string; field: string; message: string }[]) {
  const out: Record<string, string[]> = {};
  for (const i of issues) (out[i.stepId ?? i.field] ??= []).push(i.message);
  return out;
}

/** Save the whole automation from the builder (create-or-update, optionally changing status). */
export async function saveAutomationAction(
  input: unknown,
): Promise<ActionResult<{ id: string; status: AutomationStatus; updatedAt: string }>> {
  const user = await requireUser();
  const parsed = automationInputSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const data = parsed.data;
  const res = await saveAutomation(
    { ...data, trigger: toTrigger(data.trigger), steps: toSteps(data.steps) },
    { userId: user.id },
  );
  if (!res.ok) return fail(res.error, issuesToFieldErrors(res.issues));
  revalidate(res.automation.id);
  if (res.automation.status === "active") kickJobs();
  return ok(
    { id: res.automation.id, status: res.automation.status, updatedAt: res.automation.updatedAt.toISOString() },
    res.automation.status === "active" ? "Saved – automation is live" : "Saved",
  );
}

/** Quick status change from the list page. */
export async function setAutomationStatusAction(id: string, status: AutomationStatus): Promise<ActionResult<{ status: AutomationStatus }>> {
  await requireUser();
  if (!uuid.safeParse(id).success || !["draft", "active", "paused"].includes(status)) return fail("Invalid request");
  const res = await setAutomationStatus(id, status);
  if (!res.ok) return fail(res.error, issuesToFieldErrors(res.issues));
  revalidate(id);
  if (status === "active") kickJobs();
  return ok({ status: res.automation.status });
}

export async function deleteAutomationAction(id: string): Promise<ActionResult> {
  await requireUser();
  if (!uuid.safeParse(id).success) return fail("Invalid request");
  await deleteAutomation(id);
  revalidate();
  return ok(undefined, "Automation deleted");
}

export async function duplicateAutomationAction(id: string): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  if (!uuid.safeParse(id).success) return fail("Invalid request");
  const copy = await duplicateAutomation(id, user.id);
  if (!copy) return fail("Automation not found");
  revalidate();
  return ok({ id: copy.id }, "Automation duplicated as a draft");
}

/** Used as `<form action={createFromRecipeAction.bind(null, recipeId)}>`. */
export async function createFromRecipeAction(recipeId: string): Promise<void> {
  const user = await requireUser();
  const automation = await createAutomationFromRecipe(recipeId, { userId: user.id });
  revalidate();
  redirect(`/automations/${automation.id}`);
}

export async function createBlankAutomationAction(): Promise<void> {
  const user = await requireUser();
  const automation = await createBlankAutomation({ userId: user.id });
  revalidate();
  redirect(`/automations/${automation.id}`);
}

const enrollSchema = z.object({
  automationId: z.string().uuid(),
  contactIds: z.array(z.string().uuid()).max(500).optional(),
  viewId: z.string().uuid().nullish(),
  eventId: z.string().uuid().nullish(),
});

export async function enrollContactsAction(input: unknown): Promise<ActionResult<{ enrolled: number }>> {
  const user = await requireUser();
  const parsed = enrollSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const { automationId, contactIds, viewId, eventId } = parsed.data;
  if (!contactIds?.length && !viewId) return fail("Pick at least one contact or a smart view");
  try {
    const summary = await enrollContacts({ automationId, contactIds, viewId, eventId, actorId: user.id });
    revalidate(automationId);
    kickJobs();
    const message = describeEnrollSummary(summary);
    if (!summary.enrolled) return fail(message);
    return ok({ enrolled: summary.enrolled }, message);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not enroll contacts");
  }
}

/** How many contacts a smart view would enroll (shown in the enrol dialog). */
export async function countViewContactsAction(viewId: string): Promise<ActionResult<{ count: number }>> {
  await requireUser();
  if (!uuid.safeParse(viewId).success) return fail("Invalid view");
  const [view] = await db.select().from(savedViews).where(eq(savedViews.id, viewId));
  if (!view) return fail("Smart view not found");
  const [row] = await db.select({ n: count() }).from(contacts).where(buildContactWhere(view.filters));
  return ok({ count: Number(row?.n ?? 0) });
}

export async function cancelRunAction(runId: string): Promise<ActionResult> {
  await requireUser();
  if (!uuid.safeParse(runId).success) return fail("Invalid request");
  const done = await cancelRun(runId, { reason: "Cancelled by a teammate" });
  if (!done) return fail("This run has already finished");
  const [run] = await db.select({ automationId: automationRuns.automationId }).from(automationRuns).where(eq(automationRuns.id, runId));
  revalidate(run?.automationId);
  return ok(undefined, "Run cancelled");
}

export async function retryRunAction(runId: string): Promise<ActionResult> {
  await requireUser();
  if (!uuid.safeParse(runId).success) return fail("Invalid request");
  const done = await retryRun(runId);
  if (!done) return fail("Only failed runs can be retried");
  const [run] = await db.select({ automationId: automationRuns.automationId }).from(automationRuns).where(eq(automationRuns.id, runId));
  revalidate(run?.automationId);
  kickJobs();
  return ok(undefined, "Retrying the failed step");
}
