"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Check, ChevronsUpDown, Plus, Trash2, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ColorBadge } from "@/components/app/status-badge";
import { ContactPicker } from "@/components/app/contact-picker";
import { formatNumber } from "@/lib/format";
import type { AudiencePreview } from "@/lib/email/audience-summary";
import type { Audience, AttendeeStatus, ContactFilter, FilterGroup, FilterOperator } from "@/lib/types";
import { cn } from "@/lib/utils";
import { lookupContactsAction, previewAudienceAction } from "./actions";

export type AudienceOptions = {
  views: { id: string; name: string }[];
  tags: { id: string; name: string; color: string }[];
  events: { id: string; label: string }[];
  campaigns: { id: string; name: string }[];
  stages: { key: string; label: string }[];
  customFields: { key: string; label: string }[];
};

const TYPES: { value: Audience["type"]; label: string; hint: string }[] = [
  { value: "all", label: "All subscribed contacts", hint: "Everyone who has an email address and hasn't unsubscribed." },
  { value: "view", label: "Smart view", hint: "A saved contact filter from the Contacts page." },
  { value: "tags", label: "Tags", hint: "Contacts with any or all of the selected tags." },
  { value: "event", label: "Event attendees", hint: "People registered for an event, by registration status." },
  { value: "campaign", label: "Campaign", hint: "Contacts who registered for the campaign's events or were attributed to it." },
  { value: "filter", label: "Custom filter", hint: "Build your own conditions on contact fields." },
  { value: "contacts", label: "Specific contacts", hint: "Hand-pick individual contacts." },
];

const ATTENDEE_STATUSES: { value: AttendeeStatus; label: string }[] = [
  { value: "registered", label: "Registered" },
  { value: "confirmed", label: "Confirmed" },
  { value: "waitlisted", label: "Waitlisted" },
  { value: "attended", label: "Attended" },
  { value: "no_show", label: "No-show" },
  { value: "cancelled", label: "Cancelled" },
];

function defaultFor(type: Audience["type"], o: AudienceOptions): Audience {
  switch (type) {
    case "all":
      return { type: "all" };
    case "view":
      return { type: "view", viewId: o.views[0]?.id ?? "" };
    case "tags":
      return { type: "tags", tagIds: [], match: "any" };
    case "event":
      return { type: "event", eventId: o.events[0]?.id ?? "", statuses: ["registered", "confirmed", "attended"] };
    case "campaign":
      return { type: "campaign", campaignId: o.campaigns[0]?.id ?? "" };
    case "filter":
      return { type: "filter", filter: { match: "all", filters: [{ field: "stage", operator: "is", value: o.stages[0]?.key ?? "new" }] } };
    case "contacts":
      return { type: "contacts", contactIds: [] };
  }
}

/** True when the audience has everything the server needs to resolve it. */
export function isAudienceComplete(a: Audience): boolean {
  switch (a.type) {
    case "all":
      return true;
    case "view":
      return Boolean(a.viewId);
    case "tags":
      return a.tagIds.length > 0;
    case "event":
      return Boolean(a.eventId);
    case "campaign":
      return Boolean(a.campaignId);
    case "filter":
      return a.filter.filters.some((f) => isFilterComplete(f));
    case "contacts":
      return a.contactIds.length > 0;
  }
}

function isFilterComplete(f: ContactFilter) {
  if (f.operator === "is_empty" || f.operator === "is_not_empty") return true;
  return f.value != null && String(f.value).trim() !== "";
}

// ---------------------------------------------------------------------------

