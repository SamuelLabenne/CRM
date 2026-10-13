import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { CalendarX2 } from "lucide-react";
import { PublicCard, PublicShell } from "@/components/public/public-shell";
import { getCurrentUser } from "@/lib/auth";
import { recordPageView, utmFromParams } from "@/lib/leads";
import { getSetting } from "@/lib/settings";
import { getBookingPageBySlug, getPublicHosts } from "@/lib/scheduling/booking";
import { loadSlotHosts } from "@/lib/scheduling/slots";
import { BookingFlow } from "./booking-flow";
import { EmbedResizer } from "./embed-resizer";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Shared server component for /book/[slug] and /embed/book/[slug]. */
export async function PublicBookingPage({ slug, searchParams, embed }: { slug: string; searchParams: SearchParams; embed: boolean }) {
  const page = await getBookingPageBySlug(slug);
  if (!page) notFound();

  if (!page.isActive) {
    return (
      <PublicShell embed={embed}>
        <PublicCard className="mt-6 flex flex-col items-center gap-3 py-12 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <CalendarX2 className="size-6" />
          </span>
          <h1 className="text-xl font-semibold">This booking page is not available</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            It may have been paused or replaced. Please get in touch with the person who shared this link with you.
          </p>
        </PublicCard>
      </PublicShell>
    );
  }

  const utm = utmFromParams(searchParams);
  const [workspace, hosts, slotHosts, h, user] = await Promise.all([
    getSetting("workspace"),
    getPublicHosts(page.hostIds),
    loadSlotHosts(page.hostIds),
    headers(),
    getCurrentUser(),
  ]);

  // Staff previewing their own page should not distort the funnel numbers.
  if (!user) {
    try {
      await recordPageView({
        kind: "booking",
        targetId: page.id,
        ip: (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip"),
        userAgent: h.get("user-agent"),
        referrer: h.get("referer"),
        utm,
      });
    } catch (err) {
      console.error("[booking] page view failed", err);
    }
  }

  const name =
    first(searchParams.name) || [first(searchParams.first_name), first(searchParams.last_name)].filter(Boolean).join(" ");
  const hostTimezone = slotHosts[0]?.timezone ?? workspace.timezone;

  return (
    <PublicShell embed={embed} wide>
      {embed && <EmbedResizer />}
      <div className={embed ? "" : "mt-2"}>
        <BookingFlow
          slug={page.slug}
          embed={embed}
          page={{
            title: page.title,
            description: page.description,
            durationMinutes: page.durationMinutes,
            locationType: page.locationType,
            location: page.location,
            color: page.color,
            questions: page.questions,
          }}
          hosts={hosts}
          hostTimezone={hostTimezone}
          initialNowMs={Date.now()}
          maxDaysAhead={page.maxDaysAhead}
          weekStartsOn={workspace.weekStartsOn}
          prefill={{ name: name.slice(0, 120), email: first(searchParams.email).slice(0, 254), phone: first(searchParams.phone).slice(0, 40) }}
          utm={utm as Record<string, string>}
        />
      </div>
    </PublicShell>
  );
}
