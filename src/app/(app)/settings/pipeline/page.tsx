import { requireAdmin } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { getStageUsage } from "../_lib/pipeline";
import { StagesEditor } from "./stages-editor";

export const metadata = { title: "Pipeline stages" };

export default async function PipelinePage() {
  await requireAdmin();
  const [stages, usage] = await Promise.all([getSetting("stages"), getStageUsage()]);
  const editorKey = stages.map((s) => `${s.key}:${s.label}:${s.color}:${s.category}:${usage[s.key] ?? 0}`).join("|");
  return (
    <>
      <PageHeader title="Pipeline stages" description="The manual stages contacts move through on the Pipeline board." />
      <PageBody className="w-full max-w-4xl">
        <StagesEditor key={editorKey} initial={stages} usage={usage} />
      </PageBody>
    </>
  );
}
