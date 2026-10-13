import { asc, isNull } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { CampaignForm } from "@/components/campaigns/campaign-form";

export const metadata = { title: "New campaign" };

export default async function NewCampaignPage() {
  const me = await requireUser();
  const [ws, team] = await Promise.all([
    getSetting("workspace"),
    db.select({ id: users.id, name: users.name }).from(users).where(isNull(users.deactivatedAt)).orderBy(asc(users.name)),
  ]);
  return (
    <>
      <PageHeader title="New campaign" description="Plan a campaign, then link events and email broadcasts to it." back={{ href: "/campaigns", label: "Campaigns" }} />
      <PageBody>
        <CampaignForm
          users={team}
          currency={ws.currency}
          initial={{
            name: "",
            description: "",
            type: "event_series",
            status: "planned",
            startDate: "",
            endDate: "",
            goal: "",
            budget: "",
            color: "#6366f1",
            utmCampaign: "",
            ownerId: me.id,
          }}
        />
      </PageBody>
    </>
  );
}
