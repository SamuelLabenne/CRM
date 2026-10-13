import { PageBody, PageHeader } from "@/components/app/page-header";
import { ContactForm } from "@/components/contacts/contact-form";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { loadReferenceData } from "@/lib/contacts/form-data";

export const metadata = { title: "New contact" };

export default async function NewContactPage() {
  const user = await requireUser();
  const ref = await loadReferenceData();
  return (
    <>
      <PageHeader title="New contact" description="Add a person to your CRM." back={{ href: "/contacts", label: "Contacts" }} />
      <PageBody>
        <Card className="mx-auto w-full max-w-3xl p-5 sm:p-6">
          <ContactForm stages={ref.stages} users={ref.users} customFields={ref.customFields} tagSuggestions={ref.tags} defaultOwnerId={user.id} />
        </Card>
      </PageBody>
    </>
  );
}
