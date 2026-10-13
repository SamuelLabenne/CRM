import { PageBody, PageHeader } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader title={<Skeleton className="h-6 w-48" />} description={<Skeleton className="mt-1 h-4 w-32" />} back={{ href: "/contacts", label: "Contacts" }} />
      <PageBody className="gap-5">
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="grid gap-6 lg:grid-cols-[21rem_minmax(0,1fr)]">
          <Skeleton className="h-96 rounded-xl" />
          <div className="grid gap-3">
            <Skeleton className="h-8 w-80" />
            <Skeleton className="h-28 w-full rounded-xl" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-8 rounded-full" />
                <Skeleton className="h-12 flex-1" />
              </div>
            ))}
          </div>
        </div>
      </PageBody>
    </>
  );
}
