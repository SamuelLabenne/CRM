import { eq } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";
import { webhooks } from "@/lib/db/schema";
import { enqueueJob } from "@/lib/jobs/queue";
import { hmac } from "@/lib/crypto";
import type { JobHandler } from "@/lib/jobs/handlers";

/** Outgoing webhook event names. */
export const WEBHOOK_EVENTS = [
  "contact.created",
  "contact.updated",
  "registration.created",
  "registration.cancelled",
  "attendance.recorded",
  "meeting.booked",
  "meeting.cancelled",
  "meeting.outcome",
  "lead.potential",
  "email.unsubscribed",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Queue delivery of `event` to every active webhook subscribed to it. */
export async function emitWebhook(event: WebhookEvent, data: Record<string, unknown>, tx: Tx = db) {
  const hooks = await tx.select().from(webhooks).where(eq(webhooks.isActive, true));
  for (const hook of hooks) {
    if (hook.events.length && !hook.events.includes(event)) continue;
    await enqueueJob(
      "webhook.deliver",
      { webhookId: hook.id, event, data, emittedAt: new Date().toISOString() },
      { maxAttempts: 5 },
      tx,
    );
  }
}

export const webhookJobHandlers: Record<string, JobHandler> = {
  "webhook.deliver": async (payload) => {
    const [hook] = await db.select().from(webhooks).where(eq(webhooks.id, String(payload.webhookId)));
    if (!hook || !hook.isActive) return;
    const body = JSON.stringify({ event: payload.event, data: payload.data, sentAt: payload.emittedAt });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const res = await fetch(hook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Relay-Webhooks/1.0",
        "x-relay-event": String(payload.event),
        "x-relay-timestamp": timestamp,
        // Verify with: HMAC-SHA256(secret, `${timestamp}.${rawBody}`) base64url
        "x-relay-signature": hmac(`${timestamp}.${body}`, hook.secret),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    }).catch((err: unknown) => {
      throw new Error(`Webhook request failed: ${err instanceof Error ? err.message : String(err)}`);
    });
    await db
      .update(webhooks)
      .set({ lastDeliveryAt: new Date(), lastStatus: res.status })
      .where(eq(webhooks.id, hook.id));
    if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
  },
};
