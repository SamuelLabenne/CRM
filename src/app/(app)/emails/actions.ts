"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, ok, zodFail, type ActionResult } from "@/lib/action";
import { getSetting } from "@/lib/settings";
import { kickJobs } from "@/lib/jobs/kick";
import { broadcastInputSchema, templateInputSchema } from "@/lib/email/schemas";
import { parseZonedLocal } from "@/lib/email/schedule";
import {
  BroadcastError,
  cancelBroadcast,
  deleteBroadcast,
  duplicateBroadcast,
  queueBroadcast,
  saveBroadcast,
} from "@/lib/email/broadcasts";
import { TemplateError, deleteTemplate, duplicateTemplate, resetSystemTemplate, saveTemplate } from "@/lib/email/templates";

const idSchema = z.string().uuid("Invalid id");

function refresh(...paths: string[]) {
  revalidatePath("/emails");
  for (const p of paths) revalidatePath(p);
}

async function guard<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof BroadcastError || err instanceof TemplateError) return fail(err.message);
    // Next.js control-flow errors (redirect/notFound) must propagate.
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export async function saveTemplateAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = templateInputSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  return guard(async () => {
    const t = await saveTemplate(parsed.data, user.id);
    refresh(`/emails/templates/${t.id}`);
    return ok({ id: t.id }, parsed.data.id ? "Template saved" : "Template created");
  });
}

export async function duplicateTemplateAction(id: string): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return fail("Invalid template");
  return guard(async () => {
    const t = await duplicateTemplate(parsed.data, user.id);
    refresh();
    return ok({ id: t.id }, "Template duplicated");
  });
}

export async function deleteTemplateAction(id: string): Promise<ActionResult> {
  await requireUser();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return fail("Invalid template");
  return guard(async () => {
    await deleteTemplate(parsed.data);
    refresh();
    return ok(undefined, "Template deleted");
  });
}

export async function resetTemplateAction(
  id: string,
): Promise<ActionResult<{ name: string; subject: string; preheader: string; html: string }>> {
  await requireUser();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return fail("Invalid template");
  return guard(async () => {
    const t = await resetSystemTemplate(parsed.data);
    refresh(`/emails/templates/${t.id}`);
    return ok({ name: t.name, subject: t.subject, preheader: t.preheader ?? "", html: t.contentHtml }, "Template reset to default");
  });
}

// ---------------------------------------------------------------------------
// Broadcasts
// ---------------------------------------------------------------------------

export async function saveBroadcastAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = broadcastInputSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  return guard(async () => {
    const b = await saveBroadcast(parsed.data, user.id);
    refresh(`/emails/broadcasts/${b.id}`);
    return ok({ id: b.id }, "Draft saved");
  });
}

const sendSchema = z.object({
  broadcast: broadcastInputSchema,
  /** `<input type="datetime-local">` value in the workspace timezone; null = send now. */
  schedule: z.string().nullable(),
});

/** Save the broadcast, then send it now or schedule it. */
export async function sendBroadcastAction(
  input: unknown,
): Promise<ActionResult<{ id: string; status: "scheduled" | "sending"; scheduledAt: string | null }>> {
  const user = await requireUser();
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const { broadcast, schedule } = parsed.data;
  let scheduledAt: Date | null = null;
  if (schedule) {
    const { timezone } = await getSetting("workspace");
    scheduledAt = parseZonedLocal(schedule, timezone);
    if (!scheduledAt) return fail("Enter a valid date and time to schedule the send.");
  }
  return guard(async () => {
    const saved = await saveBroadcast(broadcast, user.id);
    const queued = await queueBroadcast(saved.id, { scheduledAt });
    if (!scheduledAt) kickJobs();
    refresh(`/emails/broadcasts/${saved.id}`);
    return ok(
      { id: saved.id, status: queued.status as "scheduled" | "sending", scheduledAt: queued.scheduledAt?.toISOString() ?? null },
      scheduledAt ? "Broadcast scheduled" : "Broadcast is sending",
    );
  });
}

export async function cancelBroadcastAction(id: string): Promise<ActionResult> {
  await requireUser();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return fail("Invalid broadcast");
  return guard(async () => {
    const b = await cancelBroadcast(parsed.data);
    refresh(`/emails/broadcasts/${b.id}`);
    return ok(undefined, "Broadcast cancelled");
  });
}

export async function duplicateBroadcastAction(id: string): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return fail("Invalid broadcast");
  return guard(async () => {
    const b = await duplicateBroadcast(parsed.data, user.id);
    refresh();
    return ok({ id: b.id }, "Broadcast duplicated");
  });
}

export async function deleteBroadcastAction(id: string): Promise<ActionResult> {
  await requireUser();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return fail("Invalid broadcast");
  return guard(async () => {
    await deleteBroadcast(parsed.data);
    refresh();
    return ok(undefined, "Broadcast deleted");
  });
}
