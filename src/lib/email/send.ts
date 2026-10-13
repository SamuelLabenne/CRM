import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, type Contact } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings";
import { logActivity } from "@/lib/activity";
import { fullName } from "@/lib/format";
import { absoluteUrl, trackClickPath, trackOpenPath } from "@/lib/urls";
import type { MessageKind } from "@/lib/types";
import { applyMergeTags, type MergeContext } from "./merge-tags";
import { htmlToText, inlineEmailStyles, renderEmailLayout } from "./layout";
import { buildMergeContext } from "./context";
import { deliver, formatFrom } from "./providers";

export type SendEmailInput = {
  /** Recipient contact (preferred). */
  contactId?: string | null;
  contact?: Contact | null;
  /** Explicit address (internal notifications, test sends). Used when no contact is given. */
  to?: string;
  toName?: string | null;
  /** Subject and body may contain {{merge.tags}}. Body is editor HTML (no layout). */
  subject: string;
  html: string;
  preheader?: string | null;
  kind: MessageKind;
  /**
   * Marketing emails get an unsubscribe footer + List-Unsubscribe header and are
   * skipped for unsubscribed contacts. Defaults to true for broadcasts & automations.
   */
  marketing?: boolean;
  /** Pre-built merge context. Otherwise built from contact/event/attendee ids. */
  context?: MergeContext;
  eventId?: string | null;
  attendeeId?: string | null;
  broadcastId?: string | null;
  automationId?: string | null;
  templateId?: string | null;
  /** Override open/click tracking (defaults to the workspace setting). */
  track?: boolean;
  actorId?: string | null;
  /** Don't write a timeline activity (e.g. test sends). */
  silent?: boolean;
};

export type SendEmailResult =
  | { status: "sent" | "simulated"; messageId: string }
  | { status: "failed"; messageId: string; error: string }
  | { status: "skipped"; reason: string };

const NON_TRACKED = /^(mailto:|tel:|#|\{\{)/i;

function addTracking(html: string, messageId: string): string {
  const base = absoluteUrl("/");
  const withLinks = html.replace(/(<a\s[^>]*href=")([^"]+)("[^>]*>)/gi, (m, pre: string, href: string, post: string) => {
    const url = href.replace(/&amp;/g, "&");
    if (NON_TRACKED.test(url) || !/^https?:\/\//i.test(url)) return m;
    // Don't wrap unsubscribe links or our own tracking links.
    if (url.startsWith(base) && (/\/u\//.test(url) || /\/api\/(t|unsubscribe)\//.test(url))) return m;
    return `${pre}${absoluteUrl(trackClickPath(messageId, url)).replace(/&/g, "&amp;")}${post}`;
  });
  const pixel = `<img src="${absoluteUrl(trackOpenPath(messageId))}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;">`;
  return withLinks.includes("</body>") ? withLinks.replace("</body>", `${pixel}</body>`) : withLinks + pixel;
}

/**
 * Render (merge tags + layout + tracking), log and deliver one email.
 * Never throws for delivery problems – inspect the returned status.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const [emailCfg, workspace] = await Promise.all([getSetting("email"), getSetting("workspace")]);
  const marketing = input.marketing ?? (input.kind === "broadcast" || input.kind === "automation");

  let ctx = input.context;
  let contact = input.contact ?? null;
  if (!ctx) {
    const built = await buildMergeContext({
      contactId: input.contactId,
      contact,
      eventId: input.eventId,
      attendeeId: input.attendeeId,
    });
    ctx = built.ctx;
    contact = built.contact;
  } else if (!contact && input.contactId) {
    contact = (await buildMergeContext({ contactId: input.contactId })).contact;
  }

  const toEmail = contact?.email ?? input.to ?? null;
  if (!toEmail) return { status: "skipped", reason: "Recipient has no email address" };
  if (contact && contact.emailStatus !== "subscribed") {
    if (marketing || contact.emailStatus === "bounced" || contact.emailStatus === "complained") {
      return { status: "skipped", reason: `Contact is ${contact.emailStatus}` };
    }
  }

  const subject = applyMergeTags(input.subject, ctx, { html: false }).trim() || "(no subject)";
  const preheader = input.preheader ? applyMergeTags(input.preheader, ctx, { html: false }) : null;
  const body = inlineEmailStyles(applyMergeTags(input.html, ctx, { html: true }), workspace.brandColor);
  const unsubscribeUrl = marketing && typeof ctx.unsubscribe_url === "string" ? ctx.unsubscribe_url : null;
  let html = renderEmailLayout({
    bodyHtml: body,
    preheader,
    brandColor: workspace.brandColor,
    workspaceName: workspace.name,
    logoUrl: workspace.logoUrl,
    address: workspace.address,
    unsubscribeUrl,
  });
  const text = htmlToText(html);

  const [msg] = await db
    .insert(messages)
    .values({
      contactId: contact?.id ?? null,
      toEmail,
      toName: input.toName ?? (contact ? fullName(contact) : null),
      fromEmail: emailCfg.fromEmail,
      fromName: emailCfg.fromName,
      replyTo: emailCfg.replyTo,
      subject,
      html,
      text,
      kind: input.kind,
      broadcastId: input.broadcastId ?? null,
      automationId: input.automationId ?? null,
      eventId: input.eventId ?? null,
      templateId: input.templateId ?? null,
      status: "queued",
    })
    .returning({ id: messages.id });

  const track = input.track ?? emailCfg.tracking;
  if (track) html = addTracking(html, msg.id);

  const headers: Record<string, string> = {};
  if (unsubscribeUrl && contact) {
    headers["List-Unsubscribe"] = `<${absoluteUrl(`/api/unsubscribe/${contact.unsubscribeToken}`)}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  const result = await deliver(
    {
      from: formatFrom(emailCfg.fromName, emailCfg.fromEmail),
      to: toEmail,
      replyTo: emailCfg.replyTo,
      subject,
      html,
      text,
      headers,
    },
    emailCfg,
  );

  await db
    .update(messages)
    .set({
      html,
      status: result.status,
      provider: result.provider,
      providerMessageId: result.status === "sent" ? result.providerMessageId : null,
      error: result.status === "failed" ? result.error : null,
      sentAt: result.status === "failed" ? null : new Date(),
    })
    .where(eq(messages.id, msg.id));

  if (contact && !input.silent && result.status !== "failed") {
    await logActivity({
      contactId: contact.id,
      type: "email_sent",
      title: `Email: ${subject}`,
      meta: { messageId: msg.id, kind: input.kind, simulated: result.status === "simulated" },
      actorId: input.actorId ?? null,
      eventId: input.eventId ?? null,
    });
  }

  if (result.status === "failed") return { status: "failed", messageId: msg.id, error: result.error };
  return { status: result.status, messageId: msg.id };
}
