import nodemailer from "nodemailer";
import { decryptSecret } from "@/lib/crypto";
import type { EmailSettings } from "@/lib/settings";

export type OutgoingEmail = {
  from: string;
  to: string;
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
};

export type SendResult =
  | { status: "sent"; provider: string; providerMessageId: string | null }
  | { status: "simulated"; provider: "outbox"; providerMessageId: null }
  | { status: "failed"; provider: string; error: string };

export function formatFrom(name: string, email: string) {
  const clean = name.replace(/["<>]/g, "").trim();
  return clean ? `"${clean}" <${email}>` : email;
}

/** Deliver one email with the configured provider. Never throws. */
export async function deliver(email: OutgoingEmail, cfg: EmailSettings): Promise<SendResult> {
  try {
    if (cfg.provider === "resend") {
      const key = decryptSecret(cfg.resendApiKey) ?? process.env.RESEND_API_KEY;
      if (!key) return { status: "failed", provider: "resend", error: "Resend API key missing" };
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: email.from,
          to: [email.to],
          reply_to: email.replyTo ?? undefined,
          subject: email.subject,
          html: email.html,
          text: email.text,
          headers: email.headers,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) return { status: "failed", provider: "resend", error: body.message ?? `HTTP ${res.status}` };
      return { status: "sent", provider: "resend", providerMessageId: body.id ?? null };
    }
    if (cfg.provider === "smtp") {
      if (!cfg.smtp?.host) return { status: "failed", provider: "smtp", error: "SMTP is not configured" };
      const transport = nodemailer.createTransport({
        host: cfg.smtp.host,
        port: cfg.smtp.port,
        secure: cfg.smtp.secure,
        auth: cfg.smtp.user ? { user: cfg.smtp.user, pass: decryptSecret(cfg.smtp.password) ?? "" } : undefined,
      });
      const info = await transport.sendMail({
        from: email.from,
        to: email.to,
        replyTo: email.replyTo ?? undefined,
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers: email.headers,
      });
      return { status: "sent", provider: "smtp", providerMessageId: info.messageId ?? null };
    }
    // Outbox mode: nothing leaves the system; the message is visible in Emails → Outbox.
    return { status: "simulated", provider: "outbox", providerMessageId: null };
  } catch (err) {
    return { status: "failed", provider: cfg.provider, error: err instanceof Error ? err.message : String(err) };
  }
}
