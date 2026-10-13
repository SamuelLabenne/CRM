"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Globe, Loader2, Lock, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { QuestionBuilder } from "@/components/forms/question-builder";
import { NotificationsEditor, type TemplateOption } from "./notifications-editor";
import { saveEventAction } from "@/app/(app)/events/actions";
import { COLOR_SWATCHES, COMMON_TIMEZONES, EVENT_TYPES, LOCATION_TYPES } from "@/lib/events/utils";
import { cn } from "@/lib/utils";
import type { EventNotifications, EventType, FormQuestion, LocationType } from "@/lib/types";

export type EventFormValues = {
  title: string;
  type: EventType;
  description: string;
  timezone: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  locationType: LocationType;
  location: string;
  meetingUrl: string;
  capacity: string;
  waitlistEnabled: boolean;
  campaignId: string;
  hostId: string;
  color: string;
  status: "draft" | "scheduled";
  isPublic: boolean;
  slug: string;
  registrationOpen: boolean;
  coverImageUrl: string;
  registrationQuestions: FormQuestion[];
  notifications: EventNotifications;
};

export type EventFormSection = "details" | "registration" | "notifications";

type Props = {
  mode: "create" | "edit";
  eventId?: string;
  /** Sections to render; in edit mode a single section is saved on its own. */
  sections: EventFormSection[];
  initial: EventFormValues;
  campaigns: { id: string; name: string }[];
  users: { id: string; name: string }[];
  templates: TemplateOption[];
  customFields: { key: string; label: string }[];
  /** e.g. "https://app.example.com/e/" – shown in front of the slug input. */
  publicBase: string;
  /** Edit mode: draft/scheduled events can switch between the two; cancelled/completed are changed from the header menu. */
  canChangeStatus?: boolean;
};

const addMinutes = (date: string, time: string, minutes: number) => {
  const d = new Date(`${date}T${time}:00Z`);
  d.setTime(d.getTime() + minutes * 60_000);
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
};
const diffMinutes = (aDate: string, aTime: string, bDate: string, bTime: string) =>
  (new Date(`${bDate}T${bTime}:00Z`).getTime() - new Date(`${aDate}T${aTime}:00Z`).getTime()) / 60_000;

