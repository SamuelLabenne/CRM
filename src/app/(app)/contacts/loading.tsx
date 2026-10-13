import { PageBody, PageHeader } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader title="Contacts" description={<Skeleton className="h-4 w-40" />} />
      <PageBody>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-28" />
        </div>
        <div className="overflow-hidden rounded-xl border bg-card">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 border-b p-3 last:border-b-0">
              <Skeleton className="size-4" />
              <Skeleton className="size-8 rounded-lg" />
              <div className="grid flex-1 gap-1.5">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="hidden h-5 w-20 md:block" />
            </div>
          ))}
        </div>
      </PageBody>
    </>
  );
}
