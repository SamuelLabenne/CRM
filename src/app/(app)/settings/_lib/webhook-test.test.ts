import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "@/test/setup-db";

const { db } = await setupTestDb();
const { webhooks } = await import("@/lib/db/schema");
const { hmac } = await import("@/lib/crypto");
const { sendTestWebhook, validateWebhookUrl } = await import("./webhook-test");

async function makeHook(url = "https://example.com/hook") {
  const [h] = await db.insert(webhooks).values({ url, secret: "whsec_test", events: [] }).returning();
  return h;
}

describe("sendTestWebhook", () => {
  it("POSTs a signed webhook.test payload and records the status", async () => {
    const hook = await makeHook();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const res = await sendTestWebhook(hook.id, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res).toMatchObject({ ok: true, status: 204 });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://example.com/hook");
    expect(init.method).toBe("POST");
    expect(init.headers["x-relay-event"]).toBe("webhook.test");
    const body = init.body as string;
    expect(JSON.parse(body).event).toBe("webhook.test");
    expect(init.headers["x-relay-signature"]).toBe(hmac(`${init.headers["x-relay-timestamp"]}.${body}`, "whsec_test"));
    const [row] = await db.select().from(webhooks).where(eq(webhooks.id, hook.id));
    expect(row.lastStatus).toBe(204);
    expect(row.lastDeliveryAt).toBeTruthy();
  });

  it("reports non-2xx responses and network errors without throwing", async () => {
    const hook = await makeHook();
    const bad = await sendTestWebhook(hook.id, { fetchImpl: (async () => new Response("no", { status: 500 })) as unknown as typeof fetch });
    expect(bad).toMatchObject({ ok: false, status: 500 });
    expect(bad.error).toMatch(/500/);
    const down = await sendTestWebhook(hook.id, {
      fetchImpl: (async () => {
        throw new Error("connect ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    expect(down).toMatchObject({ ok: false, status: null });
    expect(down.error).toMatch(/ECONNREFUSED/);
    const [row] = await db.select().from(webhooks).where(eq(webhooks.id, hook.id));
    expect(row.lastStatus).toBe(0);
    expect(await sendTestWebhook("00000000-0000-4000-8000-000000000000")).toMatchObject({ ok: false, error: "Webhook not found" });
  });

  it("validates URLs", () => {
    expect(validateWebhookUrl("https://example.com/x")).toBeNull();
    expect(validateWebhookUrl("http://localhost:3000/x")).toBeNull();
    expect(validateWebhookUrl("ftp://example.com")).toMatch(/http/);
    expect(validateWebhookUrl("nonsense")).toMatch(/valid URL/);
  });
});
