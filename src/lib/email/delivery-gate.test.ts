import { describe, expect, it } from "vitest";
import { setupTestDb, createTestUser } from "@/test/setup-db";

const { db } = await setupTestDb();
const { messages } = await import("@/lib/db/schema");
const { deliveryBlockReason } = await import("./send");
const { DEFAULT_SETTINGS } = await import("@/lib/settings");

const base = { ...DEFAULT_SETTINGS.email, provider: "resend" as const };

describe("deliveryBlockReason", () => {
  it("never blocks in outbox mode", async () => {
    expect(await deliveryBlockReason("anyone@x.io", { ...base, provider: "outbox", testMode: true })).toBeNull();
  });

  it("test mode only lets team members and test recipients through", async () => {
    await createTestUser({ email: "owner@team.io" });
    const cfg = { ...base, testMode: true, testRecipients: ["Friend@Test.io"] };
    expect(await deliveryBlockReason("owner@team.io", cfg)).toBeNull();
    expect(await deliveryBlockReason("friend@test.io", cfg)).toBeNull();
    expect(await deliveryBlockReason("lead@customer.io", cfg)).toMatch(/Test mode/);
    expect(await deliveryBlockReason("lead@customer.io", { ...cfg, testMode: false })).toBeNull();
  });

  it("enforces the rolling daily limit on real sends only", async () => {
    const row = { toEmail: "a@x.io", fromEmail: "f@x.io", subject: "s", html: "h", sentAt: new Date() };
    await db.insert(messages).values([
      { ...row, status: "sent", provider: "resend" },
      { ...row, status: "sent", provider: "resend" },
      { ...row, status: "simulated", provider: "outbox" },
      { ...row, status: "sent", provider: "resend", sentAt: new Date(Date.now() - 2 * 864e5) },
    ]);
    expect(await deliveryBlockReason("a@x.io", { ...base, dailyLimit: 3 })).toBeNull();
    expect(await deliveryBlockReason("a@x.io", { ...base, dailyLimit: 2 })).toMatch(/Daily sending limit/);
  });
});
