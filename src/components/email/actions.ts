"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, ok, zodFail, type ActionResult } from "@/lib/action";
import { buildMergeContext } from "@/lib/email/context";
import { sampleMergeContext, type MergeContext } from "@/lib/email/merge-tags";
import { sendEmail } from "@/lib/email/send";
import { audienceSchema, testEmailSchema } from "@/lib/email/schemas";
import { lookupContacts, previewAudience, type AudiencePreview } from "@/lib/email/audience-summary";

// Server actions shared by the email editor/composer components (preview + send test + audience count).

/** Merge context for "Preview as contact": the contact's real data over sample event values. */
async function contextForContact(contactId: string | null | undefined): Promise<MergeContext> {
  const sample = sampleMergeContext();
  if (!contactId) return sample;
  const { ctx, contact } = await buildMergeContext({ contactId });
  if (!contact) return sample;
  return { ...sample, ...ctx, contact: { ...sample.contact, ...ctx.contact } };
}

export async function previewContextAction(contactId: string | null): Promise<ActionResult<MergeContext>> {
  await requireUser();
  const parsed = z.string().uuid().nullable().safeParse(contactId);
  if (!parsed.success) return fail("Invalid contact");
  return ok(await contextForContact(parsed.data));
}

/** Send a test copy of the email being edited to the current user's address. */
export async function sendTestEmailAction(input: z.input<typeof testEmailSchema>): Promise<ActionResult<{ to: string; simulated: boolean }>> {
  const user = await requireUser();
  const parsed = testEmailSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const d = parsed.data;
  if (!d.html.trim()) return fail("Write something in the email body first.");
  const context = await contextForContact(d.contactId);
  const res = await sendEmail({
    to: user.email,
    toName: user.name,
    kind: "test",
    silent: true,
    track: false,
    marketing: d.marketing,
    subject: `[Test] ${d.subject.trim() || "(no subject)"}`,
    html: d.html,
    preheader: d.preheader ?? null,
    context,
    actorId: user.id,
  });
  if (res.status === "failed") return fail(`The test email could not be sent: ${res.error}`);
  if (res.status === "skipped") return fail(res.reason);
  return ok({ to: user.email, simulated: res.status === "simulated" });
}

/** Live recipient count (+ a few sample recipients) for the audience builder. */
export async function previewAudienceAction(audience: unknown): Promise<ActionResult<AudiencePreview>> {
  await requireUser();
  const parsed = audienceSchema.safeParse(audience);
  if (!parsed.success) return fail("Complete the audience settings to see a recipient count.");
  return ok(await previewAudience(parsed.data));
}

/** Names for a list of contact ids (specific-contacts audience). */
export async function lookupContactsAction(ids: string[]) {
  await requireUser();
  const parsed = z.array(z.string().uuid()).max(500).safeParse(ids);
  if (!parsed.success) return [];
  return lookupContacts(parsed.data);
}
