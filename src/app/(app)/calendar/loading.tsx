import { PageBody, PageHeader } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader title="Calendar" description="Events, meetings, campaigns, broadcasts and tasks in one place." />
      <PageBody>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="ml-auto h-8 w-64" />
        </div>
        <Skeleton className="h-[calc(100dvh-16rem)] min-h-[480px] w-full rounded-xl" />
      </PageBody>
    </>
  );
}
