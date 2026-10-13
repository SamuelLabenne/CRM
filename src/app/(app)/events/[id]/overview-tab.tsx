import Link from "next/link";
import { BarChart3, CalendarClock, ClipboardCheck, Eye, Hourglass, MailPlus, MousePointerClick, Percent, ScanLine, UserCheck, UserRoundX, Users, UsersRound } from "lucide-react";
import { StatCard } from "@/components/app/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CapacityBar } from "@/components/events/capacity-bar";
import { RegistrationsChart } from "@/components/events/registrations-chart";
import { ShareCard } from "@/components/events/share-card";
import { formatInTz, formatPercent } from "@/lib/format";
import { absoluteUrl, eventPublicPath } from "@/lib/urls";
import { getEventOverview, registrationSeries, upcomingEventEmails } from "@/lib/events/queries";
import { describeScheduledEmail, currentTimeMs } from "@/lib/events/utils";
import type { Event } from "@/lib/db/schema";

export async function OverviewTab({ event, tz }: { event: Event; tz: string }) {
  const [overview, series, scheduled] = await Promise.all([getEventOverview(event.id), registrationSeries(event, tz), upcomingEventEmails(event.id)]);
  const { stats } = overview;
  const ended = event.endsAt.getTime() < currentTimeMs();
  const slug = event.slug;
  const live = !!slug && event.isPublic && event.status === "scheduled";
  const notLive = !slug || !event.isPublic ? "The public registration page is switched off. Enable it in the Registration page tab." : event.status === "draft" ? "This event is still a draft: publish it from Settings to open the page." : event.status === "cancelled" ? "This event is cancelled." : undefined;
  const chart = series.map((p) => ({ ...p, label: formatInTz(`${p.date}T12:00:00Z`, "UTC", "d MMM") }));

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Registered" value={stats.seatsTaken} icon={Users} hint={event.capacity != null ? `of ${event.capacity} seats` : "no seat limit"} />
        <StatCard label="Confirmed (RSVP yes)" value={stats.confirmed} icon={UserCheck} hint={stats.registered ? `${stats.registered} not yet confirmed` : undefined} />
        <StatCard label="Waitlisted" value={stats.waitlisted} icon={Hourglass} hint={event.waitlistEnabled ? "waitlist on" : "waitlist off"} />
        <StatCard label="Attended" value={stats.attended} icon={ClipboardCheck} hint={ended ? `${formatPercent(stats.attendanceRate, 0)} attendance` : undefined} />
        <StatCard label="No-show" value={stats.noShow} icon={UserRoundX} />
        <StatCard label="Show-up rate" value={formatPercent(stats.showUpRate, 0)} icon={Percent} hint="attended ÷ (attended + no-show)" />
        <StatCard label="Page views" value={overview.pageViews} icon={Eye} hint="unique visitors" />
        <StatCard label="Conversion" value={formatPercent(overview.conversion)} icon={MousePointerClick} hint={`${overview.publicRegistrations} public sign-ups`} />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="grid gap-6 xl:col-span-2">
          <Card className="gap-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <BarChart3 className="size-4 text-muted-foreground" /> Registrations over time
              </h3>
              {event.capacity != null && <CapacityBar className="w-44" taken={stats.seatsTaken} capacity={event.capacity} waitlisted={stats.waitlisted} color={event.color} />}
            </div>
            {chart.length > 1 ? (
              <RegistrationsChart data={chart} />
            ) : (
              <p className="grid h-32 place-items-center rounded-lg bg-muted/40 text-sm text-muted-foreground">
                {chart.length === 1 ? `${chart[0].total} registration${chart[0].total === 1 ? "" : "s"} so far: the trend appears from the second day.` : "No registrations yet. Share the link to get started."}
              </p>
            )}
          </Card>

          <Card className="gap-3 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <CalendarClock className="size-4 text-muted-foreground" /> Scheduled emails
            </h3>
            {scheduled.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing queued. Reminders and follow-ups appear here once people register.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {scheduled.map((s) => (
                  <li key={`${s.kind}-${s.reminderId}-${s.followUpId}-${s.runAt.toISOString()}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="font-medium">{describeScheduledEmail(s, event.notifications)}</span>
                    <span className="text-muted-foreground">
                      {formatInTz(s.runAt, tz, "EEE d MMM, h:mm a")} · {s.recipients} {s.recipients === 1 ? "recipient" : "recipients"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link href={`/events/${event.id}?tab=emails`} className="w-fit text-sm font-medium text-primary hover:underline">
              Edit emails
            </Link>
          </Card>
        </div>

        <div className="grid gap-6">
          <Card className="gap-3 p-4">
            <h3 className="text-sm font-semibold">Quick actions</h3>
            <div className="grid gap-2">
              <Button asChild>
                <Link href={`/events/${event.id}/check-in`}>
                  <ScanLine /> Open check-in mode
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/emails/broadcasts/new?eventId=${event.id}`}>
                  <MailPlus /> Email attendees
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/events/${event.id}?tab=attendees`}>
                  <UsersRound /> Manage attendees
                </Link>
              </Button>
            </div>
          </Card>
          {slug ? (
            <ShareCard
              url={absoluteUrl(eventPublicPath(slug))}
              embedUrl={absoluteUrl(`/embed/e/${slug}`)}
              embedId={slug}
              live={live}
              notLiveReason={notLive}
              title="Registration page"
            />
          ) : (
            <Card className="gap-2 p-4">
              <h3 className="text-sm font-semibold">Registration page</h3>
              <p className="text-sm text-muted-foreground">No public page yet. Turn it on in the Registration page tab to get a shareable link and embed code.</p>
              <Button asChild variant="outline" size="sm" className="w-fit">
                <Link href={`/events/${event.id}?tab=registration`}>Set up page</Link>
              </Button>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
