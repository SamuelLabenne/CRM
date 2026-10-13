import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, isNull } from "drizzle-orm";
import { CalendarRange, Mail, Plus, Send, Target, Ticket, Users } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { campaigns, users } from "@/lib/db/schema";
import { getSetting, getStages } from "@/lib/settings";
import { campaignBroadcasts, campaignContacts, campaignEvents, campaignMetrics, CAMPAIGN_TYPE_LABEL } from "@/lib/campaigns";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { BROADCAST_STATUS, CAMPAIGN_STATUS, ColorBadge, EVENT_STATUS, MappedStatus } from "@/components/app/status-badge";
import { TabLinks } from "@/components/events/tab-links";
import { CampaignForm } from "@/components/campaigns/campaign-form";
import { DeleteCampaignButton } from "@/components/campaigns/delete-campaign-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime, formatMoney, formatNumber, formatPercent, fullName } from "@/lib/format";

const TABS = ["overview", "events", "emails", "contacts", "settings"] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata({ params }: PageProps<"/campaigns/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { title: "Campaign" };
  const [c] = await db.select({ name: campaigns.name }).from(campaigns).where(eq(campaigns.id, id));
  return { title: c?.name ?? "Campaign" };
}

export default async function CampaignPage({ params, searchParams }: PageProps<"/campaigns/[id]">) {
  await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  const tab: Tab = typeof sp.tab === "string" && (TABS as readonly string[]).includes(sp.tab) ? (sp.tab as Tab) : "overview";

  const [[campaign], ws] = await Promise.all([db.select().from(campaigns).where(eq(campaigns.id, id)), getSetting("workspace")]);
  if (!campaign) notFound();
  const [metrics, eventRows, broadcastRows] = await Promise.all([campaignMetrics(id), campaignEvents(id), campaignBroadcasts(id)]);
  const m = metrics!;
  const tz = ws.timezone;
  const dateLabel = (d: string | null) => (d ? formatDate(`${d}T12:00:00Z`, tz) : "…");

  const newEventHref = `/events/new?campaignId=${id}`;
  const newBroadcastHref = `/emails/broadcasts/new?campaignId=${id}`;

  return (
    <>
      <PageHeader
        back={{ href: "/campaigns", label: "Campaigns" }}
        title={
          <span className="flex items-center gap-2">
            <span className="size-3 shrink-0 rounded-full" style={{ background: campaign.color }} />
            {campaign.name}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <MappedStatus map={CAMPAIGN_STATUS} value={campaign.status} />
            <span>{CAMPAIGN_TYPE_LABEL[campaign.type] ?? campaign.type}</span>
            {(campaign.startDate || campaign.endDate) && (
              <span className="inline-flex items-center gap-1">
                <CalendarRange className="size-3.5" /> {dateLabel(campaign.startDate)} – {dateLabel(campaign.endDate)}
              </span>
            )}
          </span>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={newBroadcastHref}>
                <Send /> Email campaign contacts
              </Link>
            </Button>
            <Button asChild>
              <Link href={newEventHref}>
                <Plus /> Add event
              </Link>
            </Button>
          </>
        }
      >
        <TabLinks
          active={tab}
          tabs={[
            { key: "overview", label: "Overview", href: `/campaigns/${id}` },
            { key: "events", label: "Events", href: `/campaigns/${id}?tab=events`, count: eventRows.length },
            { key: "emails", label: "Emails", href: `/campaigns/${id}?tab=emails`, count: broadcastRows.length },
            { key: "contacts", label: "Contacts", href: `/campaigns/${id}?tab=contacts` },
            { key: "settings", label: "Settings", href: `/campaigns/${id}?tab=settings` },
          ]}
        />
      </PageHeader>
      <PageBody>
        {tab === "overview" && (
          <>
            {(campaign.goal || campaign.description) && (
              <Card className="gap-2 p-5">
                {campaign.goal && (
                  <p className="flex items-start gap-2 font-medium">
                    <Target className="mt-0.5 size-4 shrink-0 text-primary" /> {campaign.goal}
                  </p>
                )}
                {campaign.description && <p className="whitespace-pre-line text-sm text-muted-foreground">{campaign.description}</p>}
              </Card>
            )}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Registrations" value={formatNumber(m.registrations)} hint={`across ${m.events} event${m.events === 1 ? "" : "s"}`} icon={Ticket} />
              <StatCard label="Show-up rate" value={formatPercent(m.showUpRate)} hint={`${m.attended} attended · ${m.noShow} no-show`} icon={Users} />
              <StatCard label="Email open rate" value={formatPercent(m.openRate)} hint={`${formatNumber(m.emailsDelivered)} delivered · ${formatPercent(m.clickRate)} clicked`} icon={Mail} />
              <StatCard
                label="Cost per registration"
                value={m.costPerRegistration != null ? formatMoney(Math.round(m.costPerRegistration), ws.currency) : "—"}
                hint={m.budget != null ? `budget ${formatMoney(m.budget, ws.currency)}` : "no budget set"}
                icon={Target}
              />
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <EventsCard rows={eventRows.slice(0, 6)} tz={tz} campaignId={id} />
              <BroadcastsCard rows={broadcastRows.slice(0, 6)} tz={tz} newHref={newBroadcastHref} />
            </div>
            {m.attributedContacts > 0 && (
              <p className="text-sm text-muted-foreground">
                {formatNumber(m.attributedContacts)} contacts were attributed to this campaign via <code className="rounded bg-muted px-1">utm_campaign={campaign.utmCampaign}</code>.
              </p>
            )}
          </>
        )}
        {tab === "events" && <EventsCard rows={eventRows} tz={tz} campaignId={id} full />}
        {tab === "emails" && <BroadcastsCard rows={broadcastRows} tz={tz} newHref={newBroadcastHref} full />}
        {tab === "contacts" && <ContactsTab campaignId={id} />}
        {tab === "settings" && <SettingsTab campaign={campaign} currency={ws.currency} />}
      </PageBody>
    </>
  );
}

