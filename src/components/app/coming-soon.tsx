import { Construction } from "lucide-react";
import { PageBody, PageHeader } from "./page-header";
import { EmptyState } from "./empty-state";

/** Placeholder used while a module is being built. */
export function ComingSoon({ title, description }: { title: string; description?: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <PageBody>
        <EmptyState icon={Construction} title="Being built" description="This module is under construction." />
      </PageBody>
    </>
  );
}
