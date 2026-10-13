import Link from "next/link";
import { eq } from "drizzle-orm";
import { AlertTriangle, CalendarClock, CheckCircle2, Eye, Link2, Loader2, MailCheck, MailX, MousePointerClick, UserMinus, Users } from "lucide-react";
import { db } from "@/lib/db";
import { campaigns, users, type Broadcast } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings";
import { formatDateTime, formatNumber, formatPercent, timeAgo } from "@/lib/format";
import { countAudience } from "@/lib/audience";
import { describeAudience } from "@/lib/email/audience-summary";
import {
  getBroadcastStats,
  getBroadcastTopLinks,
  listBroadcastRecipients,
  rate,
  RECIPIENT_FILTERS,
  type RecipientFilter,
} from "@/lib/email/broadcasts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/app/empty-state";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { BROADCAST_STATUS, MESSAGE_STATUS, MappedStatus } from "@/components/app/status-badge";
import { AutoRefresh } from "@/components/email/auto-refresh";
import { EmailPreview } from "@/components/email/email-preview";
import { Pager } from "@/components/email/pager";
import { cn } from "@/lib/utils";
import { getBranding } from "../_lib/branding";
import { BroadcastActions } from "./broadcast-actions";
import { CancelBroadcastButton } from "./cancel-broadcast-button";
import { OutboxModeBanner } from "./outbox-tab";

const FILTER_LABEL: Record<RecipientFilter, string> = {
  all: "All",
  delivered: "Delivered",
  opened: "Opened",
  clicked: "Clicked",
  failed: "Failed",
};

