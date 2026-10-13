"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { CalendarCheck, CalendarPlus, CheckCircle2, Clock, Download, ExternalLink, Loader2, MapPin, Phone, Video } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/app/user-avatar";
import { QuestionFields, answersFromFormData } from "@/components/forms/question-fields";
import { cn } from "@/lib/utils";
import { durationLabel } from "@/lib/scheduling/defaults";
import type { Answers, FormQuestion, LocationType } from "@/lib/types";
import { SlotPicker, type ConfirmResult } from "./slot-picker";
import {
  confirmBookingAction,
  getSlotsAction,
  startBookingAction,
  submitQualificationAction,
  type BookingConfirmation,
} from "./public-actions";

export const brandBtn =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60 bg-[var(--brand)]";

export type PublicPageInfo = {
  title: string;
  description: string | null;
  durationMinutes: number;
  locationType: LocationType;
  location: string | null;
  color: string;
};

export type PublicHost = { name: string; color: string; title: string | null };

const LOCATION_ICON = { online: Video, phone: Phone, in_person: MapPin } as const;
const LOCATION_TEXT: Record<LocationType, string> = { online: "Web conference details provided upon confirmation", phone: "Phone call", in_person: "In person" };

export function LocationLine({ type, location }: { type: LocationType; location: string | null }) {
  const Icon = LOCATION_ICON[type];
  const text = type === "in_person" ? location || LOCATION_TEXT.in_person : type === "phone" ? (location ? `Phone call (${location})` : LOCATION_TEXT.phone) : LOCATION_TEXT.online;
  return (
    <div className="flex items-start gap-2 text-sm text-muted-foreground">
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

/** Left panel: who, what, how long, where. */
export function BookingSummary({ page, hosts, children }: { page: PublicPageInfo; hosts: PublicHost[]; children?: React.ReactNode }) {
  return (
    <aside className="flex flex-col gap-4 border-b p-6 md:border-r md:border-b-0">
      {hosts.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2">
            {hosts.slice(0, 4).map((h) => (
              <UserAvatar key={h.name} name={h.name} color={h.color} className="size-9 rounded-full ring-2 ring-card" />
            ))}
          </div>
          <div className="min-w-0 text-sm">
            <div className="truncate font-medium">{hosts.length === 1 ? hosts[0].name : `${hosts[0].name} +${hosts.length - 1}`}</div>
            {hosts.length === 1 && hosts[0].title && <div className="truncate text-xs text-muted-foreground">{hosts[0].title}</div>}
          </div>
        </div>
      )}
      <h1 className="text-2xl font-semibold tracking-tight text-balance">{page.title}</h1>
      <div className="grid gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="size-4 shrink-0" />
          {durationLabel(page.durationMinutes)}
        </div>
        <LocationLine type={page.locationType} location={page.location} />
      </div>
      {page.description && <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">{page.description}</p>}
      {children}
    </aside>
  );
}

function navigateTo(url: string, embed: boolean) {
  try {
    if (embed && window.top) window.top.location.href = url;
    else window.location.href = url;
  } catch {
    window.location.href = url;
  }
}

function RedirectAfter({ url, embed, ms }: { url: string; embed: boolean; ms: number }) {
  useEffect(() => {
    const t = setTimeout(() => navigateTo(url, embed), ms);
    return () => clearTimeout(t);
  }, [url, embed, ms]);
  return null;
}

/** "You are booked" / "Rescheduled" card body (time shown in the visitor's timezone). */
export function ConfirmationView({
  data,
  timezone,
  embed,
  heading = "You are booked!",
  subtitle,
}: {
  data: BookingConfirmation;
  timezone: string;
  embed: boolean;
  heading?: string;
  subtitle?: string;
}) {
  const start = new TZDate(new Date(data.startIso).getTime(), timezone);
  const end = new TZDate(new Date(data.endIso).getTime(), timezone);
  const tzLabel = timezone.replace(/_/g, " ");
  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-8" />
      </span>
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{heading}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle ?? "A confirmation is on its way to your inbox."}</p>
      </div>
      <div className="w-full max-w-sm rounded-xl border bg-muted/40 p-4 text-left text-sm">
        <div className="font-semibold">{data.title}</div>
        <div className="mt-3 grid gap-2 text-muted-foreground">
          <div className="flex items-start gap-2">
            <CalendarCheck className="mt-0.5 size-4 shrink-0" />
            <div>
              <div className="font-medium text-foreground">{format(start, "EEEE d MMMM yyyy")}</div>
              <div>
                {format(start, "HH:mm")} – {format(end, "HH:mm")} <span className="text-xs">({tzLabel})</span>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <div>{data.locationText}</div>
              {data.meetingUrl && (
                <a href={data.meetingUrl} target="_blank" rel="noreferrer" className="block truncate text-[var(--brand)] underline">
                  {data.meetingUrl}
                </a>
              )}
            </div>
          </div>
          <div className="text-xs">With {data.hostName}</div>
        </div>
      </div>
      {data.confirmationMessage && <p className="max-w-sm text-sm whitespace-pre-line">{data.confirmationMessage}</p>}
      <div className="flex flex-wrap justify-center gap-2">
        <a href={data.googleUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-muted">
          <CalendarPlus className="size-4" /> Google Calendar
        </a>
        <a href={data.icsPath} className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-muted">
          <Download className="size-4" /> Apple / Outlook (.ics)
        </a>
      </div>
      <a href={data.managePath} target={embed ? "_blank" : undefined} rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
        Manage or reschedule this booking <ExternalLink className="size-3.5" />
      </a>
      {data.redirectUrl && (
        <>
          <RedirectAfter url={data.redirectUrl} embed={embed} ms={2500} />
          <p className="text-xs text-muted-foreground">
            Redirecting you…{" "}
            <a href={data.redirectUrl} target="_top" className="underline">
              continue now
            </a>
          </p>
        </>
      )}
    </div>
  );
}

type Step = "details" | "questions" | "calendar" | "done" | "blocked";

export function BookingFlow({
  slug,
  embed,
  page,
  hosts,
  hostTimezone,
  initialNowMs,
  maxDaysAhead,
  weekStartsOn,
  prefill,
  utm,
}: {
  slug: string;
  embed: boolean;
  page: PublicPageInfo & { questions: FormQuestion[] };
  hosts: PublicHost[];
  hostTimezone: string;
  initialNowMs: number;
  maxDaysAhead: number;
  weekStartsOn: 0 | 1;
  prefill: { name: string; email: string; phone: string };
  utm: Record<string, string>;
}) {
  const hasQuestions = page.questions.length > 0;
  const totalSteps = hasQuestions ? 3 : 2;
  const [step, setStep] = useState<Step>("details");
  const [captureId, setCaptureId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState(prefill);
  const [honeypot, setHoneypot] = useState("");
  const [answers, setAnswers] = useState<Answers>({});
  const [blocked, setBlocked] = useState<{ message: string; redirectUrl: string | null } | null>(null);
  const [confirmation, setConfirmation] = useState<{ data: BookingConfirmation; timezone: string } | null>(null);

  const stepNumber = step === "details" ? 1 : step === "questions" ? 2 : totalSteps;

  async function submitDetails(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await startBookingAction({ slug, name: form.name, email: form.email, phone: form.phone || undefined, website: honeypot, utm });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCaptureId(res.data!.captureId);
      setStep(res.data!.next);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitQuestions(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !captureId) return;
    const raw = answersFromFormData(page.questions, new FormData(e.currentTarget));
    setAnswers(raw as Answers);
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await submitQualificationAction({ slug, captureId, answers: raw });
      if (!res.ok) {
        setError(res.error);
        setFieldErrors(Object.fromEntries(Object.entries(res.fieldErrors ?? {}).map(([k, v]) => [k, v?.[0] ?? ""])));
        return;
      }
      const data = res.data!;
      if (data.qualified) setStep("calendar");
      else {
        setBlocked({ message: data.message, redirectUrl: data.redirectUrl });
        setStep("blocked");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const fetchSlots = useCallback(
    async (from: string, to: string) => {
      const res = await getSlotsAction({ slug, from, to });
      return res.ok ? { ok: true as const, slots: res.data?.slots ?? [] } : { ok: false as const, error: res.error };
    },
    [slug],
  );

  const confirm = useCallback(
    async (start: string, timezone: string): Promise<ConfirmResult> => {
      if (!captureId) return { error: "This booking session has expired. Please refresh the page." };
      const res = await confirmBookingAction({ slug, captureId, start, timezone });
      if (!res.ok) return { error: res.error, refresh: res.fieldErrors?.code?.[0] === "slot_unavailable" };
      setConfirmation({ data: res.data!, timezone });
      setStep("done");
      return null;
    },
    [slug, captureId],
  );

  return (
    <div
      style={{ "--brand": page.color } as React.CSSProperties}
      className="grid overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-sm md:grid-cols-[17rem_minmax(0,1fr)]"
    >
      <BookingSummary page={page} hosts={hosts} />
      <section className="flex min-w-0 flex-col gap-5 p-6 sm:p-8">
        {step !== "done" && step !== "blocked" && (
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">
              {step === "details" ? "Your details" : step === "questions" ? "A few quick questions" : "Select a date & time"}
            </h2>
            <span className="text-xs text-muted-foreground">
              Step {stepNumber} of {totalSteps}
            </span>
          </div>
        )}

        {step === "details" && (
          <form onSubmit={submitDetails} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="bk-name">Name</Label>
              <Input id="bk-name" name="name" autoComplete="name" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bk-email">Email</Label>
              <Input id="bk-email" name="email" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bk-phone">
                Phone <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input id="bk-phone" name="phone" type="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            {/* honeypot: hidden from people, tempting for bots */}
            <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>
                Website
                <input type="text" name="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
              </label>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button type="submit" disabled={busy} className={cn(brandBtn, "mt-1 w-full sm:w-fit")}>
              {busy && <Loader2 className="size-4 animate-spin" />} Continue
            </button>
          </form>
        )}

        {step === "questions" && (
          <form onSubmit={submitQuestions} className="grid gap-5">
            <QuestionFields questions={page.questions} defaults={answers} errors={fieldErrors} />
            {error && !Object.keys(fieldErrors).length && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center gap-3">
              <button type="button" className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground" onClick={() => setStep("details")}>
                Back
              </button>
              <button type="submit" disabled={busy} className={brandBtn}>
                {busy && <Loader2 className="size-4 animate-spin" />} Continue
              </button>
            </div>
          </form>
        )}

        {step === "calendar" && (
          <>
            <SlotPicker
              fetchSlots={fetchSlots}
              onConfirm={confirm}
              hostTimezone={hostTimezone}
              initialNowMs={initialNowMs}
              maxDaysAhead={maxDaysAhead}
              weekStartsOn={weekStartsOn}
              confirmLabel="Confirm"
            />
            <button
              type="button"
              className="w-fit text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              onClick={() => setStep(hasQuestions ? "questions" : "details")}
            >
              Back
            </button>
          </>
        )}

        {step === "done" && confirmation && <ConfirmationView data={confirmation.data} timezone={confirmation.timezone} embed={embed} />}

        {step === "blocked" && blocked && (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
              <Clock className="size-6" />
            </span>
            <p className="max-w-md text-balance whitespace-pre-line">{blocked.message}</p>
            {blocked.redirectUrl && (
              <>
                <RedirectAfter url={blocked.redirectUrl} embed={embed} ms={2000} />
                <p className="text-xs text-muted-foreground">
                  Redirecting you…{" "}
                  <a href={blocked.redirectUrl} target="_top" className="underline">
                    continue now
                  </a>
                </p>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
