"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, Info, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  ATTENDANCE_OPTIONS,
  TRIGGER_META,
  WAIT_UNITS,
  describeStep,
  minutesFrom,
  splitMinutes,
  type WaitUnit,
  type BuilderLookups,
} from "@/lib/automations/meta";
import type { AttendeeStatus, AutomationStep, AutomationTrigger } from "@/lib/types";
import { Field, NumberField, ValueSelect } from "./fields";
import { FilterRows } from "./filter-rows";

type StepOf<T extends AutomationStep["type"]> = Extract<AutomationStep, { type: T }>;

const MERGE_HINT = "Merge tags work here, e.g. {{contact.first_name}} or {{event.title}}.";

function UnitSelect({ value, onChange, id }: { value: WaitUnit; onChange: (u: WaitUnit) => void; id?: string }) {
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value as WaitUnit)} className="w-full">
      {WAIT_UNITS.map((u) => (
        <NativeSelectOption key={u} value={u}>
          {u}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

function NeedsEventNotice({ trigger }: { trigger: AutomationTrigger }) {
  const availability = TRIGGER_META[trigger.type].event;
  if (availability === "yes") {
    return (
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" /> Uses the event or meeting from the “{TRIGGER_META[trigger.type].label}” trigger.
      </p>
    );
  }
  if (availability === "maybe") {
    return (
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        {trigger.type === "manual"
          ? "Pick an event when you enroll contacts manually so this step knows which event to use."
          : "Only works when the trigger came from an event registration form, not a booking page."}
      </p>
    );
  }
  return (
    <Alert variant="destructive">
      <TriangleAlert />
      <AlertDescription>
        The “{TRIGGER_META[trigger.type].label}” trigger has no event, so this step can&apos;t work. Switch to an event or meeting trigger.
      </AlertDescription>
    </Alert>
  );
}

export function StepEditor({
  step,
  onChange,
  lookups,
  trigger,
  issues,
}: {
  step: AutomationStep;
  onChange: (next: AutomationStep) => void;
  lookups: BuilderLookups;
  trigger: AutomationTrigger;
  issues: string[];
}) {
  return (
    <div className="grid gap-5">
      {issues.length > 0 && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>{issues.join(" · ")}</AlertDescription>
        </Alert>
      )}
      {renderEditor(step, onChange, lookups, trigger)}
    </div>
  );
}

function renderEditor(
  step: AutomationStep,
  onChange: (next: AutomationStep) => void,
  lookups: BuilderLookups,
  trigger: AutomationTrigger,
) {
  switch (step.type) {
    case "send_email":
      return <SendEmailEditor step={step} onChange={onChange} lookups={lookups} />;
    case "wait":
      return <WaitEditor step={step} onChange={onChange} />;
    case "wait_until_event":
      return <WaitUntilEventEditor step={step} onChange={onChange} trigger={trigger} />;
    case "condition":
      return <ConditionEditor step={step} onChange={onChange} lookups={lookups} trigger={trigger} />;
    case "add_tag":
    case "remove_tag":
      return (
        <Field
          label="Tag"
          htmlFor="step-tag"
          hint={step.type === "add_tag" ? "The contact is tagged. Other automations triggered by this tag may start." : "Nothing happens if the contact doesn't have the tag."}
        >
          <ValueSelect
            id="step-tag"
            value={step.tagId}
            onChange={(v) => onChange({ ...step, tagId: v ?? "" })}
            options={lookups.tags.map((t) => ({ value: t.id, label: t.name }))}
            placeholder={lookups.tags.length ? "Choose a tag" : "No tags yet – create one in Settings → Tags"}
          />
        </Field>
      );
    case "set_stage":
      return (
        <Field label="Pipeline stage" htmlFor="step-stage" hint="Moves the contact to this stage and logs it on their timeline.">
          <ValueSelect
            id="step-stage"
            value={step.stage}
            onChange={(v) => onChange({ ...step, stage: v ?? "" })}
            options={lookups.stages.map((s) => ({ value: s.key, label: s.label }))}
            placeholder="Choose a stage"
          />
        </Field>
      );
    case "create_task":
      return <CreateTaskEditor step={step} onChange={onChange} lookups={lookups} />;
    case "notify_team":
      return <NotifyTeamEditor step={step} onChange={onChange} lookups={lookups} />;
    case "webhook":
      return (
        <>
          <Field label="Webhook URL" htmlFor="step-url" hint="We send a JSON POST request with the automation, run, contact and trigger context.">
            <Input
              id="step-url"
              type="url"
              inputMode="url"
              placeholder="https://example.com/hooks/relay"
              value={step.url}
              onChange={(e) => onChange({ ...step, url: e.target.value })}
            />
          </Field>
          <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">Payload</p>
            <pre className="overflow-x-auto font-mono leading-relaxed">{`{
  "event": "automation.webhook",
  "automation": { "id", "name" },
  "run": { "id", "step" },
  "contact": { "id", "email", … },
  "context": { "eventId", … }
}`}</pre>
            <p className="mt-2">Temporary failures (5xx, timeouts) are retried a few times; other errors fail the run.</p>
          </div>
        </>
      );
  }
}

function SendEmailEditor({ step, onChange, lookups }: { step: StepOf<"send_email">; onChange: (s: AutomationStep) => void; lookups: BuilderLookups }) {
  const tpl = lookups.templates.find((t) => t.id === step.templateId);
  return (
    <>
      <Field label="Email template" htmlFor="step-template" hint="Sent as a marketing email: it includes an unsubscribe link and is skipped for unsubscribed contacts.">
        <ValueSelect
          id="step-template"
          value={step.templateId}
          onChange={(v) => onChange({ ...step, templateId: v ?? "" })}
          options={lookups.templates.map((t) => ({ value: t.id, label: t.system ? `${t.name} (built-in)` : t.name }))}
          placeholder="Choose a template"
        />
      </Field>
      {tpl && (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <p className="text-xs text-muted-foreground">Subject</p>
          <p className="font-medium">{tpl.subject || "(no subject)"}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-3 text-sm">
        {tpl && (
          <Link href={`/emails/templates/${tpl.id}`} target="_blank" className="inline-flex items-center gap-1 text-primary hover:underline">
            Edit this template <ExternalLink className="size-3.5" />
          </Link>
        )}
        <Link href="/emails/templates/new" target="_blank" className="inline-flex items-center gap-1 text-primary hover:underline">
          Create a new template <ExternalLink className="size-3.5" />
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">
        After creating a template, reload this page to pick it here. Event details are merged in when the run has an event.
      </p>
    </>
  );
}

function WaitEditor({ step, onChange }: { step: StepOf<"wait">; onChange: (s: AutomationStep) => void }) {
  return (
    <Field label="Wait for" htmlFor="step-wait" hint="The contact waits here, then continues with the next step.">
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <NumberField id="step-wait" value={step.amount} min={1} max={100000} onChange={(amount) => onChange({ ...step, amount })} />
        <UnitSelect value={step.unit} onChange={(unit) => onChange({ ...step, unit })} />
      </div>
    </Field>
  );
}

function WaitUntilEventEditor({
  step,
  onChange,
  trigger,
}: {
  step: StepOf<"wait_until_event">;
  onChange: (s: AutomationStep) => void;
  trigger: AutomationTrigger;
}) {
  const initial = splitMinutes(step.offsetMinutes);
  const [direction, setDirection] = useState<"before" | "at" | "after">(
    step.offsetMinutes < 0 ? "before" : step.offsetMinutes > 0 ? "after" : "before",
  );
  const [amount, setAmount] = useState(initial.amount || 1);
  const [unit, setUnit] = useState<WaitUnit>(initial.unit);

  const push = (d: typeof direction, a: number, u: WaitUnit) => {
    const minutes = d === "at" ? 0 : minutesFrom(a, u) * (d === "before" ? -1 : 1);
    onChange({ ...step, offsetMinutes: minutes });
  };

  return (
    <>
      <div className="grid gap-3">
        {direction !== "at" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Amount" htmlFor="step-amount">
              <NumberField
                id="step-amount"
                value={amount}
                min={1}
                onChange={(a) => {
                  setAmount(a);
                  push(direction, a, unit);
                }}
              />
            </Field>
            <Field label="Unit" htmlFor="step-unit">
              <UnitSelect
                id="step-unit"
                value={unit}
                onChange={(u) => {
                  setUnit(u);
                  push(direction, amount, u);
                }}
              />
            </Field>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Timing" htmlFor="step-when">
            <NativeSelect
              id="step-when"
              className="w-full"
              value={direction}
              onChange={(e) => {
                const d = e.target.value as typeof direction;
                setDirection(d);
                push(d, amount, unit);
              }}
            >
              <NativeSelectOption value="before">Before</NativeSelectOption>
              <NativeSelectOption value="after">After</NativeSelectOption>
              <NativeSelectOption value="at">Exactly at</NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field label="Event moment" htmlFor="step-anchor">
            <NativeSelect
              id="step-anchor"
              className="w-full"
              value={step.anchor}
              onChange={(e) => onChange({ ...step, anchor: e.target.value as "start" | "end" })}
            >
              <NativeSelectOption value="start">Event start</NativeSelectOption>
              <NativeSelectOption value="end">Event end</NativeSelectOption>
            </NativeSelect>
          </Field>
        </div>
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm font-medium">{describeStep(step)}</p>
      </div>
      <p className="text-xs text-muted-foreground">
        If that moment has already passed, the contact continues straight away. If the event is cancelled (or the registration is
        cancelled) while waiting, the contact leaves the automation.
      </p>
      <NeedsEventNotice trigger={trigger} />
    </>
  );
}

function ConditionEditor({
  step,
  onChange,
  lookups,
  trigger,
}: {
  step: StepOf<"condition">;
  onChange: (s: AutomationStep) => void;
  lookups: BuilderLookups;
  trigger: AutomationTrigger;
}) {
  const attendance = step.attendance ?? [];
  const toggle = (status: AttendeeStatus, on: boolean) =>
    onChange({ ...step, attendance: on ? [...attendance, status] : attendance.filter((s) => s !== status) });
  return (
    <>
      <p className="text-sm text-muted-foreground">
        The contact continues only if <strong className="font-medium text-foreground">everything below</strong> is true. Otherwise they leave
        the automation (status “exited”).
      </p>
      <div className="grid gap-2">
        <Label>Contact details</Label>
        <FilterRows value={step.filter} onChange={(filter) => onChange({ ...step, filter })} lookups={lookups} />
      </div>
      <div className="grid gap-2">
        <Label>Event attendance (optional)</Label>
        <p className="text-xs text-muted-foreground">Checks the contact&apos;s registration for the event in this run. Leave all unchecked to skip.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {ATTENDANCE_OPTIONS.map((o) => (
            <label key={o.value} className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-2 text-sm">
              <Checkbox checked={attendance.includes(o.value)} onCheckedChange={(c) => toggle(o.value, c === true)} />
              {o.label}
            </label>
          ))}
        </div>
        {attendance.length > 0 && <NeedsEventNotice trigger={trigger} />}
      </div>
    </>
  );
}

function CreateTaskEditor({ step, onChange, lookups }: { step: StepOf<"create_task">; onChange: (s: AutomationStep) => void; lookups: BuilderLookups }) {
  return (
    <>
      <Field label="Task title" htmlFor="step-task-title" hint={MERGE_HINT}>
        <Input id="step-task-title" value={step.title} onChange={(e) => onChange({ ...step, title: e.target.value })} />
      </Field>
      <Field label="Due in (days)" htmlFor="step-task-due" hint="0 = due straight away.">
        <NumberField id="step-task-due" value={step.dueInDays} min={0} max={3650} onChange={(dueInDays) => onChange({ ...step, dueInDays })} />
      </Field>
      <Field label="Assign to" htmlFor="step-task-assignee" hint="The assignee gets a bell notification.">
        <ValueSelect
          id="step-task-assignee"
          value={step.assigneeId ?? null}
          onChange={(assigneeId) => onChange({ ...step, assigneeId })}
          options={lookups.users.map((u) => ({ value: u.id, label: u.name }))}
          anyLabel="Contact owner (unassigned if none)"
        />
      </Field>
    </>
  );
}

function NotifyTeamEditor({ step, onChange, lookups }: { step: StepOf<"notify_team">; onChange: (s: AutomationStep) => void; lookups: BuilderLookups }) {
  const selected = step.userIds ?? [];
  const specific = selected.length > 0;
  return (
    <>
      <Field label="Message" htmlFor="step-notify" hint={MERGE_HINT}>
        <Textarea id="step-notify" rows={3} value={step.message} onChange={(e) => onChange({ ...step, message: e.target.value })} />
      </Field>
      <div className="grid gap-2">
        <Label>Who gets notified</Label>
        <NativeSelect
          className="w-full"
          value={specific ? "specific" : "admins"}
          onChange={(e) => onChange({ ...step, userIds: e.target.value === "admins" ? [] : lookups.users.slice(0, 1).map((u) => u.id) })}
          aria-label="Recipients"
        >
          <NativeSelectOption value="admins">All owners and admins</NativeSelectOption>
          <NativeSelectOption value="specific">Specific people</NativeSelectOption>
        </NativeSelect>
        {specific && (
          <div className="grid gap-1.5 rounded-lg border bg-card p-2">
            {lookups.users.map((u) => (
              <label key={u.id} className="flex items-center gap-2 px-1 py-0.5 text-sm">
                <Checkbox
                  checked={selected.includes(u.id)}
                  onCheckedChange={(c) => {
                    const next = c === true ? [...selected, u.id] : selected.filter((x) => x !== u.id);
                    onChange({ ...step, userIds: next.length ? next : selected });
                  }}
                />
                {u.name}
              </label>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">Shown in the bell menu with a link to the contact.</p>
      </div>
    </>
  );
}
