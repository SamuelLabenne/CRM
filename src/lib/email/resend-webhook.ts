import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, emailEvents, messages } from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { safeEqual } from "@/lib/crypto";

// Resend delivery webhooks (signed with Svix). Keeps the outbox in sync and protects sender
// reputation: hard bounces and spam complaints stop all further email to that contact.

const TOLERANCE_SECONDS = 5 * 60;

/** Verify a Svix-signed request. `secret` is the "whsec_…" signing secret from Resend. */
export function verifySvixSignature(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
  // Header looks like "v1,<sig> v1,<sig2>" (several during secret rotation).
  return signature
    .split(" ")
    .map((part) => part.split(",")[1] ?? "")
    .some((sig) => sig && safeEqual(sig, expected));
}

export type ResendWebhookEvent = {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[];
    subject?: string;
    bounce?: { type?: string; subType?: string; message?: string };
    failed?: { reason?: string };
    suppressed?: { type?: string; message?: string };
  };
};

/** Apply a verified Resend event. Returns a short description (for logs/tests). */
export async function handleResendEvent(evt: ResendWebhookEvent): Promise<string> {
  const emailId = evt.data?.email_id;
  if (!emailId) return "ignored: no email id";
  const [msg] = await db.select().from(messages).where(eq(messages.providerMessageId, emailId));
  if (!msg) return "ignored: unknown message";

  const contactId = msg.contactId;
  switch (evt.type) {
    case "email.bounced": {
      const bounceType = evt.data?.bounce?.type ?? "Permanent";
      const reason = evt.data?.bounce?.message ?? evt.data?.bounce?.subType ?? "Bounced";
      await db.update(messages).set({ status: "bounced", error: reason.slice(0, 500) }).where(eq(messages.id, msg.id));
      await db.insert(emailEvents).values({ messageId: msg.id, type: "bounce" });
      // Only hard bounces block future email; temporary ones (mailbox full…) may succeed later.
      if (contactId && bounceType !== "Transient") {
        await db.update(contacts).set({ emailStatus: "bounced" }).where(eq(contacts.id, contactId));
        await logActivity({ contactId, type: "contact_updated", title: "Email bounced – address marked as undeliverable", body: reason, meta: { messageId: msg.id } });
      }
      return `bounced (${bounceType})`;
    }
    case "email.complained": {
      await db.insert(emailEvents).values({ messageId: msg.id, type: "complaint" });
      if (contactId) {
        await db.update(contacts).set({ emailStatus: "complained", unsubscribedAt: new Date() }).where(eq(contacts.id, contactId));
        await logActivity({ contactId, type: "unsubscribed", title: `Marked “${msg.subject}” as spam – no more marketing email`, meta: { messageId: msg.id } });
      }
      return "complained";
    }
    case "email.failed": {
      await db
        .update(messages)
        .set({ status: "failed", error: (evt.data?.failed?.reason ?? "Delivery failed").slice(0, 500) })
        .where(eq(messages.id, msg.id));
      return "failed";
    }
    case "email.suppressed": {
      await db
        .update(messages)
        .set({ status: "failed", error: `Suppressed by Resend: ${evt.data?.suppressed?.message ?? evt.data?.suppressed?.type ?? "address on suppression list"}`.slice(0, 500) })
        .where(eq(messages.id, msg.id));
      if (contactId) await db.update(contacts).set({ emailStatus: "bounced" }).where(eq(contacts.id, contactId));
      return "suppressed";
    }
    default:
      return `ignored: ${evt.type}`;
  }
}
