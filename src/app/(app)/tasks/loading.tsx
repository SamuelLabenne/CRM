import { PageBody, PageHeader } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader title="Tasks" description={<Skeleton className="h-4 w-32" />} />
      <PageBody>
        {[3, 4].map((n) => (
          <div key={n} className="grid gap-2">
            <Skeleton className="h-4 w-24" />
            <div className="overflow-hidden rounded-xl border bg-card">
              {Array.from({ length: n }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 border-b p-3 last:border-b-0">
                  <Skeleton className="size-4" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </PageBody>
    </>
  );
}
