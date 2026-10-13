import { CalendarX2, Ban, Lock, Users, CircleSlash } from "lucide-react";
import { PublicCard, PublicShell } from "@/components/public/public-shell";
import type { PublicEventState } from "@/lib/events/utils";

const STATE_COPY: Record<Exclude<PublicEventState, "open" | "waitlist">, { icon: typeof Lock; title: string; body: string }> = {
  full: { icon: Users, title: "This event is full", body: "All spots have been taken. Check back later in case someone cancels." },
  closed: { icon: Lock, title: "Registration is closed", body: "This event is no longer accepting registrations." },
  past: { icon: CalendarX2, title: "This event has ended", body: "Thanks for your interest. Keep an eye out for our next event." },
  cancelled: { icon: Ban, title: "This event was cancelled", body: "We're sorry for the inconvenience." },
};

/** Replaces the registration form when nobody can register right now. */
export function ClosedNotice({ state }: { state: Exclude<PublicEventState, "open" | "waitlist"> }) {
  const { icon: Icon, title, body } = STATE_COPY[state];
  return (
    <div className="grid gap-3 py-2 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-6" />
      </div>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

/** Friendly 404 inside the branded public shell. */
export function PublicNotFound({ title = "Page not found", body = "This link is invalid or no longer available.", embed }: { title?: string; body?: string; embed?: boolean }) {
  return (
    <PublicShell embed={embed}>
      <PublicCard className="text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <CircleSlash className="size-6" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
      </PublicCard>
    </PublicShell>
  );
}
