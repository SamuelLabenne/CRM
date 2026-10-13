import { PageBody, PageHeader } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader title="Pipeline" description={<Skeleton className="h-4 w-48" />} />
      <PageBody className="gap-4">
        <Skeleton className="h-8 w-72" />
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="grid h-96 w-80 shrink-0 content-start gap-2 rounded-xl border bg-muted/40 p-3">
              <Skeleton className="h-5 w-32" />
              {Array.from({ length: 3 - (i % 2) }).map((_, j) => (
                <Skeleton key={j} className="h-20 w-full" />
              ))}
            </div>
          ))}
        </div>
      </PageBody>
    </>
  );
}
