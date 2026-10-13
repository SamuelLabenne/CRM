import { requireUser } from "@/lib/auth";
import { getBranding } from "../../_lib/branding";
import { TemplateForm } from "../../_components/template-form";

export const metadata = { title: "New template" };

export default async function NewTemplatePage() {
  await requireUser();
  return <TemplateForm template={null} branding={await getBranding()} />;
}
