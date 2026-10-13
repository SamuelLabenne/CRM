"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, zodFail, type ActionResult } from "@/lib/action";
import { encryptSecret } from "@/lib/crypto";
import { getSetting, setSetting } from "@/lib/settings";
import { sendEmail } from "@/lib/email/send";
import { escapeHtml } from "@/lib/email/merge-tags";
import { formatDateTime } from "@/lib/format";

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address");

const emailSchema = z.object({
  provider: z.enum(["outbox", "resend", "smtp"]),
  fromName: z.string().trim().min(1, "Enter a sender name").max(100),
  fromEmail: z.string().trim().toLowerCase().email("Enter a valid sender email"),
  replyTo: optionalEmail,
  tracking: z.boolean(),
  /** Blank = keep the stored key. */
  resendApiKey: z.string().trim().max(300).default(""),
  smtp: z.object({
    host: z.string().trim().max(200),
    port: z.coerce.number().int("Enter a port number").min(1, "Enter a port number").max(65535, "Enter a port number"),
    secure: z.boolean(),
    user: z.string().trim().max(200),
    /** Blank = keep the stored password. */
    password: z.string().max(500).default(""),
  }),
});

export type EmailSettingsInput = z.input<typeof emailSchema>;

export async function saveEmailSettingsAction(input: EmailSettingsInput): Promise<ActionResult> {
  await requireAdmin();
  const parsed = emailSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const d = parsed.data;
  const current = await getSetting("email");

  const resendApiKey = d.resendApiKey ? encryptSecret(d.resendApiKey) : current.resendApiKey;
  if (d.provider === "resend" && !resendApiKey && !process.env.RESEND_API_KEY) {
    return fail("Add your Resend API key to send with Resend.", { resendApiKey: ["Add your Resend API key"] });
  }
  if (d.provider === "smtp" && !d.smtp.host) {
    return fail("Enter your SMTP host.", { "smtp.host": ["Enter your SMTP host"] });
  }
  const smtp = d.smtp.host
    ? {
        host: d.smtp.host,
        port: d.smtp.port,
        secure: d.smtp.secure,
        user: d.smtp.user,
        password: d.smtp.password ? encryptSecret(d.smtp.password) : (current.smtp?.password ?? null),
      }
    : null;

  await setSetting("email", {
    provider: d.provider,
    fromName: d.fromName,
    fromEmail: d.fromEmail,
    replyTo: d.replyTo || null,
    tracking: d.tracking,
    resendApiKey,
    smtp,
  });
  revalidatePath("/settings/email");
  return ok(undefined, "Email settings saved");
}

export type TestEmailResult = {
  status: "sent" | "simulated" | "failed" | "skipped";
  to: string;
  provider: string;
  error?: string;
  messageId?: string;
};

/** Sends a test email to the signed-in admin using the *saved* settings. */
export async function sendTestEmailAction(): Promise<ActionResult<TestEmailResult>> {
  const me = await requireAdmin();
  const [cfg, workspace] = await Promise.all([getSetting("email"), getSetting("workspace")]);
  const html = `<h2>It works!</h2>
<p>This is a test email from <strong>${escapeHtml(workspace.name)}</strong>, sent at ${escapeHtml(formatDateTime(new Date(), workspace.timezone))}.</p>
<p>Sending method: <strong>${escapeHtml(cfg.provider === "outbox" ? "Outbox (simulated)" : cfg.provider === "resend" ? "Resend" : "SMTP")}</strong><br>From: ${escapeHtml(cfg.fromName)} &lt;${escapeHtml(cfg.fromEmail)}&gt;</p>`;
  const res = await sendEmail({
    to: me.email,
    toName: me.name,
    kind: "test",
    silent: true,
    track: false,
    subject: `Test email from ${workspace.name}`,
    html,
    actorId: me.id,
  });
  revalidatePath("/settings/email");
  if (res.status === "skipped") return fail(res.reason);
  return ok({
    status: res.status,
    to: me.email,
    provider: cfg.provider,
    messageId: res.status === "failed" || res.status === "sent" || res.status === "simulated" ? res.messageId : undefined,
    error: res.status === "failed" ? res.error : undefined,
  }, "");
}
