import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  Coins,
  Mail,
  MailWarning,
  Megaphone,
  Ticket,
  UserPlus,
  Users,
  Video,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import {
  getDashboardKpis,
  getFunnel,
  getNeedsAttention,
  getOnboardingState,
  getRecentActivity,
  getRegistrationSeries,
  getTopCampaigns,
  getUpcoming,
} from "@/lib/analytics/dashboard";
import { DASHBOARD_RANGES, parseRangeKey, rangeLabel, resolveRange } from "@/lib/analytics/range";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { FunnelCard } from "@/components/dashboard/funnel-card";
import { GettingStarted } from "@/components/dashboard/getting-started";
import { RangeTabs } from "@/components/dashboard/range-tabs";
import { RegistrationsChart } from "@/components/dashboard/registrations-chart";
import { ACTIVITY_META, FALLBACK_ACTIVITY_META } from "@/components/contacts/activity-meta";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatInTz, formatMoney, formatNumber, formatPercent, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

function greeting(tz: string) {
  const h = Number(formatInTz(new Date(), tz, "H"));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser();
  const sp = await searchParams;
  const ws = await getSetting("workspace");
  const tz = ws.timezone;
  const key = parseRangeKey(sp.range, DASHBOARD_RANGES, "30");
  const range = resolveRange(key, tz);
  const welcome = sp.welcome === "1";

  const [kpis, funnel, series, upcoming, attention, activity, topCampaigns, onboarding] = await Promise.all([
    getDashboardKpis(range),
    getFunnel(range),
    getRegistrationSeries(range),
    getUpcoming(new Date(), 7, 8),
    getNeedsAttention(user.id),
    getRecentActivity(12),
    getTopCampaigns(range, 5),
    getOnboardingState(),
  ]);
  const c = kpis.current;
  const firstName = user.name.split(" ")[0] ?? user.name;
  const showOnboarding = welcome || onboarding.fresh || onboarding.done < onboarding.total;

  return (
    <>
      <PageHeader
        title={`${greeting(tz)}, ${firstName}`}
        description={`Here's what's happening at ${ws.name} · ${rangeLabel(key).toLowerCase()}`}
        actions={
          <RangeTabs
            basePath="/dashboard"
            current={key}
            options={DASHBOARD_RANGES.map((r) => ({ value: r, label: `${r}d` }))}
          />
        }
      />
      <PageBody>
        {showOnboarding && <GettingStarted state={onboarding} welcome={welcome} firstName={firstName} />}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          <KpiCard label="New contacts" value={formatNumber(c.newContacts)} icon={UserPlus} delta={kpis.deltas.newContacts} tone="primary" />
          <KpiCard label="Registrations" value={formatNumber(c.registrations)} icon={Ticket} delta={kpis.deltas.registrations} tone="violet" />
          <KpiCard
            label="Show-up rate"
            value={formatPercent(c.showUpRate)}
            icon={Users}
            delta={kpis.deltas.showUpRate}
            deltaKind="points"
            hint={`${c.attended} attended · ${c.noShow} no-show`}
            tone="emerald"
          />
          <KpiCard
            label="Emails delivered"
            value={formatNumber(c.emailsDelivered)}
            icon={Mail}
            delta={kpis.deltas.emailsDelivered}
            hint={`${formatPercent(c.openRate)} opened`}
            tone="sky"
          />
          <KpiCard label="Meetings booked" value={formatNumber(c.meetingsBooked)} icon={Video} delta={kpis.deltas.meetingsBooked} tone="amber" />
          <KpiCard
            label="Won value"
            value={formatMoney(c.wonValue, ws.currency)}
            icon={Coins}
            delta={kpis.deltas.wonValue}
            hint={`${c.wonCount} deal${c.wonCount === 1 ? "" : "s"}`}
            tone="rose"
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="gap-4 xl:col-span-2">
            <CardHeader>
              <CardTitle>Registrations & bookings</CardTitle>
              <p className="text-sm text-muted-foreground">New event registrations and booked meetings per day.</p>
            </CardHeader>
            <CardContent>
              <RegistrationsChart data={series} />
            </CardContent>
          </Card>
          <FunnelCard steps={funnel} />
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="gap-0 p-0 xl:col-span-2">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h2 className="font-semibold">Coming up · next 7 days</h2>
              <Button asChild size="sm" variant="ghost">
                <Link href="/calendar">
                  Calendar <ArrowRight />
                </Link>
              </Button>
            </div>
            {upcoming.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
                <CalendarCheck className="size-6" />
                Nothing scheduled in the next 7 days.
                <Button asChild size="sm" variant="outline" className="mt-1">
                  <Link href="/events/new">Plan an event</Link>
                </Button>
              </div>
            ) : (
              <ul className="divide-y">
                {upcoming.map((u) => (
                  <li key={u.id}>
                    <Link href={u.kind === "meeting" ? "/meetings" : `/events/${u.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-muted/50">
                      <div className="w-14 shrink-0 text-center">
                        <div className="text-xs font-medium uppercase text-muted-foreground">{formatInTz(u.startsAt, tz, "EEE")}</div>
                        <div className="text-lg leading-tight font-semibold">{formatInTz(u.startsAt, tz, "d")}</div>
                      </div>
                      <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: u.color ?? (u.kind === "meeting" ? "#0284c7" : "var(--primary)") }} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{u.title}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {formatInTz(u.startsAt, tz, "HH:mm")}–{formatInTz(u.endsAt, tz, "HH:mm")}
                          {u.kind === "meeting" ? ` · with ${u.contactName ?? "contact"}${u.hostName ? ` · host ${u.hostName}` : ""}` : u.campaignName ? ` · ${u.campaignName}` : ""}
                        </div>
                      </div>
                      {u.kind === "event" && (
                        <div className="shrink-0 text-right text-sm tabular-nums">
                          {u.registered}
                          {u.capacity ? <span className="text-muted-foreground">/{u.capacity}</span> : null}
                          <div className="text-xs text-muted-foreground">registered</div>
                        </div>
                      )}
                      {u.kind === "meeting" && <Video className="size-4 shrink-0 text-sky-600" />}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="gap-0 p-0">
            <div className="flex items-center gap-2 border-b px-5 py-3">
              <h2 className="font-semibold">Needs attention</h2>
              {attention.total > 0 && (
                <span className="rounded-full bg-amber-500/15 px-2 text-xs font-medium text-amber-700 dark:text-amber-300">{attention.total}</span>
              )}
            </div>
            {attention.total === 0 ? (
              <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
                <CheckCircle2 className="size-6 text-emerald-600" /> All caught up.
              </div>
            ) : (
              <ul className="divide-y text-sm">
                {attention.eventsWithoutAttendance.items.map((e) => (
                  <AttentionRow
                    key={e.id}
                    href={`/events/${e.id}?tab=attendees`}
                    icon={ClipboardCheck}
                    title={`Mark attendance: ${e.title}`}
                    sub={`${e.unmarked} attendee${e.unmarked === 1 ? "" : "s"} not marked · ended ${timeAgo(e.endsAt)}`}
                  />
                ))}
                {attention.meetingsWithoutOutcome.items.map((m) => (
                  <AttentionRow key={m.id} href="/meetings?tab=needs_outcome" icon={Video} title={`Log outcome: ${m.title}`} sub={`ended ${timeAgo(m.endsAt)}`} />
                ))}
                {attention.overdueTasks.items.map((t) => (
                  <AttentionRow key={t.id} href="/tasks" icon={AlertTriangle} title={t.title} sub={t.dueAt ? `overdue · due ${timeAgo(t.dueAt)}` : "overdue"} />
                ))}
                {attention.failedMessages > 0 && (
                  <AttentionRow href="/emails?tab=outbox&status=failed" icon={MailWarning} title={`${attention.failedMessages} email${attention.failedMessages === 1 ? "" : "s"} failed to send`} sub="Check your email settings" />
                )}
                {attention.failedJobs > 0 && (
                  <AttentionRow href="/settings/integrations" icon={AlertTriangle} title={`${attention.failedJobs} background job${attention.failedJobs === 1 ? "" : "s"} failed`} sub="See system status" />
                )}
              </ul>
            )}
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="gap-0 p-0 xl:col-span-2">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h2 className="font-semibold">Recent activity</h2>
              <Button asChild size="sm" variant="ghost">
                <Link href="/contacts">
                  Contacts <ArrowRight />
                </Link>
              </Button>
            </div>
            {activity.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">Activity from your contacts will show up here.</p>
            ) : (
              <ul className="divide-y">
                {activity.map((a) => {
                  const meta = ACTIVITY_META[a.type] ?? FALLBACK_ACTIVITY_META;
                  return (
                    <li key={a.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                      <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", meta.tone)}>
                        <meta.icon className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        {a.contactId ? (
                          <Link href={`/contacts/${a.contactId}`} className="font-medium hover:underline">
                            {a.contactName ?? "Contact"}
                          </Link>
                        ) : (
                          <span className="font-medium">System</span>
                        )}{" "}
                        <span className="text-muted-foreground">· {a.title}</span>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(a.createdAt)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card className="gap-0 p-0">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h2 className="font-semibold">Top campaigns</h2>
              <Button asChild size="sm" variant="ghost">
                <Link href="/campaigns">
                  All <ArrowRight />
                </Link>
              </Button>
            </div>
            {topCampaigns.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
                <Megaphone className="size-6" /> No campaign registrations in this period.
              </div>
            ) : (
              <ul className="grid gap-3 p-5">
                {topCampaigns.map((t) => {
                  const max = Math.max(1, ...topCampaigns.map((x) => x.registrations));
                  return (
                    <li key={t.id}>
                      <Link href={`/campaigns/${t.id}`} className="group grid gap-1.5">
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate font-medium group-hover:underline">{t.name}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">{t.registrations}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full" style={{ width: `${(t.registrations / max) * 100}%`, background: t.color }} />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </PageBody>
    </>
  );
}

function AttentionRow({ href, icon: Icon, title, sub }: { href: string; icon: typeof Video; title: string; sub: string }) {
  return (
    <li>
      <Link href={href} className="flex items-start gap-3 px-5 py-3 hover:bg-muted/50">
        <Icon className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <span className="min-w-0">
          <span className="block truncate font-medium">{title}</span>
          <span className="text-xs text-muted-foreground">{sub}</span>
        </span>
      </Link>
    </li>
  );
}
