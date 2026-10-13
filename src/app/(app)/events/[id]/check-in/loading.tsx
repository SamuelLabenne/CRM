import { PageBody, PageHeader } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader title="Check-in" />
      <PageBody>
        <div className="mx-auto grid w-full max-w-2xl gap-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-14 rounded-2xl" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[4.5rem] rounded-2xl" />
          ))}
        </div>
      </PageBody>
    </>
  );
}
