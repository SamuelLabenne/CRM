import { NextResponse, type NextRequest } from "next/server";
import { handleResendEvent, verifySvixSignature, type ResendWebhookEvent } from "@/lib/email/resend-webhook";

/** Resend delivery events (bounces, complaints, failures). Configure in Resend → Webhooks. */
export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  const raw = await req.text();
  const valid = verifySvixSignature(
    raw,
    { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") },
    secret,
  );
  if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  let evt: ResendWebhookEvent;
  try {
    evt = JSON.parse(raw) as ResendWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const result = await handleResendEvent(evt);
  return NextResponse.json({ ok: true, result });
}
