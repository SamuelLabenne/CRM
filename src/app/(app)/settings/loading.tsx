import { PageBody } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <div className="flex flex-col gap-2 border-b bg-background px-6 pt-5 pb-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <PageBody className="w-full max-w-4xl">
        {[0, 1].map((i) => (
          <div key={i} className="grid gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-80 max-w-full" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          </div>
        ))}
      </PageBody>
    </>
  );
}
