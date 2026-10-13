import type { Metadata } from "next";
import { CalendarX2 } from "lucide-react";
import { PublicCard, PublicShell } from "@/components/public/public-shell";
import { RescheduleFlow } from "@/components/scheduling/reschedule-flow";
import { getSetting } from "@/lib/settings";
import { getPublicHosts, getRescheduleContext } from "@/lib/scheduling/booking";
import { serverNowMs } from "@/lib/scheduling/pages";
import { loadSlotHosts } from "@/lib/scheduling/slots";

export const metadata: Metadata = { title: "Reschedule your meeting", robots: { index: false } };

const REASONS: Record<string, string> = {
  not_found: "We could not find this booking. The link may be incorrect.",
  not_a_meeting: "Only one-to-one meetings can be rescheduled.",
  cancelled: "This meeting has been cancelled, so it cannot be rescheduled. You can book a new time from the original booking link.",
  past: "This meeting has already taken place.",
  no_page: "The booking page for this meeting is no longer available. Please contact your host to arrange a new time.",
};

export default async function ReschedulePage({ params }: PageProps<"/m/[token]/reschedule">) {
  const { token } = await params;
  const lookup = await getRescheduleContext(token);
  if (!lookup.ok) {
    return (
      <PublicShell>
        <PublicCard className="mt-6 flex flex-col items-center gap-3 py-12 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <CalendarX2 className="size-6" />
          </span>
          <h1 className="text-xl font-semibold">This meeting cannot be rescheduled</h1>
          <p className="max-w-sm text-sm text-muted-foreground">{REASONS[lookup.reason]}</p>
          {lookup.reason !== "not_found" && (
            <a href={`/m/${token}`} className="text-sm underline underline-offset-4">
              Back to your booking
            </a>
          )}
        </PublicCard>
      </PublicShell>
    );
  }
  const { page, event } = lookup.ctx;
  const [workspace, hosts, slotHosts] = await Promise.all([getSetting("workspace"), getPublicHosts(page.hostIds), loadSlotHosts(page.hostIds)]);
  const hostTimezone = slotHosts.find((h) => h.id === event.hostId)?.timezone ?? slotHosts[0]?.timezone ?? workspace.timezone;
  return (
    <PublicShell wide>
      <div className="mt-2">
        <RescheduleFlow
          token={token}
          page={{
            title: page.title,
            description: page.description,
            durationMinutes: page.durationMinutes,
            locationType: page.locationType,
            location: page.location,
            color: page.color,
          }}
          hosts={hosts}
          currentStartIso={event.startsAt.toISOString()}
          hostTimezone={hostTimezone}
          initialNowMs={serverNowMs()}
          maxDaysAhead={page.maxDaysAhead}
          weekStartsOn={workspace.weekStartsOn}
        />
      </div>
    </PublicShell>
  );
}
