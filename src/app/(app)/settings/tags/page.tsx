import { requireAdmin } from "@/lib/auth";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { listTagsWithUsage } from "../_lib/tags";
import { TagsManager } from "./tags-manager";

export const metadata = { title: "Tags" };

export default async function TagsPage() {
  await requireAdmin();
  const tags = await listTagsWithUsage();
  return (
    <>
      <PageHeader title="Tags" description="Label contacts to segment them for emails, automations and reports." />
      <PageBody className="w-full max-w-4xl">
        <TagsManager tags={tags.map((t) => ({ id: t.id, name: t.name, color: t.color, count: t.count }))} />
      </PageBody>
    </>
  );
}
