"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import { CalendarPlus, Check, CircleHelp, Download, Loader2, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cancelAction, rsvpAction } from "@/app/(public)/m/[token]/actions";
import { brandBtn, outlineBtn } from "./brand";
import { cn } from "@/lib/utils";
import type { Rsvp } from "@/lib/types";

type Intent = { type: "rsvp"; value: "yes" | "maybe" } | { type: "cancel" } | null;

/** RSVP + cancel controls on the attendee self-service page. State changes only happen on a click (never on page load). */
export function ManagePanel({
  token,
  rsvp,
  canRsvp,
  canCancel,
  intent,
  calendar,
  cancelLabel = "Cancel registration",
}: {
  token: string;
  rsvp: Rsvp | null;
  canRsvp: boolean;
  canCancel: boolean;
  /** From ?rsvp=… / ?action=cancel links in emails: shows a confirmation card first. */
  intent: Intent;
  calendar: { google: string; ics: string } | null;
  cancelLabel?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<Intent>(intent);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const done = (message: string) => {
    setNotice(message);
    setMode(null);
    toast.success(message);
    router.replace(pathname); // drop ?rsvp= / ?action= so a reload never repeats the action
    router.refresh();
  };

  function sendRsvp(value: "yes" | "maybe") {
    start(async () => {
      const res = await rsvpAction(token, value);
      if (!res.ok) return void toast.error(res.error);
      done(value === "yes" ? "Thanks! Your attendance is confirmed." : "Thanks, we've noted you as a maybe.");
    });
  }

  function sendCancel() {
    start(async () => {
      const res = await cancelAction(token, reason);
      if (!res.ok) return void toast.error(res.error);
      done("Your registration has been cancelled.");
    });
  }

  const dismiss = () => {
    setMode(null);
    router.replace(pathname);
  };

  const confirmCard = (() => {
    if (!mode || (!canRsvp && mode.type === "rsvp") || !canCancel) return null;
    if (mode.type === "rsvp") {
      return (
        <div className="grid gap-3 rounded-xl border-2 p-4" style={{ borderColor: "var(--brand)" }}>
          <div>
            <h3 className="font-semibold">{mode.value === "yes" ? "Confirm you'll attend?" : "Let us know you might come?"}</h3>
            <p className="text-sm text-muted-foreground">
              {mode.value === "yes" ? "Tap below to confirm your spot." : "We'll note you as a maybe. You can change this any time."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={brandBtn} disabled={pending} onClick={() => sendRsvp(mode.value)}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {mode.value === "yes" ? "Yes, I'll be there" : "Yes, maybe"}
            </button>
            <button type="button" className={outlineBtn} disabled={pending} onClick={dismiss}>
              Not now
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="grid gap-3 rounded-xl border-2 border-destructive/40 p-4">
        <div>
          <h3 className="font-semibold">Cancel your registration?</h3>
          <p className="text-sm text-muted-foreground">Your spot will be released for someone else. You can always register again later.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cancel-reason" className="text-sm">
            Reason <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea id="cancel-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Let the organiser know why" />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={sendCancel}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-destructive px-5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-60"
          >
            {pending && <Loader2 className="size-4 animate-spin" />} Yes, cancel
          </button>
          <button type="button" className={outlineBtn} disabled={pending} onClick={dismiss}>
            Keep my spot
          </button>
        </div>
      </div>
    );
  })();

  return (
    <div className="grid gap-5">
      {notice && (
        <div role="status" className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
          <Check className="size-4" /> {notice}
        </div>
      )}
      {confirmCard}
      {canRsvp && canCancel && !confirmCard && (
        <div className="grid gap-2">
          <p className="text-sm font-medium">Will you be there?</p>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { value: "yes", label: "Yes", icon: Check },
                { value: "maybe", label: "Maybe", icon: CircleHelp },
                { value: "no", label: "Can't go", icon: X },
              ] as const
            ).map((o) => (
              <button
                key={o.value}
                type="button"
                disabled={pending}
                aria-pressed={rsvp === o.value}
                onClick={() => (o.value === "no" ? setMode({ type: "cancel" }) : sendRsvp(o.value))}
                className={cn(
                  "inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60",
                  rsvp === o.value && "border-transparent text-white hover:opacity-90",
                )}
                style={rsvp === o.value ? { background: "var(--brand)" } : undefined}
              >
                <o.icon className="size-4" /> {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {calendar && (
        <div className="grid gap-2 sm:grid-cols-2">
          <a href={calendar.google} target="_blank" rel="noreferrer" className={outlineBtn}>
            <CalendarPlus className="size-4" /> Google Calendar
          </a>
          <a href={calendar.ics} className={outlineBtn}>
            <Download className="size-4" /> Apple / Outlook (.ics)
          </a>
        </div>
      )}
      {canCancel && !confirmCard && (
        <button type="button" onClick={() => setMode({ type: "cancel" })} className="w-fit text-sm text-muted-foreground underline-offset-4 hover:text-destructive hover:underline">
          {cancelLabel}
        </button>
      )}
    </div>
  );
}
