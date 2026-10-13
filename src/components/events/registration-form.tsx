"use client";

import { useRef, useState, useTransition } from "react";
import { ArrowLeft, CalendarPlus, CheckCircle2, Download, Hourglass, Loader2, Settings2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { QuestionFields, answersFromFormData } from "@/components/forms/question-fields";
import { captureStepAction, registerAction } from "@/app/(public)/e/[slug]/actions";
import { brandBtn, outlineBtn } from "./brand";
import type { Answers, AttendeeStatus, FormQuestion, Utm } from "@/lib/types";

type Links = { manage: string; ics: string; google: string } | null;

type View =
  | { name: "step1" }
  | { name: "step2"; captureId: string }
  | { name: "done"; status: "registered" | "waitlisted"; links: Links }
  | { name: "already"; status: AttendeeStatus; resent: boolean };

/** 2-step public registration form (details → custom questions → confirmation). */
export function RegistrationForm({
  slug,
  questions,
  waitlist,
  prefill,
  utm,
  embed,
}: {
  slug: string;
  questions: FormQuestion[];
  waitlist: boolean;
  prefill: { firstName: string; lastName: string; email: string; phone: string };
  utm: Utm;
  embed?: boolean;
}) {
  const [view, setView] = useState<View>({ name: "step1" });
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [person, setPerson] = useState(prefill);
  const [website, setWebsite] = useState(""); // honeypot
  const [rawAnswers, setRawAnswers] = useState<Record<string, unknown>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const hasQuestions = questions.length > 0;
  const totalSteps = hasQuestions ? 2 : 1;

  function register(captureId: string, answers: Record<string, unknown>) {
    return registerAction({ slug, captureId, answers, website, utm }).then((res) => {
      if (res.ok && res.kind === "registered") {
        setView({ name: "done", status: res.status, links: res.links });
      } else if (res.ok) {
        setView({ name: "already", status: res.status, resent: res.resent });
      } else {
        setFieldErrors(res.fieldErrors ?? {});
        setError(res.error);
        if (res.code === "capture") setView({ name: "step1" });
        else if (hasQuestions) setView({ name: "step2", captureId });
      }
    });
  }

  function submitStep1(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    start(async () => {
      const res = await captureStepAction({ slug, ...person, website, utm });
      if (!res.ok) {
        setFieldErrors(res.fieldErrors ?? {});
        setError(res.error);
        return;
      }
      if (res.kind === "already") {
        setView({ name: "already", status: res.status, resent: res.resent });
        return;
      }
      if (!hasQuestions) {
        await register(res.captureId, {});
        return;
      }
      setView({ name: "step2", captureId: res.captureId });
    });
  }

  function submitStep2(e: React.FormEvent<HTMLFormElement>, captureId: string) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const answers = answersFromFormData(questions, new FormData(e.currentTarget));
    setRawAnswers(answers);
    start(() => register(captureId, answers));
  }

  function goBack() {
    if (formRef.current) setRawAnswers(answersFromFormData(questions, new FormData(formRef.current)));
    setError(null);
    setFieldErrors({});
    setView({ name: "step1" });
  }

  if (view.name === "done") {
    const wl = view.status === "waitlisted";
    return (
      <div className="grid gap-5 text-center" role="status" aria-live="polite">
        <div
          className="mx-auto grid size-14 place-items-center rounded-full text-white"
          style={{ background: wl ? "var(--chart-3)" : "var(--brand)" }}
        >
          {wl ? <Hourglass className="size-7" /> : <CheckCircle2 className="size-7" />}
        </div>
        <div className="grid gap-1.5">
          <h2 className="text-xl font-semibold tracking-tight">{wl ? "You're on the waitlist" : "You're registered!"}</h2>
          <p className="text-sm text-muted-foreground">
            {wl
              ? "The event is full right now. We'll email you as soon as a spot opens up."
              : "We've emailed you a confirmation with everything you need."}
            {person.email && (
              <>
                {" "}
                Sent to <span className="font-medium text-foreground">{person.email}</span>.
              </>
            )}
          </p>
        </div>
        {view.links && !wl && (
          <div className="grid gap-2 sm:grid-cols-2">
            <a href={view.links.google} target="_blank" rel="noreferrer" className={outlineBtn}>
              <CalendarPlus className="size-4" /> Google Calendar
            </a>
            <a href={view.links.ics} className={outlineBtn}>
              <Download className="size-4" /> Apple / Outlook (.ics)
            </a>
          </div>
        )}
        {view.links && (
          <a
            href={view.links.manage}
            target={embed ? "_blank" : undefined}
            rel={embed ? "noreferrer" : undefined}
            className="mx-auto inline-flex items-center gap-1.5 text-sm font-medium text-[var(--brand)] hover:underline"
          >
            <Settings2 className="size-4" /> Manage your registration
          </a>
        )}
      </div>
    );
  }

  if (view.name === "already") {
    const wl = view.status === "waitlisted";
    return (
      <div className="grid gap-4 text-center" role="status" aria-live="polite">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-muted text-foreground">
          <CheckCircle2 className="size-7" />
        </div>
        <div className="grid gap-1.5">
          <h2 className="text-xl font-semibold tracking-tight">{wl ? "You're already on the waitlist" : "You're already registered"}</h2>
          <p className="text-sm text-muted-foreground">
            {view.resent ? (
              <>
                We just re-sent the email to <span className="font-medium text-foreground">{person.email}</span>. It includes a link to
                manage your registration or add the event to your calendar.
              </>
            ) : (
              <>Check your inbox for your confirmation email: it has a link to manage your registration.</>
            )}
          </p>
        </div>
        <button type="button" className="mx-auto text-sm font-medium text-[var(--brand)] hover:underline" onClick={() => setView({ name: "step1" })}>
          Use a different email
        </button>
      </div>
    );
  }

  const honeypot = (
    <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
      <label>
        Website
        <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </label>
    </div>
  );

  const stepper = (n: number) =>
    totalSteps > 1 && (
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span>
          Step {n} of {totalSteps}
        </span>
        <div className="flex flex-1 gap-1">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <span key={i} className="h-1 flex-1 rounded-full bg-muted" style={i < n ? { background: "var(--brand)" } : undefined} />
          ))}
        </div>
      </div>
    );

  const errorAlert = error && (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );

  if (view.name === "step2") {
    const { captureId } = view;
    return (
      <form ref={formRef} onSubmit={(e) => submitStep2(e, captureId)} className="relative grid gap-5" noValidate={false}>
        {stepper(2)}
        {errorAlert}
        <QuestionFields questions={questions} defaults={rawAnswers as Answers} errors={fieldErrors} />
        {honeypot}
        <div className="grid gap-2">
          <button type="submit" disabled={pending} className={brandBtn}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {waitlist ? "Join the waitlist" : "Complete registration"}
          </button>
          <button type="button" onClick={goBack} disabled={pending} className="inline-flex items-center justify-center gap-1.5 py-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Back
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submitStep1} className="relative grid gap-4">
      {stepper(1)}
      {errorAlert}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="firstName" label="First name" error={fieldErrors.firstName}>
          <Input
            id="firstName"
            name="firstName"
            autoComplete="given-name"
            required
            className="h-10"
            value={person.firstName}
            onChange={(e) => setPerson({ ...person, firstName: e.target.value })}
            aria-invalid={!!fieldErrors.firstName}
          />
        </Field>
        <Field id="lastName" label="Last name" error={fieldErrors.lastName}>
          <Input
            id="lastName"
            name="lastName"
            autoComplete="family-name"
            className="h-10"
            value={person.lastName}
            onChange={(e) => setPerson({ ...person, lastName: e.target.value })}
          />
        </Field>
      </div>
      <Field id="email" label="Email" error={fieldErrors.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          className="h-10"
          value={person.email}
          onChange={(e) => setPerson({ ...person, email: e.target.value })}
          aria-invalid={!!fieldErrors.email}
        />
      </Field>
      <Field id="phone" label="Phone" optional error={fieldErrors.phone}>
        <Input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          className="h-10"
          value={person.phone}
          onChange={(e) => setPerson({ ...person, phone: e.target.value })}
        />
      </Field>
      {honeypot}
      <button type="submit" disabled={pending} className={brandBtn}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        {hasQuestions ? "Continue" : waitlist ? "Join the waitlist" : "Register"}
      </button>
      <p className="text-center text-xs text-muted-foreground">We&apos;ll only use your details to run this event.</p>
    </form>
  );
}

function Field({ id, label, optional, error, children }: { id: string; label: string; optional?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>
        {label}
        {optional ? <span className="font-normal text-muted-foreground"> (optional)</span> : <span className="text-destructive">*</span>}
      </Label>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