export function AudienceBuilder({
  value,
  onChange,
  options,
  initialPreview,
  onPreviewChange,
}: {
  value: Audience;
  onChange: (a: Audience) => void;
  options: AudienceOptions;
  /** Server-rendered preview for the initial audience (avoids a loading flash). */
  initialPreview?: AudiencePreview | null;
  /** Called whenever the live recipient count changes (null while incomplete). */
  onPreviewChange?: (preview: AudiencePreview | null) => void;
}) {
  const type = TYPES.find((t) => t.value === value.type) ?? TYPES[0];
  const missingOptions =
    (value.type === "view" && options.views.length === 0) ||
    (value.type === "event" && options.events.length === 0) ||
    (value.type === "campaign" && options.campaigns.length === 0);

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="audience-type">Send to</Label>
        <NativeSelect
          id="audience-type"
          value={value.type}
          onChange={(e) => onChange(defaultFor(e.target.value as Audience["type"], options))}
          className="w-full sm:w-72"
        >
          {TYPES.map((t) => (
            <NativeSelectOption key={t.value} value={t.value}>
              {t.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">{type.hint}</p>
      </div>

      {value.type === "view" && (
        <Field label="Smart view">
          {options.views.length ? (
            <NativeSelect value={value.viewId} onChange={(e) => onChange({ type: "view", viewId: e.target.value })} className="w-full sm:w-72">
              {options.views.map((v) => (
                <NativeSelectOption key={v.id} value={v.id}>
                  {v.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : (
            <NoOptions>No smart views yet. Save a filter on the Contacts page to create one.</NoOptions>
          )}
        </Field>
      )}

      {value.type === "tags" && <TagsEditor value={value} onChange={onChange} tags={options.tags} />}

      {value.type === "event" && (
        <div className="grid gap-4">
          <Field label="Event">
            {options.events.length ? (
              <NativeSelect value={value.eventId} onChange={(e) => onChange({ ...value, eventId: e.target.value })} className="w-full sm:w-96">
                {options.events.map((ev) => (
                  <NativeSelectOption key={ev.id} value={ev.id}>
                    {ev.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : (
              <NoOptions>No events yet. Create an event first.</NoOptions>
            )}
          </Field>
          <Field label="Registration status" hint="Leave all unchecked to include everyone who hasn't cancelled.">
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {ATTENDEE_STATUSES.map((s) => (
                <label key={s.value} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={value.statuses.includes(s.value)}
                    onCheckedChange={(c) =>
                      onChange({ ...value, statuses: c ? [...value.statuses, s.value] : value.statuses.filter((x) => x !== s.value) })
                    }
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </Field>
          <p className="text-xs text-muted-foreground">
            Event merge tags such as {"{{event.title}}"} and {"{{attendee.manage_url}}"} are filled in for each recipient.
          </p>
        </div>
      )}

      {value.type === "campaign" && (
        <Field label="Campaign">
          {options.campaigns.length ? (
            <NativeSelect value={value.campaignId} onChange={(e) => onChange({ type: "campaign", campaignId: e.target.value })} className="w-full sm:w-72">
              {options.campaigns.map((c) => (
                <NativeSelectOption key={c.id} value={c.id}>
                  {c.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : (
            <NoOptions>No campaigns yet.</NoOptions>
          )}
        </Field>
      )}

      {value.type === "filter" && <FilterEditor value={value.filter} onChange={(filter) => onChange({ type: "filter", filter })} options={options} />}

      {value.type === "contacts" && <ContactsEditor value={value} onChange={onChange} />}

      <RecipientCount
        audience={value}
        complete={isAudienceComplete(value) && !missingOptions}
        initial={initialPreview ?? null}
        onPreviewChange={onPreviewChange}
      />
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function NoOptions({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{children}</p>;
}

// ---------------------------------------------------------------------------
// Live recipient count
// ---------------------------------------------------------------------------

function RecipientCount({
  audience,
  complete,
  initial,
  onPreviewChange,
}: {
  audience: Audience;
  complete: boolean;
  initial: AudiencePreview | null;
  onPreviewChange?: (preview: AudiencePreview | null) => void;
}) {
  const [state, setState] = useState<{ preview: AudiencePreview | null; error: string | null; loading: boolean }>({
    preview: initial,
    error: null,
    loading: false,
  });
  const key = JSON.stringify(audience);

  useEffect(() => {
    if (!complete) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setState((s) => ({ ...s, loading: true }));
      try {
        const res = await previewAudienceAction(JSON.parse(key));
        if (cancelled) return;
        if (res.ok && res.data) setState({ preview: res.data, error: null, loading: false });
        else setState({ preview: null, error: res.ok ? null : res.error, loading: false });
      } catch {
        if (!cancelled) setState({ preview: null, error: "Could not calculate the audience.", loading: false });
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [key, complete]);

  const { preview, error, loading } = state;
  const reported = complete ? preview : null;
  useEffect(() => {
    onPreviewChange?.(reported);
  }, [reported, onPreviewChange]);
  const excluded = preview ? preview.matching - preview.count : 0;
  const incompleteMsg = !complete ? "Finish choosing your audience to see how many people will receive this." : null;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-muted/40 p-4" aria-live="polite">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Users className="size-5" />
        </div>
        <div>
          <div className="text-2xl leading-none font-semibold tabular-nums">
            {!complete ? "—" : loading && !preview ? <Skeleton className="h-6 w-12" /> : preview ? formatNumber(preview.count) : "—"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{preview?.count === 1 ? "recipient" : "recipients"}</div>
        </div>
      </div>
      <div className={cn("min-w-0 flex-1 text-sm text-muted-foreground transition-opacity", loading && "opacity-60")}>
        {incompleteMsg ?? error ? (
          <span className="inline-flex items-center gap-1.5">
            <AlertCircle className="size-4 shrink-0" /> {incompleteMsg ?? error}
          </span>
        ) : preview ? (
          <>
            {preview.sample.length > 0 && (
              <div className="truncate">
                Including {preview.sample.map((s) => s.name).join(", ")}
                {preview.count > preview.sample.length ? `, and ${formatNumber(preview.count - preview.sample.length)} more` : ""}
              </div>
            )}
            {excluded > 0 && (
              <div className="text-xs">
                {formatNumber(excluded)} matching {excluded === 1 ? "contact is" : "contacts are"} excluded (unsubscribed, bounced or no email address).
              </div>
            )}
            {preview.count === 0 && <div className="text-warning">Nobody would receive this email yet.</div>}
          </>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

function TagsEditor({
  value,
  onChange,
  tags,
}: {
  value: Extract<Audience, { type: "tags" }>;
  onChange: (a: Audience) => void;
  tags: AudienceOptions["tags"];
}) {
  const [open, setOpen] = useState(false);
  const selected = tags.filter((t) => value.tagIds.includes(t.id));
  const toggle = (id: string) =>
    onChange({ ...value, tagIds: value.tagIds.includes(id) ? value.tagIds.filter((x) => x !== id) : [...value.tagIds, id] });
  return (
    <div className="grid gap-4">
      <Field label="Tags">
        <div className="flex flex-wrap items-center gap-2">
          {selected.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1">
              <ColorBadge color={t.color}>{t.name}</ColorBadge>
              <button type="button" onClick={() => toggle(t.id)} aria-label={`Remove ${t.name}`} className="rounded text-muted-foreground hover:text-foreground">
                <X className="size-3.5" />
              </button>
            </span>
          ))}
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                <ChevronsUpDown /> {selected.length ? "Add tag" : "Select tags"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="start">
              <Command>
                <CommandInput placeholder="Search tags…" />
                <CommandList>
                  <CommandEmpty>{tags.length ? "No tags found." : "No tags yet."}</CommandEmpty>
                  <CommandGroup>
                    {tags.map((t) => (
                      <CommandItem key={t.id} value={t.name} onSelect={() => toggle(t.id)}>
                        <Check className={cn("size-4", value.tagIds.includes(t.id) ? "opacity-100" : "opacity-0")} />
                        <span className="size-2 rounded-full" style={{ background: t.color }} />
                        {t.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      </Field>
      <Field label="Match">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={value.match}
          onValueChange={(v) => v && onChange({ ...value, match: v as "any" | "all" })}
          className="w-fit"
        >
          <ToggleGroupItem value="any">Any of these tags</ToggleGroupItem>
          <ToggleGroupItem value="all">All of these tags</ToggleGroupItem>
        </ToggleGroup>
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Specific contacts
// ---------------------------------------------------------------------------

function ContactsEditor({ value, onChange }: { value: Extract<Audience, { type: "contacts" }>; onChange: (a: Audience) => void }) {
  const [names, setNames] = useState<Record<string, string>>({});
  const initialIds = useState(() => value.contactIds)[0];

  useEffect(() => {
    if (!initialIds.length) return;
    let cancelled = false;
    lookupContactsAction(initialIds).then((rows) => {
      if (!cancelled) setNames((n) => ({ ...Object.fromEntries(rows.map((r) => [r.id, r.name])), ...n }));
    });
    return () => {
      cancelled = true;
    };
  }, [initialIds]);

  return (
    <div className="grid gap-3">
      <Field label="Add contacts">
        <ContactPicker
          value={null}
          excludeIds={value.contactIds}
          placeholder="Search contacts to add…"
          className="w-full sm:w-96"
          onChange={(c) => {
            if (!c) return;
            setNames((n) => ({ ...n, [c.id]: c.name }));
            onChange({ type: "contacts", contactIds: [...value.contactIds, c.id] });
          }}
        />
      </Field>
      {value.contactIds.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {value.contactIds.slice(0, 100).map((id) => (
            <li key={id} className="inline-flex items-center gap-1 rounded-full border bg-card py-0.5 pr-1 pl-3 text-sm">
              {names[id] ?? "Contact"}
              <button
                type="button"
                aria-label="Remove contact"
                onClick={() => onChange({ type: "contacts", contactIds: value.contactIds.filter((x) => x !== id) })}
                className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
          {value.contactIds.length > 100 && <li className="self-center text-xs text-muted-foreground">+{value.contactIds.length - 100} more</li>}
        </ul>
      ) : (
        <NoOptions>No contacts selected yet.</NoOptions>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter rows
// ---------------------------------------------------------------------------

type FieldKind = "text" | "enum" | "date" | "number" | "tag" | "event";
type FieldDef = { key: string; label: string; kind: FieldKind; options?: { value: string; label: string }[] };

const OPERATORS: Record<FieldKind, { value: FilterOperator; label: string }[]> = {
  text: [
    { value: "is", label: "is" },
    { value: "is_not", label: "is not" },
    { value: "contains", label: "contains" },
    { value: "not_contains", label: "does not contain" },
    { value: "is_empty", label: "is empty" },
    { value: "is_not_empty", label: "is not empty" },
  ],
  enum: [
    { value: "is", label: "is" },
    { value: "is_not", label: "is not" },
  ],
  date: [
    { value: "in_last_days", label: "in the last (days)" },
    { value: "before", label: "is before" },
    { value: "after", label: "is after" },
    { value: "is_empty", label: "is empty" },
    { value: "is_not_empty", label: "is not empty" },
  ],
  number: [
    { value: "gt", label: "is greater than" },
    { value: "lt", label: "is less than" },
    { value: "is", label: "equals" },
  ],
  tag: [
    { value: "has", label: "has tag" },
    { value: "has_not", label: "does not have tag" },
  ],
  event: [
    { value: "has", label: "yes" },
    { value: "has_not", label: "no" },
  ],
};

function fieldDefs(o: AudienceOptions): FieldDef[] {
  return [
    { key: "stage", label: "Stage", kind: "enum", options: o.stages.map((s) => ({ value: s.key, label: s.label })) },
    {
      key: "lead_status",
      label: "Lead status",
      kind: "enum",
      options: ["potential", "qualified", "disqualified", "registered", "booked"].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })),
    },
    {
      key: "source",
      label: "Source",
      kind: "enum",
      options: ["manual", "import", "registration", "booking", "form", "api", "automation"].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })),
    },
    { key: "tag", label: "Tag", kind: "tag" },
    { key: "event", label: "Registered for event", kind: "event" },
    { key: "attended_event", label: "Attended event", kind: "event" },
    { key: "first_name", label: "First name", kind: "text" },
    { key: "last_name", label: "Last name", kind: "text" },
    { key: "email", label: "Email", kind: "text" },
    { key: "company", label: "Company", kind: "text" },
    { key: "job_title", label: "Job title", kind: "text" },
    { key: "city", label: "City", kind: "text" },
    { key: "country", label: "Country", kind: "text" },
    { key: "created_at", label: "Created", kind: "date" },
    { key: "last_activity_at", label: "Last activity", kind: "date" },
    { key: "deal_value", label: "Deal value", kind: "number" },
    { key: "utm_source", label: "UTM source", kind: "text" },
    { key: "utm_campaign", label: "UTM campaign", kind: "text" },
    ...o.customFields.map((c) => ({ key: `custom:${c.key}`, label: `${c.label} (custom)`, kind: "text" as const })),
  ];
}

function FilterEditor({ value, onChange, options }: { value: FilterGroup; onChange: (g: FilterGroup) => void; options: AudienceOptions }) {
  const defs = fieldDefs(options);
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const setFilter = (i: number, patch: Partial<ContactFilter>) =>
    onChange({ ...value, filters: value.filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) });

  const changeField = (i: number, key: string) => {
    const def = byKey.get(key);
    if (!def) return;
    const first = OPERATORS[def.kind][0].value;
    const initial =
      def.kind === "enum" ? (def.options?.[0]?.value ?? "") : def.kind === "tag" ? (options.tags[0]?.id ?? "") : def.kind === "event" ? (options.events[0]?.id ?? "") : "";
    setFilter(i, { field: key, operator: first, value: initial });
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        Match
        <NativeSelect size="sm" value={value.match} onChange={(e) => onChange({ ...value, match: e.target.value as "all" | "any" })} aria-label="Match mode">
          <NativeSelectOption value="all">all</NativeSelectOption>
          <NativeSelectOption value="any">any</NativeSelectOption>
        </NativeSelect>
        of these conditions
      </div>
      {value.filters.map((f, i) => {
        const def = byKey.get(f.field) ?? defs[0];
        const ops = OPERATORS[def.kind];
        const needsValue = f.operator !== "is_empty" && f.operator !== "is_not_empty";
        const v = f.value == null ? "" : Array.isArray(f.value) ? (f.value[0] ?? "") : String(f.value);
        return (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
            <NativeSelect size="sm" value={def.key} onChange={(e) => changeField(i, e.target.value)} aria-label="Field" className="w-44">
              {defs.map((d) => (
                <NativeSelectOption key={d.key} value={d.key}>
                  {d.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <NativeSelect
              size="sm"
              value={f.operator}
              onChange={(e) => setFilter(i, { operator: e.target.value as FilterOperator })}
              aria-label="Condition"
              className={def.kind === "event" ? "w-20" : "w-44"}
            >
              {ops.map((o) => (
                <NativeSelectOption key={o.value} value={o.value}>
                  {o.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {needsValue && (
              <div className="min-w-40 flex-1">
                {def.kind === "enum" && (
                  <NativeSelect size="sm" value={v} onChange={(e) => setFilter(i, { value: e.target.value })} aria-label="Value" className="w-full">
                    {def.options?.map((o) => (
                      <NativeSelectOption key={o.value} value={o.value}>
                        {o.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
                {def.kind === "tag" && (
                  <NativeSelect size="sm" value={v} onChange={(e) => setFilter(i, { value: e.target.value })} aria-label="Tag" className="w-full">
                    {options.tags.length === 0 && <NativeSelectOption value="">No tags</NativeSelectOption>}
                    {options.tags.map((t) => (
                      <NativeSelectOption key={t.id} value={t.id}>
                        {t.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
                {def.kind === "event" && (
                  <NativeSelect size="sm" value={v} onChange={(e) => setFilter(i, { value: e.target.value })} aria-label="Event" className="w-full">
                    {options.events.length === 0 && <NativeSelectOption value="">No events</NativeSelectOption>}
                    {options.events.map((ev) => (
                      <NativeSelectOption key={ev.id} value={ev.id}>
                        {ev.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
                {def.kind === "text" && <Input className="h-7" value={v} onChange={(e) => setFilter(i, { value: e.target.value })} aria-label="Value" placeholder="Value" />}
                {def.kind === "number" && (
                  <Input className="h-7" type="number" value={v} onChange={(e) => setFilter(i, { value: e.target.value })} aria-label="Value" />
                )}
                {def.kind === "date" &&
                  (f.operator === "in_last_days" ? (
                    <Input className="h-7" type="number" min={1} value={v} onChange={(e) => setFilter(i, { value: e.target.value })} aria-label="Days" placeholder="30" />
                  ) : (
                    <Input className="h-7" type="date" value={v} onChange={(e) => setFilter(i, { value: e.target.value })} aria-label="Date" />
                  ))}
              </div>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Remove condition"
              onClick={() => onChange({ ...value, filters: value.filters.filter((_, idx) => idx !== i) })}
              className="ml-auto"
            >
              <Trash2 />
            </Button>
          </div>
        );
      })}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange({ ...value, filters: [...value.filters, { field: "stage", operator: "is", value: options.stages[0]?.key ?? "new" }] })}
          disabled={value.filters.length >= 25}
        >
          <Plus /> Add condition
        </Button>
      </div>
    </div>
  );
}