type EventRows = Awaited<ReturnType<typeof campaignEvents>>;
type BroadcastRows = Awaited<ReturnType<typeof campaignBroadcasts>>;

function EventsCard({ rows, tz, campaignId, full }: { rows: EventRows; tz: string; campaignId: string; full?: boolean }) {
  return (
    <Card className="gap-0 p-0">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <h2 className="font-semibold">Events</h2>
        <Button asChild size="sm" variant="ghost">
          <Link href={`/events/new?campaignId=${campaignId}`}>
            <Plus /> Add event
          </Link>
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">No events linked to this campaign yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Event</TableHead>
              {full && <TableHead>Status</TableHead>}
              <TableHead className="text-right">Registered</TableHead>
              <TableHead className="pr-5 text-right">Show-up</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ event, stats }) => (
              <TableRow key={event.id}>
                <TableCell className="pl-5">
                  <Link href={`/events/${event.id}`} className="font-medium hover:underline">
                    {event.title}
                  </Link>
                  <div className="text-xs text-muted-foreground">{formatDateTime(event.startsAt, tz)}</div>
                </TableCell>
                {full && (
                  <TableCell>
                    <MappedStatus map={EVENT_STATUS} value={event.status} />
                  </TableCell>
                )}
                <TableCell className="text-right tabular-nums">
                  {stats.seatsTaken}
                  {event.capacity ? <span className="text-muted-foreground"> / {event.capacity}</span> : null}
                  {stats.waitlisted > 0 && <div className="text-xs text-amber-600">+{stats.waitlisted} waitlist</div>}
                </TableCell>
                <TableCell className="pr-5 text-right tabular-nums">{formatPercent(stats.showUpRate)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function BroadcastsCard({ rows, tz, newHref, full }: { rows: BroadcastRows; tz: string; newHref: string; full?: boolean }) {
  return (
    <Card className="gap-0 p-0">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <h2 className="font-semibold">Email broadcasts</h2>
        <Button asChild size="sm" variant="ghost">
          <Link href={newHref}>
            <Plus /> New broadcast
          </Link>
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">No broadcasts linked to this campaign yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Broadcast</TableHead>
              {full && <TableHead>Status</TableHead>}
              <TableHead className="text-right">Delivered</TableHead>
              <TableHead className="text-right">Opens</TableHead>
              <TableHead className="pr-5 text-right">Clicks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ broadcast: b, delivered, openRate, clickRate }) => (
              <TableRow key={b.id}>
                <TableCell className="pl-5">
                  <Link href={`/emails/broadcasts/${b.id}`} className="font-medium hover:underline">
                    {b.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {b.sentAt ? `Sent ${formatDateTime(b.sentAt, tz)}` : b.scheduledAt ? `Scheduled ${formatDateTime(b.scheduledAt, tz)}` : "Draft"}
                  </div>
                </TableCell>
                {full && (
                  <TableCell>
                    <MappedStatus map={BROADCAST_STATUS} value={b.status} />
                  </TableCell>
                )}
                <TableCell className="text-right tabular-nums">{formatNumber(delivered)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPercent(openRate)}</TableCell>
                <TableCell className="pr-5 text-right tabular-nums">{formatPercent(clickRate)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

async function ContactsTab({ campaignId }: { campaignId: string }) {
  const [{ total, emailable, rows }, stages] = await Promise.all([campaignContacts(campaignId, 50), getStages()]);
  const stageBy = new Map(stages.map((s) => [s.key, s]));
  if (total === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No contacts yet"
        description="Contacts appear here when they register for one of the campaign's events or arrive with this campaign's utm_campaign."
      />
    );
  }
  return (
    <Card className="gap-0 p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
        <p className="text-sm text-muted-foreground">
          {formatNumber(total)} contacts · {formatNumber(emailable)} can receive marketing email
        </p>
        <Button asChild size="sm" variant="outline">
          <Link href={`/emails/broadcasts/new?campaignId=${campaignId}`}>
            <Send /> Email them
          </Link>
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Name</TableHead>
            <TableHead>Company</TableHead>
            <TableHead className="pr-5">Stage</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => {
            const st = stageBy.get(c.stage);
            return (
              <TableRow key={c.id}>
                <TableCell className="pl-5">
                  <Link href={`/contacts/${c.id}`} className="font-medium hover:underline">
                    {fullName(c)}
                  </Link>
                  <div className="text-xs text-muted-foreground">{c.email}</div>
                </TableCell>
                <TableCell>{c.company ?? "—"}</TableCell>
                <TableCell className="pr-5">{st ? <ColorBadge color={st.color}>{st.label}</ColorBadge> : c.stage}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {total > rows.length && <p className="border-t px-5 py-3 text-xs text-muted-foreground">Showing the {rows.length} most recently active of {formatNumber(total)} contacts.</p>}
    </Card>
  );
}

async function SettingsTab({ campaign, currency }: { campaign: typeof campaigns.$inferSelect; currency: string }) {
  const team = await db.select({ id: users.id, name: users.name }).from(users).where(isNull(users.deactivatedAt)).orderBy(asc(users.name));
  return (
    <div className="grid gap-6">
      <CampaignForm
        campaignId={campaign.id}
        users={team}
        currency={currency}
        initial={{
          name: campaign.name,
          description: campaign.description ?? "",
          type: campaign.type,
          status: campaign.status,
          startDate: campaign.startDate ?? "",
          endDate: campaign.endDate ?? "",
          goal: campaign.goal ?? "",
          budget: campaign.budget == null ? "" : String(campaign.budget),
          color: campaign.color,
          utmCampaign: campaign.utmCampaign ?? "",
          ownerId: campaign.ownerId ?? "",
        }}
      />
      <Card className="max-w-3xl gap-3 border-destructive/30 p-5">
        <h3 className="font-semibold">Delete campaign</h3>
        <p className="text-sm text-muted-foreground">Events and broadcasts stay; they are simply unlinked from this campaign.</p>
        <DeleteCampaignButton id={campaign.id} name={campaign.name} />
      </Card>
    </div>
  );
}
