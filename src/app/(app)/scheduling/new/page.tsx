import { NewBookingPageForm } from "@/components/scheduling/new-booking-page-form";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { activeUsers } from "@/lib/scheduling/pages";

export const metadata = { title: "New booking page" };

export default async function NewBookingPagePage() {
  const user = await requireUser();
  const users = (await activeUsers()).filter((u) => !u.deactivatedAt);
  return (
    <>
      <PageHeader title="New booking page" description="Set up the basics – you can fine-tune everything afterwards." back={{ href: "/scheduling", label: "Booking pages" }} />
      <PageBody>
        <NewBookingPageForm users={users.map((u) => ({ id: u.id, name: u.name, color: u.color }))} currentUserId={user.id} />
      </PageBody>
    </>
  );
}
