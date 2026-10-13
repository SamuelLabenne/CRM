import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { broadcasts } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings";
import { previewAudience } from "@/lib/email/audience-summary";
import { RECIPIENT_FILTERS, type RecipientFilter } from "@/lib/email/broadcasts";
import { getBranding } from "../../_lib/branding";
import { getComposeOptions } from "../../_lib/audience-options";
import { BroadcastForm } from "../../_components/broadcast-form";
import { BroadcastReport } from "../../_components/broadcast-report";

export async function generateMetadata({ params }: PageProps<"/emails/broadcasts/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { title: "Broadcast" };
  const [b] = await db.select({ name: broadcasts.name }).from(broadcasts).where(eq(broadcasts.id, id));
  return { title: b?.name ?? "Broadcast" };
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function BroadcastPage({ params, searchParams }: PageProps<"/emails/broadcasts/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [b] = await db.select().from(broadcasts).where(eq(broadcasts.id, id));
  if (!b) notFound();

  if (b.status === "draft" || b.status === "cancelled") {
    const [options, branding, workspace, initialPreview] = await Promise.all([
      getComposeOptions(user.id),
      getBranding(),
      getSetting("workspace"),
      previewAudience(b.audience).catch(() => null),
    ]);
    return (
      <BroadcastForm
        key={b.id}
        status={b.status}
        initial={{
          id: b.id,
          name: b.name,
          campaignId: b.campaignId,
          templateId: b.templateId,
          audience: b.audience,
          subject: b.subject,
          preheader: b.preheader ?? "",
          contentJson: b.contentJson,
          contentHtml: b.contentHtml,
        }}
        options={options}
        branding={branding}
        timezone={workspace.timezone}
        initialPreview={initialPreview}
      />
    );
  }

  const sp = await searchParams;
  const filter = RECIPIENT_FILTERS.includes(first(sp.filter) as RecipientFilter) ? (first(sp.filter) as RecipientFilter) : "all";
  const page = Math.max(1, Number.parseInt(first(sp.page) ?? "1", 10) || 1);
  return <BroadcastReport broadcast={b} filter={filter} page={page} />;
}
