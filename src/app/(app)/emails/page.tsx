import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { buttonVariants } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmailsTabs, parseTab } from "./_components/emails-tabs";
import { BroadcastsTab } from "./_components/broadcasts-tab";
import { TemplatesTab } from "./_components/templates-tab";
import { OutboxTab } from "./_components/outbox-tab";

export const metadata = { title: "Emails" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function EmailsPage({ searchParams }: PageProps<"/emails">) {
  await requireUser();
  const sp = await searchParams;
  const tab = parseTab(sp.tab);
  const page = Math.max(1, Number.parseInt(first(sp.page) ?? "1", 10) || 1);

  return (
    <>
      <PageHeader
        title="Emails"
        description="Broadcasts, reusable templates and a log of every email Relay sends."
        actions={
          tab === "templates" ? (
            <Link href="/emails/templates/new" className={buttonVariants()}>
              <Plus /> New template
            </Link>
          ) : tab === "broadcasts" ? (
            <Link href="/emails/broadcasts/new" className={buttonVariants()}>
              <Plus /> New broadcast
            </Link>
          ) : null
        }
      >
        <EmailsTabs active={tab} />
      </PageHeader>
      <PageBody>
        {tab === "broadcasts" && <BroadcastsTab q={first(sp.q)} status={first(sp.status)} page={page} />}
        {tab === "templates" && <TemplatesTab q={first(sp.q)} category={first(sp.category)} />}
        {tab === "outbox" && <OutboxTab q={first(sp.q)} kind={first(sp.kind)} status={first(sp.status)} page={page} />}
      </PageBody>
    </>
  );
}
