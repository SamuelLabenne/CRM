import { PageBody, PageHeader } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader title="Booking page" back={{ href: "/scheduling", label: "Booking pages" }} />
      <PageBody>
        <Skeleton className="h-9 w-96 max-w-full" />
        <div className="grid gap-5 lg:grid-cols-2">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      </PageBody>
    </>
  );
}
