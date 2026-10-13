import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { emailTemplates } from "@/lib/db/schema";
import { describeUsage, getTemplateUsage, systemTemplateInfo } from "@/lib/email/templates";
import { getBranding } from "../../_lib/branding";
import { TemplateForm } from "../../_components/template-form";

export async function generateMetadata({ params }: PageProps<"/emails/templates/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { title: "Template" };
  const [t] = await db.select({ name: emailTemplates.name }).from(emailTemplates).where(eq(emailTemplates.id, id));
  return { title: t?.name ?? "Template" };
}

export default async function TemplatePage({ params }: PageProps<"/emails/templates/[id]">) {
  await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [t] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, id));
  if (!t) notFound();
  const [branding, usage] = await Promise.all([getBranding(), getTemplateUsage()]);
  return (
    <TemplateForm
      key={t.id}
      template={{
        id: t.id,
        name: t.name,
        subject: t.subject,
        preheader: t.preheader ?? "",
        category: t.category,
        contentJson: t.contentJson,
        contentHtml: t.contentHtml,
        systemKey: t.systemKey,
      }}
      branding={branding}
      systemInfo={systemTemplateInfo(t.systemKey)}
      usage={describeUsage(usage.get(t.id))}
    />
  );
}
