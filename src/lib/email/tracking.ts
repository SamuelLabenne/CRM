import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, emailEvents, messages } from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { emitTrigger } from "@/lib/automations/triggers";
import { emitWebhook } from "@/lib/webhooks";

const UUID = /^[0-9a-f-]{36}$/i;

export async function recordOpen(messageId: string) {
  if (!UUID.test(messageId)) return;
  const [msg] = await db
    .update(messages)
    .set({ openCount: sql`${messages.openCount} + 1`, openedAt: sql`coalesce(${messages.openedAt}, now())` })
    .where(eq(messages.id, messageId))
    .returning();
  if (!msg) return;
  await db.insert(emailEvents).values({ messageId, type: "open" });
  if (msg.openCount === 1 && msg.contactId) {
    await logActivity({ contactId: msg.contactId, type: "email_opened", title: `Opened “${msg.subject}”`, meta: { messageId } });
  }
}

export async function recordClick(messageId: string, url: string) {
  if (!UUID.test(messageId)) return;
  const [msg] = await db
    .update(messages)
    .set({
      clickCount: sql`${messages.clickCount} + 1`,
      clickedAt: sql`coalesce(${messages.clickedAt}, now())`,
      // A click implies an open (images may be blocked).
      openedAt: sql`coalesce(${messages.openedAt}, now())`,
    })
    .where(eq(messages.id, messageId))
    .returning();
  if (!msg) return;
  await db.insert(emailEvents).values({ messageId, type: "click", url });
  if (msg.contactId) {
    await logActivity({ contactId: msg.contactId, type: "email_clicked", title: `Clicked a link in “${msg.subject}”`, meta: { messageId, url } });
    await emitTrigger("email_clicked", msg.contactId, { messageId, url });
  }
}

/** Unsubscribe a contact by their unsubscribe token. Returns the contact or null. */
export async function unsubscribeByToken(token: string) {
  const [c] = await db.select().from(contacts).where(eq(contacts.unsubscribeToken, token));
  if (!c) return null;
  if (c.emailStatus === "unsubscribed") return c;
  const [updated] = await db
    .update(contacts)
    .set({ emailStatus: "unsubscribed", unsubscribedAt: new Date() })
    .where(eq(contacts.id, c.id))
    .returning();
  await logActivity({ contactId: c.id, type: "unsubscribed", title: "Unsubscribed from marketing emails" });
  await emitWebhook("email.unsubscribed", { contactId: c.id, email: c.email });
  return updated;
}

/** Re-subscribe (from the preferences page). */
export async function resubscribeByToken(token: string) {
  const [c] = await db.select().from(contacts).where(eq(contacts.unsubscribeToken, token));
  if (!c) return null;
  const [updated] = await db
    .update(contacts)
    .set({ emailStatus: "subscribed", unsubscribedAt: null })
    .where(eq(contacts.id, c.id))
    .returning();
  await logActivity({ contactId: c.id, type: "contact_updated", title: "Re-subscribed to marketing emails" });
  return updated;
}
