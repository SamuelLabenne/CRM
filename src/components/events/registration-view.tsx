import { eq } from "drizzle-orm";
import { CalendarDays, Hourglass, MapPin, User, Users, Video } from "lucide-react";
import { db } from "@/lib/db";
import { users, type Event } from "@/lib/db/schema";
import { PublicCard } from "@/components/public/public-shell";
import { getSetting } from "@/lib/settings";
import { EVENT_TYPE_LABEL, capacityUsage, type PublicEventState } from "@/lib/events/utils";
import { LocalDateBlock, LocalTime } from "./local-time";
import { RegistrationForm } from "./registration-form";
import { ClosedNotice } from "./public-states";
import { EmbedResizer } from "./embed-resizer";
import type { Utm } from "@/lib/types";

function locationLine(e: Event): { icon: typeof MapPin; text: string } {
  if (e.locationType === "in_person") return { icon: MapPin, text: e.location || "In person" };
  if (e.locationType === "phone") return { icon: MapPin, text: e.location ? `Phone call · ${e.location}` : "Phone call" };
  return { icon: Video, text: e.location || "Online event · the link is emailed after you register" };
}

/** Public registration page body, shared by /e/[slug] and /embed/e/[slug]. */
export async function RegistrationView({
  event,
  state,
  seatsTaken,
  prefill,
  utm,
  embed = false,
}: {
  event: Event;
  state: PublicEventState;
  seatsTaken: number;
  prefill: { firstName: string; lastName: string; email: string; phone: string };
  utm: Utm;
  embed?: boolean;
}) {
  const [ws, host] = await Promise.all([
    getSetting("workspace"),
    event.hostId ? db.select({ name: users.name }).from(users).where(eq(users.id, event.hostId)).then((r) => r[0]) : Promise.resolve(undefined),
  ]);
  const tz = event.timezone || ws.timezone;
  const color = event.color || ws.brandColor;
  const usage = capacityUsage(seatsTaken, event.capacity);
  const loc = locationLine(event);
  const LocIcon = loc.icon;
  const canRegister = state === "open" || state === "waitlist";

  const details = (
    <div className="grid gap-5">
      {!embed && (
        <div
          className="relative h-36 overflow-hidden rounded-2xl sm:h-44"
          style={{ background: `linear-gradient(135deg, ${color}, color-mix(in oklch, ${color} 55%, #0f172a))` }}
        >
          {event.coverImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={event.coverImageUrl} alt="" className="absolute inset-0 size-full object-cover" />
          )}
          <span className="absolute bottom-3 left-3 rounded-full bg-black/40 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
            {EVENT_TYPE_LABEL[event.type] ?? "Event"}
          </span>
        </div>
      )}
      <div className="flex items-start gap-3">
        <LocalDateBlock startIso={event.startsAt.toISOString()} eventTz={tz} />
        <div className="min-w-0">
          <h1 className="text-2xl leading-tight font-semibold tracking-tight text-balance sm:text-3xl">{event.title}</h1>
          {embed && <p className="mt-0.5 text-xs text-muted-foreground">{EVENT_TYPE_LABEL[event.type] ?? "Event"}</p>}
        </div>
      </div>
      <ul className="grid gap-2.5 text-sm">
        <li className="flex items-start gap-2.5">
          <CalendarDays className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <LocalTime startIso={event.startsAt.toISOString()} endIso={event.endsAt.toISOString()} eventTz={tz} className="font-medium" />
        </li>
        <li className="flex items-start gap-2.5">
          <LocIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>{loc.text}</span>
        </li>
        {host && (
          <li className="flex items-start gap-2.5">
            <User className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>Hosted by {host.name}</span>
          </li>
        )}
        {usage && state === "open" && (
          <li className="flex items-start gap-2.5">
            <Users className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className={usage.left <= 5 ? "font-medium text-amber-600 dark:text-amber-400" : ""}>
              {usage.left} of {event.capacity} spots left
            </span>
          </li>
        )}
        {state === "waitlist" && (
          <li className="flex items-start gap-2.5">
            <Hourglass className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="font-medium text-amber-600 dark:text-amber-400">Full · join the waitlist and we&apos;ll email you if a spot opens</span>
          </li>
        )}
      </ul>
      {event.description && <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{event.description}</p>}
    </div>
  );

  const form = (
    <PublicCard className="p-5 sm:p-6">
      {canRegister ? (
        <>
          {!embed && (
            <h2 className="mb-4 text-lg font-semibold tracking-tight">{state === "waitlist" ? "Join the waitlist" : "Reserve your spot"}</h2>
          )}
          <RegistrationForm
            slug={event.slug!}
            questions={event.registrationQuestions}
            waitlist={state === "waitlist"}
            prefill={prefill}
            utm={utm}
            embed={embed}
          />
        </>
      ) : (
        <ClosedNotice state={state} />
      )}
    </PublicCard>
  );

  if (embed) {
    return (
      <div className="grid gap-6">
        <EmbedResizer id={event.slug!} />
        {details}
        {form}
      </div>
    );
  }
  return (
    <div className="grid items-start gap-6 md:grid-cols-5 md:gap-8">
      <div className="md:col-span-3">{details}</div>
      <div className="md:sticky md:top-6 md:col-span-2">{form}</div>
    </div>
  );
}
