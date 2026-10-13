"use client";

import { BellRing, MailCheck, MailX, Plus, Send, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import type { EventNotifications } from "@/lib/types";
import { DurationInput } from "./fields";

export type TemplateOption = { id: string; name: string };

function TemplateSelect({ value, onChange, templates, label }: { value: string | null | undefined; onChange: (v: string | null) => void; templates: TemplateOption[]; label: string }) {
  return (
    <NativeSelect aria-label={label} className="w-full sm:w-56" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <NativeSelectOption value="">Default template</NativeSelectOption>
      {templates.map((t) => (
        <NativeSelectOption key={t.id} value={t.id}>
          {t.name}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

function Section({ icon: Icon, title, description, children, action }: { icon: React.ComponentType<{ className?: string }>; title: string; description?: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="size-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold">{title}</h3>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Compact editor for the automatic emails of a booking page (copied onto each meeting it creates). */
export function NotificationsEditor({ value, onChange, templates }: { value: EventNotifications; onChange: (next: EventNotifications) => void; templates: TemplateOption[] }) {
  const patch = (p: Partial<EventNotifications>) => onChange({ ...value, ...p });
  return (
    <div className="grid gap-4">
      <Section
        icon={MailCheck}
        title="Booking confirmation"
        description="Sent right after someone books, with the time, join link and add-to-calendar links."
        action={<Switch checked={value.confirmation.enabled} onCheckedChange={(v) => patch({ confirmation: { ...value.confirmation, enabled: v } })} aria-label="Send confirmation" />}
      >
        {value.confirmation.enabled && (
          <TemplateSelect label="Confirmation template" templates={templates} value={value.confirmation.templateId} onChange={(id) => patch({ confirmation: { ...value.confirmation, templateId: id } })} />
        )}
      </Section>

      <Section
        icon={MailX}
        title="Cancellation email"
        description="Sent to the invitee when a meeting is cancelled."
        action={<Switch checked={value.cancellation.enabled} onCheckedChange={(v) => patch({ cancellation: { ...value.cancellation, enabled: v } })} aria-label="Send cancellation email" />}
      >
        {value.cancellation.enabled && (
          <TemplateSelect label="Cancellation template" templates={templates} value={value.cancellation.templateId} onChange={(id) => patch({ cancellation: { ...value.cancellation, templateId: id } })} />
        )}
      </Section>

      <Section
        icon={BellRing}
        title="Reminders"
        description="Reminders reduce no-shows. Reminders that would already be in the past are skipped."
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => patch({ reminders: [...value.reminders, { id: `r_${nanoid(6)}`, minutesBefore: 24 * 60, templateId: null }] })}>
            <Plus /> Add reminder
          </Button>
        }
      >
        {value.reminders.length === 0 && <p className="text-sm text-muted-foreground">No reminders.</p>}
        {value.reminders.map((r, i) => (
          <div key={r.id} className="flex flex-col gap-2 rounded-lg border bg-background p-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <DurationInput aria-label="Reminder time" min={1} value={r.minutesBefore} onChange={(m) => patch({ reminders: value.reminders.map((x, idx) => (idx === i ? { ...x, minutesBefore: Math.max(1, m) } : x)) })} />
              <span className="text-sm text-muted-foreground">before</span>
            </div>
            <TemplateSelect label="Reminder template" templates={templates} value={r.templateId} onChange={(id) => patch({ reminders: value.reminders.map((x, idx) => (idx === i ? { ...x, templateId: id } : x)) })} />
            <Button type="button" variant="ghost" size="icon-sm" className="sm:ml-auto" aria-label="Remove reminder" onClick={() => patch({ reminders: value.reminders.filter((_, idx) => idx !== i) })}>
              <Trash2 />
            </Button>
          </div>
        ))}
      </Section>

      <Section
        icon={Send}
        title="Follow-ups"
        description="Sent after the meeting ends. Choose who receives each one."
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => patch({ followUps: [...value.followUps, { id: `f_${nanoid(6)}`, minutesAfter: 60, audience: "attended", templateId: null }] })}>
            <Plus /> Add follow-up
          </Button>
        }
      >
        {value.followUps.length === 0 && <p className="text-sm text-muted-foreground">No follow-ups.</p>}
        {value.followUps.map((f, i) => (
          <div key={f.id} className="flex flex-col gap-2 rounded-lg border bg-background p-3 lg:flex-row lg:items-center">
            <div className="flex items-center gap-2">
              <DurationInput aria-label="Follow-up delay" min={1} value={f.minutesAfter} onChange={(m) => patch({ followUps: value.followUps.map((x, idx) => (idx === i ? { ...x, minutesAfter: Math.max(1, m) } : x)) })} />
              <span className="text-sm text-muted-foreground">after the end, to</span>
            </div>
            <NativeSelect aria-label="Audience" value={f.audience} onChange={(e) => patch({ followUps: value.followUps.map((x, idx) => (idx === i ? { ...x, audience: e.target.value as typeof f.audience } : x)) })}>
              <NativeSelectOption value="attended">attended</NativeSelectOption>
              <NativeSelectOption value="no_show">no-shows</NativeSelectOption>
              <NativeSelectOption value="all">everyone</NativeSelectOption>
            </NativeSelect>
            <TemplateSelect label="Follow-up template" templates={templates} value={f.templateId} onChange={(id) => patch({ followUps: value.followUps.map((x, idx) => (idx === i ? { ...x, templateId: id } : x)) })} />
            <Button type="button" variant="ghost" size="icon-sm" className="lg:ml-auto" aria-label="Remove follow-up" onClick={() => patch({ followUps: value.followUps.filter((_, idx) => idx !== i) })}>
              <Trash2 />
            </Button>
          </div>
        ))}
      </Section>

      <section className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <div>
          <Label htmlFor="notify-host" className="text-sm font-semibold">
            Notify the host
          </Label>
          <p className="text-sm text-muted-foreground">Email the host whenever someone books a meeting.</p>
        </div>
        <Switch id="notify-host" checked={value.notifyHost} onCheckedChange={(v) => patch({ notifyHost: v })} />
      </section>
    </div>
  );
}
