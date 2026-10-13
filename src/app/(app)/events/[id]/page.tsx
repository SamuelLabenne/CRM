import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { ExternalLink, Mail, MailPlus, ScanLine } from "lucide-react";
import { db } from "@/lib/db";
import { campaigns, events, messages } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { MappedStatus, EVENT_STATUS, MESSAGE_STATUS, StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EventActions } from "@/components/events/event-actions";
import { EventForm } from "@/components/events/event-form";
import { ShareCard } from "@/components/events/share-card";
import { TabLinks } from "@/components/events/tab-links";
import { eventLocationText } from "@/lib/email/context";
import { formatInTz, formatTimeRange, timeAgo } from "@/lib/format";
import { eventStatsMap, upcomingEventEmails } from "@/lib/events/queries";
import { eventToFormValues, loadEventFormData } from "@/lib/events/form-data";
import { EVENT_TYPE_LABEL, currentTimeMs, describeScheduledEmail } from "@/lib/events/utils";
import { absoluteUrl, eventPublicPath } from "@/lib/urls";
import { OverviewTab } from "./overview-tab";
import { AttendeesTab } from "./attendees-tab";

const TABS = ["overview", "attendees", "registration", "emails", "settings"] as const;
type Tab = (typeof TABS)[number];
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export async function generateMetadata({ params }: PageProps<"/events/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { title: "Event" };
  const [e] = await db.select({ title: events.title }).from(events).where(eq(events.id, id));
  return { title: e?.title ?? "Event" };
}

export default async function EventPage({ params, searchParams }: PageProps<"/events/[id]">) {
  await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  const [event] = await db.select().from(events).where(eq(events.id, id));
  if (!event) notFound();
  if (event.kind === "meeting") redirect("/meetings");
  const tab: Tab = (TABS as readonly string[]).includes(first(sp.tab)) ? (first(sp.tab) as Tab) : "overview";

  const [ws, stats] = await Promise.all([getSetting("workspace"), eventStatsMap([id]).then((m) => m.get(id)!)]);
  const tz = event.timezone || ws.timezone;
  const ended = event.endsAt.getTime() < currentTimeMs();
  const campaign = event.campaignId ? (await db.select({ id: campaigns.id, name: campaigns.name, color: campaigns.color }).from(campaigns).where(eq(campaigns.id, event.campaignId)))[0] : null;
  const live = !!event.slug && event.isPublic && event.status === "scheduled";

  const tabHref = (t: Tab) => (t === "overview" ? `/events/${id}` : `/events/${id}?tab=${t}`);
  const attendeeCount = stats.nonCancelled;

  return (
    <>
      <PageHeader
        back={{ href: "/events", label: "Events" }}
        title={
          <span className="inline-flex max-w-full items-center gap-2.5">
            <span className="truncate">{event.title}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{formatTimeRange(event.startsAt, event.endsAt, tz)}</span>
            <span className="text-muted-foreground/60">·</span>
            <span>{EVENT_TYPE_LABEL[event.type] ?? "Event"}</span>
            <span className="text-muted-foreground/60">·</span>
            <span>{eventLocationText(event)}</span>
            {campaign && (
              <>
                <span className="text-muted-foreground/60">·</span>
                <Link href={`/campaigns/${campaign.id}`} className="inline-flex items-center gap-1.5 hover:text-foreground hover:underline">
                  <span className="size-2 rounded-full" style={{ background: campaign.color }} /> {campaign.name}
                </Link>
              </>
            )}
          </span>
        }
        actions={
          <>
            <MappedStatus map={EVENT_STATUS} value={event.status} />
            {event.status === "scheduled" && ended && <StatusBadge tone="green">Ended</StatusBadge>}
            {live && (
              <Button asChild variant="outline">
                <a href={eventPublicPath(event.slug!)} target="_blank" rel="noreferrer">
                  <ExternalLink /> Public page
                </a>
              </Button>
            )}
            <Button asChild>
              <Link href={`/events/${id}/check-in`}>
                <ScanLine /> Check-in
              </Link>
            </Button>
            <EventActions eventId={id} status={event.status} attendees={attendeeCount} title={event.title} />
          </>
        }
      >
        <TabLinks
          active={tab}
          tabs={[
            { key: "overview", label: "Overview", href: tabHref("overview") },
            { key: "attendees", label: "Attendees", href: tabHref("attendees"), count: attendeeCount },
            { key: "registration", label: "Registration page", href: tabHref("registration") },
            { key: "emails", label: "Emails", href: tabHref("emails") },
            { key: "settings", label: "Settings", href: tabHref("settings") },
          ]}
        />
      </PageHeader>
      <PageBody>
        {event.status === "cancelled" && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">This event is cancelled. Reopen it from the ⋯ menu to accept registrations again.</div>
        )}
        {event.status === "draft" && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
            <span>This event is a draft. The public registration page is hidden until you publish it.</span>
            <Button asChild size="sm" variant="outline">
              <Link href={tabHref("settings")}>Publish in Settings</Link>
            </Button>
          </div>
        )}

        {tab === "overview" && <OverviewTab event={event} tz={tz} />}
        {tab === "attendees" && <AttendeesTab event={event} tz={tz} sp={sp} />}
        {tab === "registration" && <RegistrationTab event={event} workspaceTz={ws.timezone} />}
        {tab === "emails" && <EmailsTab event={event} tz={tz} workspaceTz={ws.timezone} />}
        {tab === "settings" && <SettingsTab event={event} workspaceTz={ws.timezone} />}
      </PageBody>
    </>
  );
}

