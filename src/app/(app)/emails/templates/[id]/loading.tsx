import { PageBody, PageHeader } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader title="Template" back={{ href: "/emails?tab=templates", label: "Templates" }} />
      <PageBody>
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </PageBody>
    </>
  );
}
