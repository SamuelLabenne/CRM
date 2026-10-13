import Link from "next/link";
import { UserX } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <>
      <PageHeader title="Contact not found" back={{ href: "/contacts", label: "Contacts" }} />
      <PageBody>
        <EmptyState
          icon={UserX}
          title="This contact doesn't exist"
          description="It may have been deleted, or the link is wrong."
          action={
            <Button asChild>
              <Link href="/contacts">Back to contacts</Link>
            </Button>
          }
        />
      </PageBody>
    </>
  );
}
