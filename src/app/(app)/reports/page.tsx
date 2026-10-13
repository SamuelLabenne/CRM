import Link from "next/link";
import { BarChart3, Coins, Mail, MousePointerClick, Target, Ticket, Users, Video } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { parseRangeKey, rangeLabel, REPORT_RANGES, resolveRange, type DateRange } from "@/lib/analytics/range";
import { getCampaignsReport, getEmailReport, getEventsReport, getMeetingsReport, getSourcesReport, type SourceRow } from "@/lib/analytics/reports";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { OUTCOME } from "@/components/app/status-badge";
import { RangeTabs } from "@/components/dashboard/range-tabs";
import { TabLinks } from "@/components/events/tab-links";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney, formatNumber, formatPercent } from "@/lib/format";

export const metadata = { title: "Reports" };

const TABS = [
  { key: "events", label: "Events" },
  { key: "email", label: "Email" },
  { key: "campaigns", label: "Campaigns" },
  { key: "meetings", label: "Meetings" },
  { key: "sources", label: "Sources" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const OBJECTION_LABEL: Record<string, string> = {
  money: "Money",
  timing: "Timing",
  partner: "Partner / decision maker",
  fear: "Fear",
  smoke_screen: "Smoke screen",
  no_objection: "No objection",
};

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  await requireUser();
  const sp = await searchParams;
  const ws = await getSetting("workspace");
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "events";
  const key = parseRangeKey(sp.range, REPORT_RANGES, "90");
  const range = resolveRange(key, ws.timezone);

  return (
    <>
      <PageHeader
        title="Reports"
        description={`Performance across events, email, campaigns, meetings and lead sources · ${rangeLabel(key).toLowerCase()}`}
        actions={
          <RangeTabs
            basePath="/reports"
            current={key}
            params={{ tab }}
            options={REPORT_RANGES.map((r) => ({ value: r, label: r === "all" ? "All" : r === "365" ? "12m" : `${r}d` }))}
          />
        }
      >
        <TabLinks active={tab} tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: `/reports?tab=${t.key}&range=${key}` }))} />
      </PageHeader>
      <PageBody>
        {tab === "events" && <EventsReportView range={range} tz={ws.timezone} />}
        {tab === "email" && <EmailReportView range={range} tz={ws.timezone} />}
        {tab === "campaigns" && <CampaignsReportView range={range} currency={ws.currency} />}
        {tab === "meetings" && <MeetingsReportView range={range} currency={ws.currency} />}
        {tab === "sources" && <SourcesReportView range={range} />}
      </PageBody>
    </>
  );
}

function Section({ title, children, note }: { title: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-3">
        <h2 className="font-semibold">{title}</h2>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </Card>
  );
}

