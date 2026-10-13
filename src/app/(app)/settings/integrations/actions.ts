"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, zodFail, type ActionResult } from "@/lib/action";
import { createApiKey, revokeApiKey } from "@/lib/api-keys";
import { randomToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import { webhooks } from "@/lib/db/schema";
import { processDueJobs } from "@/lib/jobs/runner";
import { deleteSampleData } from "@/lib/sample-data-cleanup";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";
import { uuid } from "../_lib/schemas";
import { retryFailedJobs } from "../_lib/system-status";
import { sendTestWebhook, validateWebhookUrl, type WebhookTestResult } from "../_lib/webhook-test";

const PATH = "/settings/integrations";
const newSecret = () => `whsec_${randomToken(24)}`;

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

const webhookSchema = z.object({
  url: z
    .string()
    .trim()
    .max(500)
    .superRefine((v, ctx) => {
      const problem = validateWebhookUrl(v);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
  /** Empty = all events. */
  events: z.array(z.enum(WEBHOOK_EVENTS)).max(WEBHOOK_EVENTS.length),
  isActive: z.boolean(),
});

export async function createWebhookAction(input: z.input<typeof webhookSchema>): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const parsed = webhookSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const [row] = await db.insert(webhooks).values({ ...parsed.data, events: [...new Set(parsed.data.events)], secret: newSecret() }).returning({ id: webhooks.id });
  revalidatePath(PATH);
  return ok({ id: row.id }, "Webhook created");
}

export async function updateWebhookAction(input: z.input<typeof webhookSchema> & { id: string }): Promise<ActionResult> {
  await requireAdmin();
  const parsed = webhookSchema.extend({ id: uuid }).safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const { id, ...rest } = parsed.data;
  const rows = await db.update(webhooks).set({ ...rest, events: [...new Set(rest.events)] }).where(eq(webhooks.id, id)).returning({ id: webhooks.id });
  if (!rows.length) return fail("That webhook no longer exists.");
  revalidatePath(PATH);
  return ok(undefined, "Webhook updated");
}

export async function toggleWebhookAction(input: { id: string; isActive: boolean }): Promise<ActionResult> {
  await requireAdmin();
  const parsed = z.object({ id: uuid, isActive: z.boolean() }).safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  await db.update(webhooks).set({ isActive: parsed.data.isActive }).where(eq(webhooks.id, parsed.data.id));
  revalidatePath(PATH);
  return ok(undefined, parsed.data.isActive ? "Webhook enabled" : "Webhook paused");
}

export async function deleteWebhookAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return fail("Invalid webhook");
  await db.delete(webhooks).where(eq(webhooks.id, parsed.data));
  revalidatePath(PATH);
  return ok(undefined, "Webhook deleted");
}

/** The signing secret is only fetched on demand (never in the page payload). */
export async function revealWebhookSecretAction(id: string): Promise<ActionResult<{ secret: string }>> {
  await requireAdmin();
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return fail("Invalid webhook");
  const [row] = await db.select({ secret: webhooks.secret }).from(webhooks).where(eq(webhooks.id, parsed.data));
  if (!row) return fail("That webhook no longer exists.");
  return ok({ secret: row.secret }, "");
}

export async function rotateWebhookSecretAction(id: string): Promise<ActionResult<{ secret: string }>> {
  await requireAdmin();
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return fail("Invalid webhook");
  const secret = newSecret();
  const rows = await db.update(webhooks).set({ secret }).where(eq(webhooks.id, parsed.data)).returning({ id: webhooks.id });
  if (!rows.length) return fail("That webhook no longer exists.");
  revalidatePath(PATH);
  return ok({ secret }, "New signing secret created. Update your endpoint to use it.");
}

export async function testWebhookAction(id: string): Promise<ActionResult<WebhookTestResult>> {
  await requireAdmin();
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return fail("Invalid webhook");
  const result = await sendTestWebhook(parsed.data);
  revalidatePath(PATH);
  return ok(result, "");
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export async function createApiKeyAction(input: { name: string }): Promise<ActionResult<{ key: string; name: string }>> {
  const user = await requireAdmin();
  const parsed = z.object({ name: z.string().trim().min(1, "Give the key a name").max(80) }).safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const { key, record } = await createApiKey({ name: parsed.data.name, createdById: user.id });
  revalidatePath(PATH);
  return ok({ key, name: record.name }, "");
}

export async function revokeApiKeyAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return fail("Invalid key");
  await revokeApiKey(parsed.data);
  revalidatePath(PATH);
  return ok(undefined, "API key revoked");
}

// ---------------------------------------------------------------------------
// System status & danger zone
// ---------------------------------------------------------------------------

export async function runJobsNowAction(): Promise<ActionResult<{ processed: number; failed: number }>> {
  await requireAdmin();
  const res = await processDueJobs({ maxBatches: 12 });
  revalidatePath(PATH);
  const msg = res.processed === 0 && res.failed === 0 ? "No jobs were due" : `Ran ${res.processed} job${res.processed === 1 ? "" : "s"}${res.failed ? `, ${res.failed} failed` : ""}`;
  return ok({ processed: res.processed, failed: res.failed }, msg);
}

export async function retryFailedJobsAction(): Promise<ActionResult> {
  await requireAdmin();
  const n = await retryFailedJobs();
  revalidatePath(PATH);
  return ok(undefined, n ? `${n} failed job${n === 1 ? "" : "s"} queued again` : "No failed jobs");
}

export async function deleteSampleDataAction(): Promise<ActionResult<{ removed: Record<string, number> }>> {
  await requireAdmin();
  try {
    const removed = await deleteSampleData();
    const total = Object.values(removed).reduce((a, b) => a + b, 0);
    for (const p of ["/", "/contacts", "/events", "/campaigns", "/emails", "/automations", "/scheduling", "/meetings", "/tasks", "/pipeline", "/dashboard", "/calendar", "/reports", PATH]) revalidatePath(p, p === "/" ? "layout" : "page");
    return ok({ removed }, total ? `Sample data deleted (${total} items)` : "There was no sample data to delete");
  } catch (err) {
    console.error("[settings] delete sample data failed", err);
    return fail("Could not delete the sample data. Nothing was changed.");
  }
}