async function RegistrationTab({ event, workspaceTz }: { event: typeof events.$inferSelect; workspaceTz: string }) {
  const data = await loadEventFormData();
  const slug = event.slug;
  const live = !!slug && event.isPublic && event.status === "scheduled";
  return (
    <div className="grid items-start gap-6 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <EventForm mode="edit" eventId={event.id} sections={["registration"]} initial={eventToFormValues(event, workspaceTz)} {...data} />
      </div>
      {slug && (
        <ShareCard
          url={absoluteUrl(eventPublicPath(slug))}
          embedUrl={absoluteUrl(`/embed/e/${slug}`)}
          embedId={slug}
          live={live}
          notLiveReason={!event.isPublic ? "The public page is switched off." : event.status === "draft" ? "Publish the event to make the page live." : event.status === "cancelled" ? "This event is cancelled." : undefined}
          title="Share this event"
        />
      )}
    </div>
  );
}

async function EmailsTab({ event, tz, workspaceTz }: { event: typeof events.$inferSelect; tz: string; workspaceTz: string }) {
  const [data, scheduled, recent] = await Promise.all([
    loadEventFormData(),
    upcomingEventEmails(event.id),
    db.select().from(messages).where(eq(messages.eventId, event.id)).orderBy(desc(messages.createdAt)).limit(8),
  ]);
  return (
    <div className="grid items-start gap-6 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <EventForm mode="edit" eventId={event.id} sections={["notifications"]} initial={eventToFormValues(event, workspaceTz)} {...data} />
      </div>
      <div className="grid gap-6">
        <Card className="gap-3 p-4">
          <h3 className="text-sm font-semibold">Email your attendees</h3>
          <p className="text-sm text-muted-foreground">Send a one-off broadcast to everyone registered for this event.</p>
          <Button asChild variant="outline" className="w-fit">
            <Link href={`/emails/broadcasts/new?eventId=${event.id}`}>
              <MailPlus /> New broadcast
            </Link>
          </Button>
        </Card>
        <Card className="gap-3 p-4">
          <h3 className="text-sm font-semibold">Scheduled</h3>
          {scheduled.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing queued yet.</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {scheduled.map((s) => (
                <li key={`${s.kind}-${s.reminderId}-${s.followUpId}-${s.runAt.toISOString()}`} className="grid gap-0.5 rounded-lg border px-3 py-2">
                  <span className="font-medium">{describeScheduledEmail(s, event.notifications)}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatInTz(s.runAt, tz, "EEE d MMM, h:mm a")} · {s.recipients} {s.recipients === 1 ? "recipient" : "recipients"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="gap-3 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Mail className="size-4 text-muted-foreground" /> Recently sent
          </h3>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No emails sent for this event yet.</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {recent.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/emails/outbox/${m.id}`} className="block truncate font-medium hover:underline">
                      {m.subject}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {m.toEmail} · {timeAgo(m.createdAt)}
                    </span>
                  </div>
                  <MappedStatus map={MESSAGE_STATUS} value={m.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

async function SettingsTab({ event, workspaceTz }: { event: typeof events.$inferSelect; workspaceTz: string }) {
  const data = await loadEventFormData();
  return (
    <div className="max-w-4xl">
      <EventForm
        mode="edit"
        eventId={event.id}
        sections={["details"]}
        initial={eventToFormValues(event, workspaceTz)}
        canChangeStatus={event.status === "draft" || event.status === "scheduled"}
        {...data}
      />
    </div>
  );
}
