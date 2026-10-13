import { requireAdmin } from "@/lib/auth";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { listFieldDefs } from "../_lib/fields";
import { FieldsManager, type FieldRow } from "./fields-manager";

export const metadata = { title: "Custom fields" };

export default async function FieldsPage() {
  await requireAdmin();
  const defs = await listFieldDefs();
  const rows: FieldRow[] = defs.map((d) => ({ id: d.id, key: d.key, label: d.label, type: d.type, options: d.options, usage: d.usage }));
  return (
    <>
      <PageHeader title="Custom fields" description="Extra information to store on every contact, available in filters, imports, forms and merge tags." />
      <PageBody className="w-full max-w-4xl">
        <FieldsManager fields={rows} />
      </PageBody>
    </>
  );
}