export async function BroadcastReport({ broadcast: b, filter, page }: { broadcast: Broadcast; filter: RecipientFilter; page: number }) {
  const { timezone } = await getSetting("workspace");
  const live = b.status === "sending" || b.status === "scheduled";
  const [stats, links, recipients, audienceText, branding, campaign, creator, totalAudience] = await Promise.all([
    getBroadcastStats(b.id),
    getBroadcastTopLinks(b.id, 8),
    listBroadcastRecipients(b.id, { filter, page, pageSize: 25 }),
    describeAudience(b.audience),
    getBranding(),
    b.campaignId ? db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns).where(eq(campaigns.id, b.campaignId)) : [],
    b.createdById ? db.select({ name: users.name }).from(users).where(eq(users.id, b.createdById)) : [],
    live ? countAudience(b.audience).catch(() => 0) : 0,
  ]);

  const delivered = stats.delivered;
  const sentCount = stats.total;
  const progress = b.status === "sending" && totalAudience > 0 ? Math.min(100, Math.round((sentCount / totalAudience) * 100)) : 0;

  return (
    <>
      <AutoRefresh active={live} intervalMs={b.status === "sending" ? 3000 : 15000} />
      <PageHeader
        back={{ href: "/emails", label: "Broadcasts" }}
        title={
          <span className="flex items-center gap-3">
            <span className="truncate">{b.name}</span>
            <MappedStatus map={BROADCAST_STATUS} value={b.status} />
          </span>
        }
        description={b.subject}
        actions={<BroadcastActions id={b.id} name={b.name} status={b.status} redirectAfterDelete variant="button" />}
      />
      <PageBody>
        {b.status === "scheduled" && b.scheduledAt && (
          <Alert>
            <CalendarClock />
            <AlertTitle>Scheduled for {formatDateTime(b.scheduledAt, timezone)}</AlertTitle>
            <AlertDescription>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  Will be sent {isFuture(b.scheduledAt) ? timeAgo(b.scheduledAt) : "shortly"} to {audienceText.toLowerCase()} ({formatNumber(totalAudience)} eligible
                  right now).
                </span>
                <CancelBroadcastButton id={b.id} name={b.name} mode="schedule" />
              </div>
            </AlertDescription>
          </Alert>
        )}
        {b.status === "sending" && (
          <Card>
            <CardContent className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Loader2 className="size-4 animate-spin text-primary" /> Sending…
                  <span className="font-normal text-muted-foreground tabular-nums">
                    {formatNumber(sentCount)}
                    {totalAudience > 0 ? ` of about ${formatNumber(totalAudience)}` : ""} emails processed
                  </span>
                </div>
                <CancelBroadcastButton id={b.id} name={b.name} mode="sending" />
              </div>
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground">This page refreshes automatically. Sending continues in the background even if you leave.</p>
            </CardContent>
          </Card>
        )}
        {b.status === "failed" && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>This broadcast failed</AlertTitle>
            <AlertDescription>
              {stats.total === 0
                ? "There were no eligible recipients when it was due to send, so nothing went out. Duplicate it to try again with an updated audience."
                : "Sending stopped unexpectedly. Check the recipients below, then duplicate the broadcast to resend to anyone who missed it."}
            </AlertDescription>
          </Alert>
        )}
        {b.status === "cancelled" && stats.total > 0 && (
          <Alert>
            <AlertTriangle />
            <AlertTitle>Sending was stopped</AlertTitle>
            <AlertDescription>{formatNumber(stats.total)} emails went out before it was stopped.</AlertDescription>
          </Alert>
        )}
        <OutboxModeBanner />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Recipients" value={formatNumber(b.status === "sent" ? b.recipientCount || stats.total : stats.total)} icon={Users} hint={audienceText} className="col-span-2 md:col-span-1" />
          <StatCard label="Delivered" value={formatNumber(delivered)} icon={MailCheck} hint={sentCount ? `${formatPercent(rate(delivered, sentCount))} of sent` : undefined} />
          <StatCard label="Opened" value={formatNumber(stats.opened)} icon={Eye} hint={`${formatPercent(rate(stats.opened, delivered))} open rate`} />
          <StatCard label="Clicked" value={formatNumber(stats.clicked)} icon={MousePointerClick} hint={`${formatPercent(rate(stats.clicked, delivered))} click rate`} />
          <StatCard label="Unsubscribed" value={formatNumber(stats.unsubscribed)} icon={UserMinus} hint="since this send" />
          <StatCard label="Failed" value={formatNumber(stats.failed)} icon={MailX} hint={stats.failed ? "see recipients below" : "no problems"} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Card className="gap-0 p-0">
            <CardHeader className="gap-3 border-b p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle>Recipients</CardTitle>
                  <CardDescription>Per-recipient delivery, opens and clicks.</CardDescription>
                </div>
                <nav className="flex flex-wrap gap-1" aria-label="Filter recipients">
                  {RECIPIENT_FILTERS.map((f) => (
                    <Link
                      key={f}
                      href={f === "all" ? `/emails/broadcasts/${b.id}` : `/emails/broadcasts/${b.id}?filter=${f}`}
                      aria-current={f === filter ? "page" : undefined}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                        f === filter ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {FILTER_LABEL[f]}
                    </Link>
                  ))}
                </nav>
              </div>
            </CardHeader>
            {recipients.rows.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={Users}
                  title={filter === "all" ? "No emails sent yet" : "Nobody matches this filter"}
                  description={filter === "all" ? "Recipients appear here as soon as the broadcast starts sending." : "Try another filter."}
                  className="border-0"
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Recipient</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Opened</TableHead>
                    <TableHead className="hidden sm:table-cell">Clicked</TableHead>
                    <TableHead className="pr-4 text-right">Sent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recipients.rows.map((r) => (
                    <TableRow key={r.id} className="relative">
                      <TableCell className="max-w-64 pl-4">
                        <Link href={`/emails/outbox/${r.id}`} className="block truncate font-medium after:absolute after:inset-0 hover:underline">
                          {r.toName || r.toEmail}
                        </Link>
                        {r.toName && <div className="truncate text-xs text-muted-foreground">{r.toEmail}</div>}
                      </TableCell>
                      <TableCell>
                        <MappedStatus map={MESSAGE_STATUS} value={r.status} />
                        {r.error && <div className="mt-0.5 max-w-48 truncate text-xs text-destructive">{r.error}</div>}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {r.openedAt ? (
                          <span className="inline-flex items-center gap-1 text-foreground">
                            <CheckCircle2 className="size-3.5 text-success" /> {r.openCount > 1 ? `${r.openCount}×` : timeAgo(r.openedAt)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {r.clickedAt ? (
                          <span className="inline-flex items-center gap-1 text-foreground">
                            <CheckCircle2 className="size-3.5 text-success" /> {r.clickCount > 1 ? `${r.clickCount}×` : timeAgo(r.clickedAt)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="pr-4 text-right whitespace-nowrap text-muted-foreground">{formatDateTime(r.sentAt ?? r.createdAt, timezone)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <div className="border-t p-4">
              <Pager
                basePath={`/emails/broadcasts/${b.id}`}
                params={{ filter: filter === "all" ? undefined : filter }}
                page={recipients.page}
                pageSize={recipients.pageSize}
                total={recipients.total}
              />
            </div>
          </Card>

          <div className="grid content-start gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Link2 className="size-4 text-muted-foreground" /> Top links
                </CardTitle>
                <CardDescription>Most clicked links in this email.</CardDescription>
              </CardHeader>
              <CardContent>
                {links.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No link clicks yet.</p>
                ) : (
                  <ul className="grid gap-3">
                    {links.map((l) => (
                      <li key={l.url} className="grid gap-1">
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 truncate hover:underline" title={l.url}>
                            {l.url.replace(/^https?:\/\//, "")}
                          </a>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {l.clicks} {l.clicks === 1 ? "click" : "clicks"}
                          </span>
                        </div>
                        <Progress value={links[0].clicks ? (l.clicks / links[0].clicks) * 100 : 0} className="h-1" />
                        <div className="text-xs text-muted-foreground">{l.uniqueClicks} unique {l.uniqueClicks === 1 ? "recipient" : "recipients"}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-3 text-sm">
                  <Detail label="Subject">{b.subject}</Detail>
                  {b.preheader && <Detail label="Preview text">{b.preheader}</Detail>}
                  <Detail label="Audience">{audienceText}</Detail>
                  {campaign[0] && (
                    <Detail label="Campaign">
                      <Link href={`/campaigns/${campaign[0].id}`} className="hover:underline">
                        {campaign[0].name}
                      </Link>
                    </Detail>
                  )}
                  {b.sentAt && <Detail label="Sent">{formatDateTime(b.sentAt, timezone)}</Detail>}
                  <Detail label="Created">
                    {formatDateTime(b.createdAt, timezone)}
                    {creator[0] ? ` by ${creator[0].name}` : ""}
                  </Detail>
                </dl>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Email preview</CardTitle>
            <CardDescription>How the email looks with sample data.</CardDescription>
          </CardHeader>
          <CardContent>
            <EmailPreview subject={b.subject} preheader={b.preheader} html={b.contentHtml} branding={branding} marketing readOnly />
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}

function isFuture(d: Date) {
  return d.getTime() > Date.now();
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}