export function EventForm({ mode, eventId, sections, initial, campaigns, users, templates, customFields, publicBase, canChangeStatus = true }: Props) {
  const router = useRouter();
  const [v, setV] = useState<EventFormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [pending, start] = useTransition();
  const [intent, setIntent] = useState<"draft" | "scheduled">("scheduled");
  const set = <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) => setV((prev) => ({ ...prev, [key]: value }));
  const err = (k: string) => errors[k]?.[0];

  const timezones = COMMON_TIMEZONES.includes(v.timezone) ? COMMON_TIMEZONES : [v.timezone, ...COMMON_TIMEZONES];

  function changeStart(date: string, time: string) {
    const duration = diffMinutes(v.startDate, v.startTime, v.endDate, v.endTime);
    if (date && time && Number.isFinite(duration) && duration > 0) {
      const end = addMinutes(date, time, duration);
      setV((p) => ({ ...p, startDate: date, startTime: time, endDate: end.date, endTime: end.time }));
    } else {
      setV((p) => ({ ...p, startDate: date, startTime: time }));
    }
  }

  function submit(status?: "draft" | "scheduled") {
    setErrors({});
    const section = mode === "create" ? "all" : sections.length === 1 ? sections[0] : "all";
    const payload = {
      ...v,
      status: status ?? (mode === "edit" && canChangeStatus ? v.status : undefined),
      capacity: v.capacity.trim() === "" ? null : Number(v.capacity),
      campaignId: v.campaignId || null,
      hostId: v.hostId || null,
      slug: v.slug.trim(),
    };
    start(async () => {
      const res = await saveEventAction({ id: eventId, section, values: payload });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Saved");
      if (mode === "create" && res.data) router.push(`/events/${res.data.id}`);
      else router.refresh();
    });
  }

  const has = (s: EventFormSection) => sections.includes(s);
  const sectionTitle = (title: string, description?: string) => (
    <div className="mb-4">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  );
  const card = "rounded-xl border bg-card p-5 shadow-xs";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(mode === "create" ? intent : undefined);
      }}
      className="grid gap-6"
    >
      {has("details") && (
        <section className={card}>
          {sectionTitle("Event details", "What it is, when it happens and where.")}
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
              <Field label="Title" error={err("title")} required>
                <Input value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Product launch webinar" maxLength={160} aria-invalid={!!err("title")} autoFocus={mode === "create"} />
              </Field>
              <Field label="Type">
                <NativeSelect className="w-full" value={v.type} onChange={(e) => set("type", e.target.value as EventType)}>
                  {EVENT_TYPES.map((t) => (
                    <NativeSelectOption key={t.value} value={t.value}>
                      {t.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <Field label="Description" hint="Shown on the public registration page.">
              <Textarea rows={4} value={v.description} onChange={(e) => set("description", e.target.value)} placeholder="What will attendees learn or do?" />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Starts" required error={err("startDate")}>
                <Input type="date" value={v.startDate} onChange={(e) => changeStart(e.target.value, v.startTime)} />
              </Field>
              <Field label="Start time" required error={err("startTime")}>
                <Input type="time" value={v.startTime} onChange={(e) => changeStart(v.startDate, e.target.value)} />
              </Field>
              <Field label="Ends" required error={err("endDate")}>
                <Input type="date" value={v.endDate} onChange={(e) => set("endDate", e.target.value)} />
              </Field>
              <Field label="End time" required error={err("endTime")}>
                <Input type="time" value={v.endTime} onChange={(e) => set("endTime", e.target.value)} aria-invalid={!!err("endTime")} />
              </Field>
            </div>
            <Field label="Timezone" hint="Times above are in this timezone. Visitors see the time in their own timezone.">
              <NativeSelect className="w-full sm:w-80" value={v.timezone} onChange={(e) => set("timezone", e.target.value)}>
                {timezones.map((tz) => (
                  <NativeSelectOption key={tz} value={tz}>
                    {tz.replace(/_/g, " ")}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>

            <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
              <Field label="Location type">
                <NativeSelect className="w-full" value={v.locationType} onChange={(e) => set("locationType", e.target.value as LocationType)}>
                  {LOCATION_TYPES.map((t) => (
                    <NativeSelectOption key={t.value} value={t.value}>
                      {t.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                label={v.locationType === "in_person" ? "Address / venue" : v.locationType === "phone" ? "Phone number" : "Platform"}
                hint={v.locationType === "online" ? "e.g. Zoom, Google Meet" : undefined}
              >
                <Input value={v.location} onChange={(e) => set("location", e.target.value)} maxLength={300} />
              </Field>
            </div>
            {v.locationType === "online" && (
              <Field label="Meeting URL" hint="Revealed to registrants in their emails and on their manage page 30 minutes before the start." error={err("meetingUrl")}>
                <Input type="url" value={v.meetingUrl} onChange={(e) => set("meetingUrl", e.target.value)} placeholder="https://…" aria-invalid={!!err("meetingUrl")} />
              </Field>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Capacity" hint="Leave empty for unlimited seats." error={err("capacity")}>
                <Input type="number" min={1} inputMode="numeric" value={v.capacity} onChange={(e) => set("capacity", e.target.value)} placeholder="Unlimited" aria-invalid={!!err("capacity")} />
              </Field>
              <div className="flex items-start gap-3 pt-6 sm:pt-7">
                <Switch id="waitlist" checked={v.waitlistEnabled} onCheckedChange={(c) => set("waitlistEnabled", c)} disabled={v.capacity.trim() === ""} />
                <Label htmlFor="waitlist" className="grid gap-0.5 leading-snug font-medium">
                  Waitlist when full
                  <span className="text-xs font-normal text-muted-foreground">Extra people join a waitlist and are promoted when someone cancels.</span>
                </Label>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Campaign">
                <NativeSelect className="w-full" value={v.campaignId} onChange={(e) => set("campaignId", e.target.value)}>
                  <NativeSelectOption value="">No campaign</NativeSelectOption>
                  {campaigns.map((c) => (
                    <NativeSelectOption key={c.id} value={c.id}>
                      {c.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Host">
                <NativeSelect className="w-full" value={v.hostId} onChange={(e) => set("hostId", e.target.value)}>
                  <NativeSelectOption value="">No host</NativeSelectOption>
                  {users.map((u) => (
                    <NativeSelectOption key={u.id} value={u.id}>
                      {u.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </div>

            <div className="grid gap-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {COLOR_SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => set("color", c)}
                    aria-label={`Color ${c}`}
                    aria-pressed={v.color === c}
                    className={cn("grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-background transition", v.color === c && "ring-2 ring-foreground")}
                    style={{ background: c }}
                  >
                    {v.color === c && <Check className="size-4 text-white" />}
                  </button>
                ))}
              </div>
            </div>

            {mode === "edit" && canChangeStatus && (
              <Field label="Status" hint="Draft events are hidden from the public. Scheduled events are live.">
                <NativeSelect className="w-full sm:w-60" value={v.status} onChange={(e) => set("status", e.target.value as "draft" | "scheduled")}>
                  <NativeSelectOption value="draft">Draft</NativeSelectOption>
                  <NativeSelectOption value="scheduled">Scheduled (live)</NativeSelectOption>
                </NativeSelect>
              </Field>
            )}
          </div>
        </section>
      )}

      {has("registration") && (
        <section className={card}>
          {sectionTitle("Registration page", "A public page where people sign up. Name and email are always asked; add your own questions below.")}
          <div className="grid gap-5">
            <div className="flex items-start gap-3">
              <Switch id="public" checked={v.isPublic} onCheckedChange={(c) => set("isPublic", c)} />
              <Label htmlFor="public" className="grid gap-0.5 leading-snug font-medium">
                <span className="inline-flex items-center gap-1.5">
                  {v.isPublic ? <Globe className="size-4 text-emerald-600" /> : <Lock className="size-4 text-muted-foreground" />}
                  Public registration page
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {v.isPublic ? "Anyone with the link can register (once the event is scheduled)." : "Off: only your team can add attendees."}
                </span>
              </Label>
            </div>
            {v.isPublic && (
              <>
                <Field label="Page link" error={err("slug")} hint="Letters, numbers and dashes. Leave empty to generate it from the title.">
                  <div className="flex min-w-0 items-center rounded-lg border bg-background focus-within:ring-3 focus-within:ring-ring/50">
                    <span className="max-w-[55%] truncate border-r bg-muted/50 px-2.5 py-1.5 text-sm text-muted-foreground">{publicBase}</span>
                    <input
                      className="h-8 min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none"
                      value={v.slug}
                      onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))}
                      placeholder="my-event"
                      maxLength={80}
                      aria-invalid={!!err("slug")}
                    />
                  </div>
                </Field>
                <div className="flex items-start gap-3">
                  <Switch id="open" checked={v.registrationOpen} onCheckedChange={(c) => set("registrationOpen", c)} />
                  <Label htmlFor="open" className="grid gap-0.5 leading-snug font-medium">
                    Accepting registrations
                    <span className="text-xs font-normal text-muted-foreground">Turn off to close sign-ups without unpublishing the page.</span>
                  </Label>
                </div>
                <Field label="Cover image URL" hint="Optional. Shown at the top of the page; otherwise the event color is used." error={err("coverImageUrl")}>
                  <Input type="url" value={v.coverImageUrl} onChange={(e) => set("coverImageUrl", e.target.value)} placeholder="https://…" />
                </Field>
              </>
            )}
            <div className="grid gap-2">
              <div>
                <Label>Registration questions</Label>
                <p className="text-xs text-muted-foreground">Answers can be saved on the contact (for example company or phone).</p>
              </div>
              <QuestionBuilder value={v.registrationQuestions} onChange={(q) => set("registrationQuestions", q)} customFields={customFields} />
              {err("registrationQuestions") && <p className="text-sm text-destructive">{err("registrationQuestions")}</p>}
            </div>
          </div>
        </section>
      )}

      {has("notifications") && (
        <section>
          {sectionTitle("Emails", "Automatic emails for this event. Leave a template on “Default” to use the built-in one, or pick your own from Emails → Templates.")}
          <NotificationsEditor value={v.notifications} onChange={(n) => set("notifications", n)} templates={templates} />
        </section>
      )}

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t bg-background/90 px-1 py-3 backdrop-blur">
        {mode === "create" ? (
          <>
            <Button asChild variant="ghost" type="button">
              <Link href="/events">Cancel</Link>
            </Button>
            <Button type="submit" variant="outline" disabled={pending} onClick={() => setIntent("draft")}>
              {pending && intent === "draft" ? <Loader2 className="animate-spin" /> : <Save />} Save as draft
            </Button>
            <Button type="submit" disabled={pending} onClick={() => setIntent("scheduled")}>
              {pending && intent === "scheduled" ? <Loader2 className="animate-spin" /> : <Check />} Create &amp; publish
            </Button>
          </>
        ) : (
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Save />} Save changes
          </Button>
        )}
      </div>
    </form>
  );
}

function Field({ label, hint, error, required, children }: { label: string; hint?: string; error?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <Label>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
      {error ? <p className="text-sm text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
