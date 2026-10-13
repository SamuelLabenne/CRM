import Link from "next/link";
import { CalendarRange, Megaphone, Plus, Target } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { listCampaignsWithStats, CAMPAIGN_TYPE_LABEL } from "@/lib/campaigns";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { CAMPAIGN_STATUS, MappedStatus } from "@/components/app/status-badge";
import { TabLinks } from "@/components/events/tab-links";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate, formatMoney, formatNumber, formatPercent } from "@/lib/format";

export const metadata = { title: "Campaigns" };

const TABS = ["all", "active", "planned", "completed", "archived"] as const;

export default async function CampaignsPage({ searchParams }: PageProps<"/campaigns">) {
  await requireUser();
  const sp = await searchParams;
  const status = typeof sp.status === "string" && (TABS as readonly string[]).includes(sp.status) ? sp.status : "all";
  const [ws, rows, all] = await Promise.all([
    getSetting("workspace"),
    listCampaignsWithStats({ status }),
    listCampaignsWithStats({}),
  ]);
  const counts = Object.fromEntries(TABS.map((t) => [t, t === "all" ? all.length : all.filter((r) => r.campaign.status === t).length]));

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Group events, emails and attribution into marketing campaigns and track how they perform."
        actions={
          <Button asChild>
            <Link href="/campaigns/new">
              <Plus /> New campaign
            </Link>
          </Button>
        }
      >
        <TabLinks
          active={status}
          tabs={TABS.map((t) => ({
            key: t,
            label: t === "all" ? "All" : CAMPAIGN_STATUS[t].label,
            href: t === "all" ? "/campaigns" : `/campaigns?status=${t}`,
            count: counts[t],
          }))}
        />
      </PageHeader>
      <PageBody>
        {rows.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title={status === "all" ? "No campaigns yet" : "No campaigns with this status"}
            description="A campaign groups related events and email sends (e.g. a webinar series or a product launch) so you can see registrations, attendance and email results in one place."
            action={
              <Button asChild>
                <Link href="/campaigns/new">
                  <Plus /> Create a campaign
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map(({ campaign: c, events, registrations, attendanceRate }) => (
              <Link key={c.id} href={`/campaigns/${c.id}`} className="group">
                <Card className="h-full gap-4 overflow-hidden p-0 transition-shadow group-hover:shadow-md">
                  <div className="h-1.5" style={{ background: c.color }} />
                  <div className="grid gap-3 px-5 pb-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold group-hover:underline">{c.name}</h3>
                        <p className="text-xs text-muted-foreground">{CAMPAIGN_TYPE_LABEL[c.type] ?? c.type}</p>
                      </div>
                      <MappedStatus map={CAMPAIGN_STATUS} value={c.status} />
                    </div>
                    {(c.startDate || c.endDate) && (
                      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <CalendarRange className="size-4" />
                        {c.startDate ? formatDate(`${c.startDate}T12:00:00Z`, ws.timezone) : "…"} – {c.endDate ? formatDate(`${c.endDate}T12:00:00Z`, ws.timezone) : "…"}
                      </p>
                    )}
                    {c.goal && (
                      <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                        <Target className="mt-0.5 size-4 shrink-0" />
                        <span className="line-clamp-2">{c.goal}</span>
                      </p>
                    )}
                    <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/50 p-3 text-center">
                      <div>
                        <div className="text-lg font-semibold tabular-nums">{formatNumber(events)}</div>
                        <div className="text-xs text-muted-foreground">Events</div>
                      </div>
                      <div>
                        <div className="text-lg font-semibold tabular-nums">{formatNumber(registrations)}</div>
                        <div className="text-xs text-muted-foreground">Registrations</div>
                      </div>
                      <div>
                        <div className="text-lg font-semibold tabular-nums">{formatPercent(attendanceRate, 0)}</div>
                        <div className="text-xs text-muted-foreground">Attendance</div>
                      </div>
                    </div>
                    {c.budget != null && (
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Budget {formatMoney(c.budget, ws.currency)}</span>
                        <span>{registrations ? `${formatMoney(Math.round(c.budget / registrations), ws.currency)} per registration` : "No registrations yet"}</span>
                      </div>
                    )}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
