import { PageBody, PageHeader } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader title={<Skeleton className="h-6 w-56" />} back={{ href: "/automations", label: "Automations" }}>
        <Skeleton className="h-5 w-80 max-w-full" />
      </PageHeader>
      <PageBody>
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
          <Skeleton className="h-36 rounded-xl" />
          <Skeleton className="h-52 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      </PageBody>
    </>
  );
}
