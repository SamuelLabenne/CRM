import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { setupTestDb } from "@/test/setup-db";

const { db } = await setupTestDb();
const { contacts, messages } = await import("@/lib/db/schema");
const { upsertContact } = await import("@/lib/contacts");
const { handleResendEvent, verifySvixSignature } = await import("./resend-webhook");

const secret = `whsec_${Buffer.from("super-secret-key-material").toString("base64")}`;
function sign(body: string, id = "msg_1", ts = Math.floor(Date.now() / 1000)) {
  const key = Buffer.from(secret.slice(6), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return { id, timestamp: String(ts), signature: `v1,${sig}` };
}

async function makeMessage(email: string, providerMessageId: string) {
  const { contact } = await upsertContact({ email, firstName: "Test" }, { source: "manual" });
  const [m] = await db
    .insert(messages)
    .values({ contactId: contact.id, toEmail: email, fromEmail: "hello@x.com", subject: "Hello", html: "<p>hi</p>", status: "sent", provider: "resend", providerMessageId })
    .returning();
  return { contact, message: m };
}

describe("verifySvixSignature", () => {
  it("accepts valid signatures and rejects tampering, wrong secrets and stale timestamps", () => {
    const body = JSON.stringify({ type: "email.bounced" });
    const h = sign(body);
    expect(verifySvixSignature(body, h, secret)).toBe(true);
    expect(verifySvixSignature(body + " ", h, secret)).toBe(false);
    expect(verifySvixSignature(body, h, `whsec_${Buffer.from("other").toString("base64")}`)).toBe(false);
    expect(verifySvixSignature(body, { ...h, signature: `v1,bogus ${h.signature}` }, secret)).toBe(true); // rotation
    const old = sign(body, "msg_2", Math.floor(Date.now() / 1000) - 3600);
    expect(verifySvixSignature(body, old, secret)).toBe(false);
    expect(verifySvixSignature(body, { id: null, timestamp: null, signature: null }, secret)).toBe(false);
  });
});

describe("handleResendEvent", () => {
  it("marks hard bounces as undeliverable but not temporary ones", async () => {
    const hard = await makeMessage("hard@bounce.test", "re_hard");
    expect(await handleResendEvent({ type: "email.bounced", data: { email_id: "re_hard", bounce: { type: "Permanent", message: "No such user" } } })).toContain("bounced");
    const [c1] = await db.select().from(contacts).where(eq(contacts.id, hard.contact.id));
    const [m1] = await db.select().from(messages).where(eq(messages.id, hard.message.id));
    expect(c1.emailStatus).toBe("bounced");
    expect(m1.status).toBe("bounced");

    const soft = await makeMessage("soft@bounce.test", "re_soft");
    await handleResendEvent({ type: "email.bounced", data: { email_id: "re_soft", bounce: { type: "Transient" } } });
    const [c2] = await db.select().from(contacts).where(eq(contacts.id, soft.contact.id));
    expect(c2.emailStatus).toBe("subscribed");
  });

  it("stops email after a spam complaint and ignores unknown messages", async () => {
    const { contact } = await makeMessage("spam@complain.test", "re_spam");
    await handleResendEvent({ type: "email.complained", data: { email_id: "re_spam" } });
    const [c] = await db.select().from(contacts).where(eq(contacts.id, contact.id));
    expect(c.emailStatus).toBe("complained");
    expect(await handleResendEvent({ type: "email.bounced", data: { email_id: "re_unknown" } })).toBe("ignored: unknown message");
  });
});