function Bars({ items }: { items: { label: string; value: number; color?: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="p-6 text-center text-sm text-muted-foreground">No data yet.</p>;
  return (
    <ul className="grid gap-3 p-5">
      {items.map((i) => (
        <li key={i.label} className="grid gap-1">
          <div className="flex justify-between text-sm">
            <span>{i.label}</span>
            <span className="tabular-nums text-muted-foreground">{formatNumber(i.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full" style={{ width: `${(i.value / max) * 100}%`, background: i.color ?? "var(--primary)" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

async function EventsReportView({ range, tz }: { range: DateRange; tz: string }) {
  const r = await getEventsReport(range);
  if (!r.rows.length) return <EmptyState icon={BarChart3} title="No events in this period" description="Events that start within the selected period show up here." />;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Events" value={formatNumber(r.totals.events)} icon={Ticket} />
        <StatCard label="Registrations" value={formatNumber(r.totals.registrations)} icon={Users} />
        <StatCard label="Show-up rate" value={formatPercent(r.totals.showUpRate)} hint={`${r.totals.attended} attended · ${r.totals.noShow} no-show`} icon={Target} />
        <StatCard label="Page → registration" value={formatPercent(r.totals.conversion)} hint={`${formatNumber(r.totals.pageViews)} unique page views`} icon={MousePointerClick} />
      </div>
      <Section title="Events" note="Show-up = attended ÷ (attended + no-show)">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Event</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Registered</TableHead>
              <TableHead className="text-right">Attended</TableHead>
              <TableHead className="text-right">No-show</TableHead>
              <TableHead className="text-right">Show-up</TableHead>
              <TableHead className="text-right">Views</TableHead>
              <TableHead className="pr-5 text-right">Conversion</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.rows.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="pl-5">
                  <Link href={`/events/${e.id}`} className="font-medium hover:underline">
                    {e.title}
                  </Link>
                  {e.campaignName && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="size-2 rounded-full" style={{ background: e.campaignColor ?? undefined }} /> {e.campaignName}
                    </div>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(e.startsAt, tz)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {e.registrations}
                  {e.capacity ? <span className="text-muted-foreground">/{e.capacity}</span> : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{e.isPast ? e.attended : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{e.isPast ? e.noShow : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPercent(e.showUpRate)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(e.pageViews)}</TableCell>
                <TableCell className="pr-5 text-right tabular-nums">{formatPercent(e.conversion)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </>
  );
}

async function EmailReportView({ range, tz }: { range: DateRange; tz: string }) {
  const r = await getEmailReport(range);
  const t = r.totals;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Delivered" value={formatNumber(t.delivered)} hint={`${formatNumber(t.messages)} messages total`} icon={Mail} />
        <StatCard label="Open rate" value={formatPercent(t.openRate)} hint={`${formatNumber(t.opened)} opened`} icon={Mail} />
        <StatCard label="Click rate" value={formatPercent(t.clickRate)} hint={`${formatNumber(t.clicked)} clicked`} icon={MousePointerClick} />
        <StatCard label="Unsubscribes" value={formatNumber(t.unsubscribed)} hint={`${formatNumber(t.failed)} failed`} icon={Users} />
      </div>
      <Section title="Broadcasts">
        {r.broadcasts.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No broadcasts sent in this period.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Broadcast</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead className="text-right">Delivered</TableHead>
                <TableHead className="text-right">Opens</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="pr-5 text-right">Unsubs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.broadcasts.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="pl-5">
                    <Link href={`/emails/broadcasts/${b.id}`} className="font-medium hover:underline">
                      {b.name}
                    </Link>
                    <div className="max-w-80 truncate text-xs text-muted-foreground">{b.subject}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{b.sentAt ? formatDate(b.sentAt, tz) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(b.delivered)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(b.openRate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(b.clickRate)}</TableCell>
                  <TableCell className="pr-5 text-right tabular-nums">{formatNumber(b.unsubscribed)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
      <Section title="Templates (automations & notifications)">
        {r.templates.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No template-based emails in this period.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Template</TableHead>
                <TableHead className="text-right">Delivered</TableHead>
                <TableHead className="text-right">Opens</TableHead>
                <TableHead className="pr-5 text-right">Clicks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.templates.map((tpl) => (
                <TableRow key={tpl.id}>
                  <TableCell className="pl-5">
                    <Link href={`/emails/templates/${tpl.id}`} className="font-medium hover:underline">
                      {tpl.name}
                    </Link>
                    <div className="text-xs text-muted-foreground capitalize">{tpl.isSystem ? "Built-in · " : ""}{tpl.category.replace("_", " ")}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(tpl.delivered)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(tpl.openRate)}</TableCell>
                  <TableCell className="pr-5 text-right tabular-nums">{formatPercent(tpl.clickRate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </>
  );
}

async function CampaignsReportView({ range, currency }: { range: DateRange; currency: string }) {
  const rows = await getCampaignsReport(range);
  if (!rows.length) return <EmptyState icon={BarChart3} title="No campaigns yet" description="Create a campaign and link events and broadcasts to compare their performance." />;
  return (
    <Section title="Campaigns" note="Cost per registration = budget ÷ registrations">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Campaign</TableHead>
            <TableHead className="text-right">Events</TableHead>
            <TableHead className="text-right">Registrations</TableHead>
            <TableHead className="text-right">Show-up</TableHead>
            <TableHead className="text-right">Emails</TableHead>
            <TableHead className="text-right">Open rate</TableHead>
            <TableHead className="text-right">New contacts</TableHead>
            <TableHead className="pr-5 text-right">Cost / reg.</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="pl-5">
                <Link href={`/campaigns/${c.id}`} className="flex items-center gap-2 font-medium hover:underline">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.color }} /> {c.name}
                </Link>
              </TableCell>
              <TableCell className="text-right tabular-nums">{c.events}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(c.registrations)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatPercent(c.showUpRate)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(c.emailsDelivered)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatPercent(c.openRate)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(c.contacts)}</TableCell>
              <TableCell className="pr-5 text-right tabular-nums">{c.costPerRegistration != null ? formatMoney(Math.round(c.costPerRegistration), currency) : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

async function MeetingsReportView({ range, currency }: { range: DateRange; currency: string }) {
  const r = await getMeetingsReport(range);
  const t = r.totals;
  const groupTable = (title: string, rows: typeof r.byHost) => (
    <Section title={title}>
      {rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">No meetings in this period.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Name</TableHead>
              <TableHead className="text-right">Booked</TableHead>
              <TableHead className="text-right">Show-up</TableHead>
              <TableHead className="text-right">Closing</TableHead>
              <TableHead className="pr-5 text-right">Won value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((g) => (
              <TableRow key={g.key}>
                <TableCell className="pl-5 font-medium">{g.name}</TableCell>
                <TableCell className="text-right tabular-nums">{g.booked}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPercent(g.showUpRate)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPercent(g.closingRate)}</TableCell>
                <TableCell className="pr-5 text-right tabular-nums">{formatMoney(g.wonValue, currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Meetings booked" value={formatNumber(t.booked)} hint={`${t.cancelled} cancelled`} icon={Video} />
        <StatCard label="Show-up rate" value={formatPercent(t.showUpRate)} hint={`${t.attended} showed · ${t.noShow} no-show`} icon={Users} />
        <StatCard label="Closing rate" value={formatPercent(t.closingRate)} hint={`${t.won} won of ${t.withOutcome} with an outcome`} icon={Target} />
        <StatCard label="Won value" value={formatMoney(t.wonValue, currency)} hint={t.avgDealValue != null ? `avg ${formatMoney(Math.round(t.avgDealValue), currency)}` : "no deals yet"} icon={Coins} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Outcomes">
          <Bars items={r.outcomes.map((o) => ({ label: OUTCOME[o.outcome]?.label ?? o.outcome, value: o.count }))} />
        </Section>
        <Section title="Objections">
          <Bars items={r.objections.map((o) => ({ label: OBJECTION_LABEL[o.objection] ?? o.objection, value: o.count, color: "var(--chart-3)" }))} />
        </Section>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {groupTable("By host", r.byHost)}
        {groupTable("By booking page", r.byPage)}
      </div>
    </>
  );
}

async function SourcesReportView({ range }: { range: DateRange }) {
  const r = await getSourcesReport(range);
  const table = (title: string, rows: SourceRow[]) => (
    <Section title={title} note="Converted = registered for an event or booked a meeting">
      {rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">No contacts in this period.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Value</TableHead>
              <TableHead className="text-right">Contacts</TableHead>
              <TableHead className="text-right">Converted</TableHead>
              <TableHead className="pr-5 text-right">Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => (
              <TableRow key={s.key}>
                <TableCell className="pl-5 font-medium capitalize">{s.key.replace(/_/g, " ")}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(s.contacts)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(s.converted)}</TableCell>
                <TableCell className="pr-5 text-right tabular-nums">{formatPercent(s.conversion)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="New contacts" value={formatNumber(r.totalContacts)} icon={Users} />
        <StatCard label="With UTM tracking" value={formatNumber(r.withUtm)} hint={formatPercent(r.totalContacts ? r.withUtm / r.totalContacts : null)} icon={MousePointerClick} />
        <StatCard label="Converted" value={formatNumber(r.converted)} hint={formatPercent(r.totalContacts ? r.converted / r.totalContacts : null)} icon={Target} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {table("By source", r.bySource)}
        {table("By UTM source", r.byUtmSource)}
        {table("By UTM medium", r.byUtmMedium)}
        {table("By UTM campaign", r.byUtmCampaign)}
      </div>
    </>
  );
}
