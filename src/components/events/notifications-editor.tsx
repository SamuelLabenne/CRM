"use client";

import { useState } from "react";
import { nanoid } from "nanoid";
import { BellRing, CheckCheck, MailCheck, MailX, Plus, Trash2, UserRoundCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { splitDuration, UNIT_MINUTES, type DurationUnit } from "@/lib/events/utils";
import type { EventNotifications } from "@/lib/types";

export type TemplateOption = { id: string; name: string };

type Followup = EventNotifications["followUps"][number];
type Reminder = EventNotifications["reminders"][number];

/**
 * Controlled editor for an event's (or booking page's) automatic emails:
 * confirmation, reminders ("N minutes/hours/days before"), follow-ups, cancellation and host alerts.
 */
export function NotificationsEditor({
  value,
  onChange,
  templates,
  meeting = false,
}: {
  value: EventNotifications;
  onChange: (next: EventNotifications) => void;
  templates: TemplateOption[];
  /** Wording tweaks for 1:1 meetings / booking pages. */
  meeting?: boolean;
}) {
  const noun = meeting ? "booking" : "registration";
  const set = (patch: Partial<EventNotifications>) => onChange({ ...value, ...patch });

  const updateReminder = (id: string, patch: Partial<Reminder>) => set({ reminders: value.reminders.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const updateFollowUp = (id: string, patch: Partial<Followup>) => set({ followUps: value.followUps.map((f) => (f.id === id ? { ...f, ...patch } : f)) });

  return (
    <div className="grid gap-4">
      <Block
        icon={MailCheck}
        title="Confirmation email"
        description={`Sent right after someone completes a ${noun}.`}
        control={<Switch checked={value.confirmation.enabled} onCheckedChange={(v) => set({ confirmation: { ...value.confirmation, enabled: v } })} aria-label="Send confirmation email" />}
      >
        {value.confirmation.enabled && (
          <TemplateSelect
            value={value.confirmation.templateId}
            templates={templates}
            onChange={(templateId) => set({ confirmation: { ...value.confirmation, templateId } })}
          />
        )}
      </Block>

      <Block
        icon={BellRing}
        title="Reminders"
        description="Sent before the start to everyone who is registered. Reminders that would already be in the past are skipped."
        control={
          <Button type="button" size="sm" variant="outline" onClick={() => set({ reminders: [...value.reminders, { id: `r_${nanoid(6)}`, minutesBefore: 60, templateId: null }] })}>
            <Plus /> Add reminder
          </Button>
        }
      >
        {value.reminders.length === 0 && <p className="text-sm text-muted-foreground">No reminders. Reminders reduce no-shows, so we recommend at least one.</p>}
        {value.reminders.map((r) => (
          <Row key={r.id} onRemove={() => set({ reminders: value.reminders.filter((x) => x.id !== r.id) })} label="reminder">
            <DurationInput minutes={r.minutesBefore} min={1} onChange={(m) => updateReminder(r.id, { minutesBefore: m })} />
            <span className="text-sm text-muted-foreground">before the start</span>
            <TemplateSelect value={r.templateId} templates={templates} onChange={(templateId) => updateReminder(r.id, { templateId })} className="sm:ml-auto" />
          </Row>
        ))}
      </Block>

      <Block
        icon={CheckCheck}
        title="Follow-ups"
        description="Sent after the end, depending on whether the person attended. Mark attendance before they go out."
        control={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => set({ followUps: [...value.followUps, { id: `f_${nanoid(6)}`, minutesAfter: 120, audience: "attended", templateId: null }] })}
          >
            <Plus /> Add follow-up
          </Button>
        }
      >
        {value.followUps.length === 0 && <p className="text-sm text-muted-foreground">No follow-ups.</p>}
        {value.followUps.map((f) => (
          <Row key={f.id} onRemove={() => set({ followUps: value.followUps.filter((x) => x.id !== f.id) })} label="follow-up">
            <NativeSelect
              aria-label="Who receives the follow-up"
              value={f.audience}
              onChange={(e) => updateFollowUp(f.id, { audience: e.target.value as Followup["audience"] })}
            >
              <NativeSelectOption value="attended">Attended</NativeSelectOption>
              <NativeSelectOption value="no_show">No-shows</NativeSelectOption>
              <NativeSelectOption value="all">Everyone</NativeSelectOption>
            </NativeSelect>
            <DurationInput minutes={f.minutesAfter} min={0} onChange={(m) => updateFollowUp(f.id, { minutesAfter: m })} />
            <span className="text-sm text-muted-foreground">after the end</span>
            <TemplateSelect value={f.templateId} templates={templates} onChange={(templateId) => updateFollowUp(f.id, { templateId })} className="sm:ml-auto" />
          </Row>
        ))}
      </Block>

      <Block
        icon={MailX}
        title="Cancellation email"
        description={`Sent when a ${noun} is cancelled.`}
        control={<Switch checked={value.cancellation.enabled} onCheckedChange={(v) => set({ cancellation: { ...value.cancellation, enabled: v } })} aria-label="Send cancellation email" />}
      >
        {value.cancellation.enabled && (
          <TemplateSelect
            value={value.cancellation.templateId}
            templates={templates}
            onChange={(templateId) => set({ cancellation: { ...value.cancellation, templateId } })}
          />
        )}
      </Block>

      <Block
        icon={UserRoundCheck}
        title="Notify the host"
        description={`Email the host whenever someone ${meeting ? "books" : "registers"}.`}
        control={<Switch checked={value.notifyHost} onCheckedChange={(v) => set({ notifyHost: v })} aria-label="Notify host" />}
      />
    </div>
  );
}

function Block({
  icon: Icon,
  title,
  description,
  control,
  children,
}: {
  icon: typeof BellRing;
  title: string;
  description: string;
  control?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="grid gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {control}
      </div>
      {children && <div className="grid gap-2 sm:pl-11">{children}</div>}
    </div>
  );
}

function Row({ children, onRemove, label }: { children: React.ReactNode; onRemove: () => void; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2">
      {children}
      <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove ${label}`}>
        <Trash2 />
      </Button>
    </div>
  );
}

function TemplateSelect({
  value,
  templates,
  onChange,
  className,
}: {
  value: string | null | undefined;
  templates: TemplateOption[];
  onChange: (id: string | null) => void;
  className?: string;
}) {
  return (
    <NativeSelect aria-label="Email template" className={className} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <NativeSelectOption value="">Default template</NativeSelectOption>
      {templates.map((t) => (
        <NativeSelectOption key={t.id} value={t.id}>
          {t.name}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/** "[2] [hours ▾]" input that stores minutes. Keeps its own draft so typing never flips the unit. */
function DurationInput({ minutes, onChange, min }: { minutes: number; onChange: (minutes: number) => void; min: number }) {
  const initial = splitDuration(minutes);
  const [amount, setAmount] = useState(String(initial.amount));
  const [unit, setUnit] = useState<DurationUnit>(initial.unit);

  const commit = (a: string, u: DurationUnit) => {
    const n = Number(a);
    if (a.trim() === "" || !Number.isFinite(n)) return;
    const total = Math.round(n * UNIT_MINUTES[u]);
    if (total >= min) onChange(total);
  };

  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="number"
        inputMode="numeric"
        min={min === 0 ? 0 : 1}
        step={1}
        className="w-20"
        aria-label="Amount"
        value={amount}
        onChange={(e) => {
          setAmount(e.target.value);
          commit(e.target.value, unit);
        }}
      />
      <NativeSelect
        aria-label="Unit"
        value={unit}
        onChange={(e) => {
          const u = e.target.value as DurationUnit;
          setUnit(u);
          commit(amount, u);
        }}
      >
        <NativeSelectOption value="minutes">minutes</NativeSelectOption>
        <NativeSelectOption value="hours">hours</NativeSelectOption>
        <NativeSelectOption value="days">days</NativeSelectOption>
      </NativeSelect>
    </div>
  );
}
