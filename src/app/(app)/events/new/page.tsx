import { PageBody, PageHeader } from "@/components/app/page-header";
import { EventForm } from "@/components/events/event-form";
import { requireUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { loadEventFormData, newEventValues } from "@/lib/events/form-data";
import { currentTimeMs } from "@/lib/events/utils";

export const metadata = { title: "New event" };

export default async function NewEventPage({ searchParams }: PageProps<"/events/new">) {
  const user = await requireUser();
  const sp = await searchParams;
  const [ws, data] = await Promise.all([getSetting("workspace"), loadEventFormData()]);
  const campaignParam = Array.isArray(sp.campaignId) ? sp.campaignId[0] : sp.campaignId;
  const campaignId = data.campaigns.find((c) => c.id === campaignParam)?.id;
  return (
    <>
      <PageHeader title="New event" description="Set it up once: details, registration page and emails." back={{ href: "/events", label: "Events" }} />
      <PageBody className="max-w-4xl">
        <EventForm
          mode="create"
          sections={["details", "registration", "notifications"]}
          initial={newEventValues({ tz: ws.timezone, hostId: user.id, campaignId, now: new Date(currentTimeMs()) })}
          {...data}
        />
      </PageBody>
    </>
  );
}
