import { asc, ne } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings";
import { safeTimezone } from "@/lib/analytics/range";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { CalendarView } from "@/components/calendar/calendar-view";
import { SubscribeDialog } from "@/components/calendar/subscribe-dialog";

export const metadata = { title: "Calendar" };

const VIEWS = ["dayGridMonth", "timeGridWeek", "timeGridDay", "listWeek"] as const;
type ViewName = (typeof VIEWS)[number];

export default async function Page({ searchParams }: PageProps<"/calendar">) {
  await requireUser();
  const sp = await searchParams;
  const [workspace, campaignRows] = await Promise.all([
    getSetting("workspace"),
    db
      .select({ id: campaigns.id, name: campaigns.name, color: campaigns.color })
      .from(campaigns)
      .where(ne(campaigns.status, "archived"))
      .orderBy(asc(campaigns.name)),
  ]);

  const rawView = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  const rawDate = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  const view = VIEWS.includes(rawView as ViewName) ? (rawView as ViewName) : undefined;
  const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : undefined;

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Events, meetings, campaigns, broadcasts and tasks in one place — click or drag on the grid to schedule."
        actions={<SubscribeDialog />}
      />
      <PageBody className="gap-4">
        <CalendarView
          timezone={safeTimezone(workspace.timezone)}
          weekStartsOn={workspace.weekStartsOn}
          campaigns={campaignRows}
          initialView={view}
          initialDate={date}
        />
      </PageBody>
    </>
  );
}
