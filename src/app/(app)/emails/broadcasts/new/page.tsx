import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { emailTemplates } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings";
import { previewAudience } from "@/lib/email/audience-summary";
import type { Audience } from "@/lib/types";
import { getBranding } from "../../_lib/branding";
import { getComposeOptions } from "../../_lib/audience-options";
import { audienceFromSearchParams, isUuid } from "../../_lib/prefill";
import { BroadcastForm, type BroadcastFormValue } from "../../_components/broadcast-form";

export const metadata = { title: "New broadcast" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function NewBroadcastPage({ searchParams }: PageProps<"/emails/broadcasts/new">) {
  const user = await requireUser();
  const sp = await searchParams;
  const [options, branding, workspace] = await Promise.all([getComposeOptions(user.id), getBranding(), getSetting("workspace")]);

  const audience: Audience = audienceFromSearchParams(sp) ?? { type: "all" };
  const initial: BroadcastFormValue = {
    id: null,
    name: first(sp.name)?.slice(0, 120) ?? "",
    campaignId: isUuid(first(sp.campaignId)) ? first(sp.campaignId)! : null,
    templateId: null,
    audience,
    subject: first(sp.subject)?.slice(0, 300) ?? "",
    preheader: "",
    contentJson: null,
    contentHtml: "",
  };

  const templateId = first(sp.template);
  if (isUuid(templateId)) {
    const [t] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, templateId));
    if (t) {
      initial.templateId = t.id;
      initial.subject = initial.subject || t.subject;
      initial.preheader = t.preheader ?? "";
      initial.contentJson = t.contentJson;
      initial.contentHtml = t.contentHtml;
    }
  }

  const initialPreview = await previewAudience(audience).catch(() => null);
  return <BroadcastForm initial={initial} options={options} branding={branding} timezone={workspace.timezone} initialPreview={initialPreview} />;
}
