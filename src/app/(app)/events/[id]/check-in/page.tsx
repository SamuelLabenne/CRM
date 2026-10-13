import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { CheckInList, type CheckInRow } from "@/components/events/check-in";
import { fullName, formatTimeRange } from "@/lib/format";
import { listCheckInRows } from "@/lib/events/queries";
import { currentTimeMs } from "@/lib/events/utils";

export const metadata = { title: "Check-in" };

export default async function CheckInPage({ params }: PageProps<"/events/[id]/check-in">) {
  await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [event] = await db.select().from(events).where(eq(events.id, id));
  if (!event) notFound();
  const [ws, rows] = await Promise.all([getSetting("workspace"), listCheckInRows(id)]);
  const initialRows: CheckInRow[] = rows.map((r) => ({ id: r.id, name: fullName(r), email: r.email, company: r.company, status: r.status, rsvp: r.rsvp }));
  return (
    <>
      <PageHeader
        back={{ href: `/events/${id}`, label: event.title }}
        title="Check-in"
        description={`${event.title} · ${formatTimeRange(event.startsAt, event.endsAt, event.timezone || ws.timezone)}`}
      />
      <PageBody>
        <CheckInList eventId={id} initialRows={initialRows} ended={event.endsAt.getTime() < currentTimeMs()} />
      </PageBody>
    </>
  );
}
