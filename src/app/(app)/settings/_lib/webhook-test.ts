import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { webhooks } from "@/lib/db/schema";
import { hmac } from "@/lib/crypto";

export type WebhookTestResult = {
  ok: boolean;
  /** HTTP status, or null when the request never got a response. */
  status: number | null;
  error?: string;
  durationMs: number;
};

export function validateWebhookUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "The URL must start with http:// or https://";
    return null;
  } catch {
    return "Enter a valid URL, e.g. https://example.com/hooks/relay";
  }
}

/**
 * POST a signed `webhook.test` payload to a webhook and record the status
 * (lastDeliveryAt / lastStatus), exactly like a real delivery. Never throws for network errors.
 */
export async function sendTestWebhook(
  webhookId: string,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<WebhookTestResult> {
  const [hook] = await db.select().from(webhooks).where(eq(webhooks.id, webhookId));
  if (!hook) return { ok: false, status: null, error: "Webhook not found", durationMs: 0 };
  const doFetch = deps.fetchImpl ?? fetch;
  const body = JSON.stringify({
    event: "webhook.test",
    data: { message: "This is a test event from Relay. Your endpoint is receiving webhooks correctly." },
    sentAt: new Date().toISOString(),
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const started = Date.now();
  let result: WebhookTestResult;
  try {
    const res = await doFetch(hook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Relay-Webhooks/1.0",
        "x-relay-event": "webhook.test",
        "x-relay-timestamp": timestamp,
        "x-relay-signature": hmac(`${timestamp}.${body}`, hook.secret),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    result = {
      ok: res.ok,
      status: res.status,
      error: res.ok ? undefined : `Endpoint responded ${res.status}`,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    result = {
      ok: false,
      status: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
  await db
    .update(webhooks)
    .set({ lastDeliveryAt: new Date(), lastStatus: result.status ?? 0 })
    .where(eq(webhooks.id, hook.id));
  return result;
}
