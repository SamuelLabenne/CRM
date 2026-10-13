import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { asc, eq, ne } from "drizzle-orm";
import { BookingPageEditor } from "@/components/scheduling/booking-page-editor";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { bookingPages, campaigns, customFieldDefs, emailTemplates } from "@/lib/db/schema";
import { pageToDraft } from "@/lib/scheduling/draft";
import { activeUsers, getPageStats, requestOrigin } from "@/lib/scheduling/pages";
import { resolveTimezone } from "@/lib/scheduling/slots-core";
import { getSetting } from "@/lib/settings";

export const metadata = { title: "Edit booking page" };

export default async function EditBookingPage({ params, searchParams }: PageProps<"/scheduling/[id]">) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [page] = await db.select().from(bookingPages).where(eq(bookingPages.id, id));
  if (!page) notFound();

  const [origin, workspace, userRows, campaignRows, templateRows, fieldRows, stats] = await Promise.all([
    requestOrigin(),
    getSetting("workspace"),
    activeUsers(),
    db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns).orderBy(asc(campaigns.name)),
    db.select({ id: emailTemplates.id, name: emailTemplates.name }).from(emailTemplates).where(ne(emailTemplates.category, "marketing")).orderBy(asc(emailTemplates.name)),
    db.select({ key: customFieldDefs.key, label: customFieldDefs.label }).from(customFieldDefs).orderBy(asc(customFieldDefs.position)),
    getPageStats(id),
  ]);
  const qrDataUrl = await QRCode.toDataURL(`${origin}/book/${page.slug}`, { margin: 1, width: 360, errorCorrectionLevel: "M" });
  const tab = typeof sp.tab === "string" ? sp.tab : "setup";

  return (
    <BookingPageEditor
      pageId={page.id}
      initial={pageToDraft(page)}
      initialTab={tab}
      users={userRows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        color: u.color,
        timezone: resolveTimezone(u.timezone, workspace.timezone),
        availability: u.availability,
        overridesCount: u.dateOverrides?.length ?? 0,
        deactivated: !!u.deactivatedAt,
      }))}
      campaigns={campaignRows}
      templates={templateRows}
      customFields={fieldRows}
      origin={origin}
      qrDataUrl={qrDataUrl}
      stats={stats}
    />
  );
}
