"use client";

import { useCallback, useState } from "react";
import { format } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { BookingSummary, ConfirmationView, type PublicHost, type PublicPageInfo } from "./booking-flow";
import { getRescheduleSlotsAction, rescheduleAction, type BookingConfirmation } from "./public-actions";
import { SlotPicker, useBrowserTimezone, type ConfirmResult } from "./slot-picker";

export function RescheduleFlow({
  token,
  page,
  hosts,
  currentStartIso,
  hostTimezone,
  initialNowMs,
  maxDaysAhead,
  weekStartsOn,
}: {
  token: string;
  page: PublicPageInfo;
  hosts: PublicHost[];
  currentStartIso: string;
  hostTimezone: string;
  initialNowMs: number;
  maxDaysAhead: number;
  weekStartsOn: 0 | 1;
}) {
  const browserTz = useBrowserTimezone(hostTimezone);
  const [done, setDone] = useState<{ data: BookingConfirmation; timezone: string } | null>(null);

  const fetchSlots = useCallback(
    async (from: string, to: string) => {
      const res = await getRescheduleSlotsAction({ token, from, to });
      return res.ok ? { ok: true as const, slots: res.data?.slots ?? [] } : { ok: false as const, error: res.error };
    },
    [token],
  );

  const confirm = useCallback(
    async (start: string, timezone: string): Promise<ConfirmResult> => {
      const res = await rescheduleAction({ token, start, timezone });
      if (!res.ok) return { error: res.error, refresh: res.fieldErrors?.code?.[0] === "slot_unavailable" };
      setDone({ data: res.data!, timezone });
      return null;
    },
    [token],
  );

  const current = new TZDate(new Date(currentStartIso).getTime(), browserTz);

  return (
    <div
      style={{ "--brand": page.color } as React.CSSProperties}
      className="grid overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-sm md:grid-cols-[17rem_minmax(0,1fr)]"
    >
      <BookingSummary page={page} hosts={hosts}>
        {!done && (
          <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-sm">
            <div className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              <CalendarClock className="size-3.5" /> Current time
            </div>
            <div className="mt-1 font-medium">{format(current, "EEEE d MMMM")}</div>
            <div className="text-muted-foreground">{format(current, "HH:mm")}</div>
          </div>
        )}
      </BookingSummary>
      <section className={cn("flex min-w-0 flex-col gap-5 p-6 sm:p-8")}>
        {done ? (
          <>
            <ConfirmationView data={done.data} timezone={done.timezone} embed={false} heading="Meeting rescheduled" subtitle="We have updated your booking and sent a new confirmation." />
            <a href={`/m/${token}`} className="mx-auto text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
              Back to your booking
            </a>
          </>
        ) : (
          <>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Pick a new time</h2>
              <p className="text-sm text-muted-foreground">Choose another time that suits you. Your current booking stays in place until you confirm.</p>
            </div>
            <SlotPicker
              fetchSlots={fetchSlots}
              onConfirm={confirm}
              hostTimezone={hostTimezone}
              initialNowMs={initialNowMs}
              maxDaysAhead={maxDaysAhead}
              weekStartsOn={weekStartsOn}
              confirmLabel="Reschedule"
            />
            <a href={`/m/${token}`} className="w-fit text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
              Cancel and go back
            </a>
          </>
        )}
      </section>
    </div>
  );
}
