import { PageBody, PageHeader } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader title="Email" back={{ href: "/emails?tab=outbox", label: "Outbox" }} />
      <PageBody>
        <Skeleton className="h-[480px] w-full rounded-xl" />
      </PageBody>
    </>
  );
}
