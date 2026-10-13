import { asc } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { customFieldDefs } from "@/lib/db/schema";
import { getStages } from "@/lib/settings";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { ImportWizard } from "@/components/contacts/import-wizard";

export const metadata = { title: "Import contacts" };

export default async function ImportContactsPage() {
  await requireUser();
  const [fields, stages] = await Promise.all([
    db.select({ key: customFieldDefs.key, label: customFieldDefs.label, type: customFieldDefs.type, options: customFieldDefs.options }).from(customFieldDefs).orderBy(asc(customFieldDefs.position)),
    getStages(),
  ]);
  return (
    <>
      <PageHeader
        title="Import contacts"
        description="Upload a CSV from a spreadsheet or another CRM. Contacts are matched by email (then phone), so re-importing never creates duplicates."
        back={{ href: "/contacts", label: "Contacts" }}
      />
      <PageBody className="max-w-5xl">
        <ImportWizard customFields={fields} stages={stages.map((s) => ({ key: s.key, label: s.label }))} />
      </PageBody>
    </>
  );
}
