"use client";

import { Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  OUTCOME_LABELS,
  TRIGGER_GROUPS,
  TRIGGER_META,
  TRIGGER_TYPES,
  describeTrigger,
  toNameLookups,
  type BuilderLookups,
  pruneTriggerConfig,
} from "@/lib/automations/meta";
import { formatDate } from "@/lib/format";
import type { AutomationTrigger, MeetingOutcome, TriggerConfig, TriggerType } from "@/lib/types";
import { Field, ValueSelect } from "./fields";
import { TRIGGER_ICONS } from "./icons";

export function TriggerCard({
  trigger,
  onChange,
  lookups,
}: {
  trigger: AutomationTrigger;
  onChange: (next: AutomationTrigger) => void;
  lookups: BuilderLookups;
}) {
  const meta = TRIGGER_META[trigger.type];
  const Icon = TRIGGER_ICONS[trigger.type];
  const config = trigger.config ?? {};
  const set = (patch: Partial<TriggerConfig>) => onChange({ ...trigger, config: pruneTriggerConfig(trigger.type, { ...config, ...patch }) });

  return (
    <Card className="gap-4 p-4 ring-1 ring-primary/20">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-primary uppercase">
            <Zap className="size-3" /> Trigger
          </p>
          <p className="mt-0.5 text-sm font-medium">{describeTrigger(trigger, toNameLookups(lookups))}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Start when" htmlFor="trigger-type" className="sm:col-span-2" hint={meta.description}>
          <Select
            value={trigger.type}
            onValueChange={(v) => onChange({ type: v as TriggerType, config: pruneTriggerConfig(v as TriggerType, config) })}
          >
            <SelectTrigger id="trigger-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRIGGER_GROUPS.map((group) => (
                <SelectGroup key={group}>
                  <SelectLabel>{group}</SelectLabel>
                  {TRIGGER_TYPES.filter((t) => TRIGGER_META[t].group === group).map((t) => (
                    <SelectItem key={t} value={t}>
                      {TRIGGER_META[t].label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {meta.fields.includes("tagId") && (
          <Field label="Tag" htmlFor="trigger-tag">
            <ValueSelect
              id="trigger-tag"
              value={config.tagId}
              onChange={(tagId) => set({ tagId })}
              options={lookups.tags.map((t) => ({ value: t.id, label: t.name }))}
              anyLabel="Any tag"
            />
          </Field>
        )}
        {meta.fields.includes("stage") && (
          <Field label="Stage" htmlFor="trigger-stage">
            <ValueSelect
              id="trigger-stage"
              value={config.stage}
              onChange={(stage) => set({ stage })}
              options={lookups.stages.map((s) => ({ value: s.key, label: s.label }))}
              anyLabel="Any stage"
            />
          </Field>
        )}
        {meta.fields.includes("eventId") && (
          <Field label="Event" htmlFor="trigger-event">
            <ValueSelect
              id="trigger-event"
              value={config.eventId}
              onChange={(eventId) => set({ eventId })}
              options={lookups.events
                .filter((e) => e.kind === "event" || e.id === config.eventId)
                .map((e) => ({ value: e.id, label: `${e.title} · ${formatDate(e.startsAt, lookups.timezone, "d MMM yyyy")}` }))}
              anyLabel="Any event"
            />
          </Field>
        )}
        {meta.fields.includes("bookingPageId") && (
          <Field label="Booking page" htmlFor="trigger-page">
            <ValueSelect
              id="trigger-page"
              value={config.bookingPageId}
              onChange={(bookingPageId) => set({ bookingPageId })}
              options={lookups.bookingPages.map((p) => ({ value: p.id, label: p.title }))}
              anyLabel="Any booking page"
            />
          </Field>
        )}
        {meta.fields.includes("outcome") && (
          <Field label="Outcome" htmlFor="trigger-outcome">
            <ValueSelect
              id="trigger-outcome"
              value={config.outcome}
              onChange={(outcome) => set({ outcome: outcome as MeetingOutcome | null })}
              options={(Object.keys(OUTCOME_LABELS) as MeetingOutcome[]).map((o) => ({ value: o, label: OUTCOME_LABELS[o] }))}
              anyLabel="Any outcome"
            />
          </Field>
        )}
        {meta.fields.includes("campaignId") && (
          <Field label="Campaign" htmlFor="trigger-campaign" hint={trigger.type.startsWith("event") ? "Only events in this campaign." : undefined}>
            <ValueSelect
              id="trigger-campaign"
              value={config.campaignId}
              onChange={(campaignId) => set({ campaignId })}
              options={lookups.campaigns.map((c) => ({ value: c.id, label: c.name }))}
              anyLabel="Any campaign"
            />
          </Field>
        )}
      </div>

      {trigger.type === "manual" && (
        <p className="text-xs text-muted-foreground">
          Nothing starts this automatically – use <strong className="font-medium text-foreground">Enroll contacts</strong> at the top of the page.
        </p>
      )}
    </Card>
  );
}
