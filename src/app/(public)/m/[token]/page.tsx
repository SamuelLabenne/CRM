import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Ban, CalendarClock, CalendarDays, CheckCircle2, Hourglass, MapPin, PartyPopper, User, UserX, Video } from "lucide-react";
import { db } from "@/lib/db";
import { bookingPages, users } from "@/lib/db/schema";
import { PublicCard, PublicShell } from "@/components/public/public-shell";
import { ManagePanel } from "@/components/events/manage-panel";
import { JoinLink } from "@/components/events/join-link";
import { LocalTime } from "@/components/events/local-time";
import { brandBtn, outlineBtn } from "@/components/events/brand";
import { attendeeLinks, loadAttendeeByToken } from "@/lib/events/public";
import { eventLocationText } from "@/lib/email/context";
import { getSetting } from "@/lib/settings";
import { EVENT_TYPE_LABEL, currentTimeMs } from "@/lib/events/utils";
import type { Rsvp } from "@/lib/types";

export const metadata: Metadata = { title: "Your registration", robots: { index: false, follow: false } };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ManageRegistrationPage({ params, searchParams }: PageProps<"/m/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  const row = await loadAttendeeByToken(token);
  if (!row) notFound();
  const { attendee, event, contact } = row;

  const [ws, host, bookingPage] = await Promise.all([
    getSetting("workspace"),
    event.hostId ? db.select({ name: users.name }).from(users).where(eq(users.id, event.hostId)).then((r) => r[0]) : Promise.resolve(undefined),
    event.kind === "meeting" && event.bookingPageId
      ? db.select({ slug: bookingPages.slug, active: bookingPages.isActive }).from(bookingPages).where(eq(bookingPages.id, event.bookingPageId)).then((r) => r[0])
      : Promise.resolve(undefined),
  ]);
  const tz = event.timezone || ws.timezone;
  const nowMs = currentTimeMs();
  const isMeeting = event.kind === "meeting";
  const ended = event.endsAt.getTime() <= nowMs;
  const cancelled = attendee.status === "cancelled";
  const eventCancelled = event.status === "cancelled";
  const canAct = !cancelled && !eventCancelled && !ended;
  const canRsvp = canAct && (attendee.status === "registered" || attendee.status === "confirmed");

  const rsvpParam = first(sp.rsvp);
  const intent =
    first(sp.action) === "cancel"
      ? ({ type: "cancel" } as const)
      : rsvpParam === "no"
        ? ({ type: "cancel" } as const)
        : rsvpParam === "yes" || rsvpParam === "maybe"
          ? ({ type: "rsvp", value: rsvpParam } as const)
          : null;

  const banner = (() => {
    if (eventCancelled) return { icon: Ban, tone: "red", title: isMeeting ? "This meeting was cancelled" : "This event was cancelled", body: "We're sorry for the inconvenience." };
    if (cancelled) return { icon: Ban, tone: "neutral", title: isMeeting ? "Your meeting is cancelled" : "Your registration is cancelled", body: attendee.cancelReason ? `Reason: ${attendee.cancelReason}` : "You won't receive reminders for this event." };
    if (attendee.status === "attended") return { icon: PartyPopper, tone: "green", title: "Thanks for joining!", body: "We're glad you could make it." };
    if (attendee.status === "no_show") return { icon: UserX, tone: "neutral", title: "We missed you", body: "We're sorry you couldn't make it this time." };
    if (ended) return { icon: CalendarDays, tone: "neutral", title: isMeeting ? "This meeting has taken place" : "This event has ended", body: "Keep an eye out for what's next." };
    if (attendee.status === "waitlisted") return { icon: Hourglass, tone: "amber", title: "You're on the waitlist", body: "We'll email you as soon as a spot opens up." };
    if (attendee.status === "confirmed") return { icon: CheckCircle2, tone: "green", title: "You're confirmed", body: isMeeting ? "Your meeting is booked." : "We're looking forward to seeing you." };
    return { icon: CheckCircle2, tone: "green", title: isMeeting ? "Your meeting is booked" : "You're registered", body: isMeeting ? "We've sent the details to your email." : "Let us know if you can make it below." };
  })();
  const Banner = banner.icon;
  const toneClass =
    banner.tone === "green"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : banner.tone === "amber"
        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
        : banner.tone === "red"
          ? "bg-red-500/10 text-red-600 dark:text-red-400"
          : "bg-muted text-muted-foreground";

  const links = attendeeLinks(event, attendee.manageToken);
  const locIcon = event.locationType === "online" ? Video : MapPin;
  const LocIcon = locIcon;
  const showJoin = canAct && event.locationType === "online" && !!event.meetingUrl && attendee.status !== "waitlisted";
  const canReschedule = isMeeting && canAct && !!event.bookingPageId;
  const canRebook = isMeeting && !!bookingPage?.active && (cancelled || eventCancelled || ended || canAct);
  const canReregister = !isMeeting && (cancelled || attendee.status === "no_show") && !eventCancelled && !ended && event.isPublic && !!event.slug && event.registrationOpen;

  return (
    <PublicShell>
      <PublicCard className="grid gap-6">
        <div className="flex items-start gap-4">
          <div className={`grid size-12 shrink-0 place-items-center rounded-full ${toneClass}`}>
            <Banner className="size-6" />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Hi {contact.firstName || "there"},</p>
            <h1 className="text-xl font-semibold tracking-tight text-balance">{banner.title}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{banner.body}</p>
          </div>
        </div>

        <div className="grid gap-3 rounded-xl border bg-muted/30 p-4">
          <div>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{isMeeting ? "Meeting" : (EVENT_TYPE_LABEL[event.type] ?? "Event")}</p>
            <h2 className="text-lg font-semibold tracking-tight">{event.title}</h2>
          </div>
          <ul className="grid gap-2 text-sm">
            <li className="flex items-start gap-2.5">
              <CalendarDays className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <LocalTime startIso={event.startsAt.toISOString()} endIso={event.endsAt.toISOString()} eventTz={tz} className="font-medium" />
            </li>
            <li className="flex items-start gap-2.5">
              <LocIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>{eventLocationText(event)}</span>
            </li>
            {host && (
              <li className="flex items-start gap-2.5">
                <User className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>{isMeeting ? `With ${host.name}` : `Hosted by ${host.name}`}</span>
              </li>
            )}
          </ul>
          {showJoin && <JoinLink url={event.meetingUrl!} startIso={event.startsAt.toISOString()} endIso={event.endsAt.toISOString()} nowMs={nowMs} />}
        </div>

        {canAct && (
          <ManagePanel
            token={token}
            rsvp={(attendee.rsvp as Rsvp | null) ?? null}
            canRsvp={canRsvp}
            canCancel={canAct}
            intent={intent}
            calendar={attendee.status === "waitlisted" ? null : { google: links.google, ics: links.ics }}
            cancelLabel={isMeeting ? "Cancel this meeting" : "Cancel my registration"}
          />
        )}

        {(canReschedule || canRebook || canReregister) && (
          <div className="flex flex-wrap gap-2">
            {canReschedule && (
              <Link href={`/m/${token}/reschedule`} className={brandBtn}>
                <CalendarClock className="size-4" /> Reschedule
              </Link>
            )}
            {canRebook && bookingPage && (
              <Link href={`/book/${bookingPage.slug}`} className={canReschedule ? outlineBtn : brandBtn}>
                Book another time
              </Link>
            )}
            {canReregister && (
              <Link href={`/e/${event.slug}`} className={brandBtn}>
                Register again
              </Link>
            )}
          </div>
        )}
      </PublicCard>
    </PublicShell>
  );
}
