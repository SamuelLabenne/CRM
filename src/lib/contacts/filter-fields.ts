// Client-safe metadata describing which contact fields can be filtered, which operators apply
// to each, and how to render a filter as a short human-readable string.
import type { ContactFilter, CustomFieldType, FilterOperator, Stage } from "@/lib/types";

/** Reference data the filter UI needs. Pass whatever you have; empty arrays simply hide those fields' choices. */
export type FilterOptions = {
  tags: { id: string; name: string; color?: string | null }[];
  users: { id: string; name: string }[];
  stages: Pick<Stage, "key" | "label" | "color">[];
  customFields: { key: string; label: string; type: CustomFieldType; options?: string[] }[];
  events: { id: string; title: string }[];
};

export type FieldKind = "text" | "select" | "number" | "date" | "tag" | "event" | "attended_event" | "bool" | "multiselect";

export type FilterFieldDef = {
  key: string;
  label: string;
  kind: FieldKind;
  group: "Contact" | "Pipeline" | "Activity" | "Tags & events" | "Custom fields";
  /** Fixed choices for select-like kinds. */
  options?: { value: string; label: string }[];
};

export const LEAD_STATUS_OPTIONS = [
  { value: "potential", label: "Potential" },
  { value: "qualified", label: "Qualified" },
  { value: "disqualified", label: "Disqualified" },
  { value: "registered", label: "Registered" },
  { value: "booked", label: "Booked" },
];

export const SOURCE_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: "import", label: "Import" },
  { value: "registration", label: "Event registration" },
  { value: "booking", label: "Booking page" },
  { value: "form", label: "Form" },
  { value: "api", label: "API" },
  { value: "automation", label: "Automation" },
];

export const EMAIL_STATUS_OPTIONS = [
  { value: "subscribed", label: "Subscribed" },
  { value: "unsubscribed", label: "Unsubscribed" },
  { value: "bounced", label: "Bounced" },
  { value: "complained", label: "Complained" },
];

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  not_contains: "doesn't contain",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  gt: "is greater than",
  lt: "is less than",
  before: "is before",
  after: "is after",
  in_last_days: "is in the last (days)",
  has: "has",
  has_not: "doesn't have",
};

const TEXT_FIELDS: [string, string, FilterFieldDef["group"]][] = [
  ["first_name", "First name", "Contact"],
  ["last_name", "Last name", "Contact"],
  ["email", "Email", "Contact"],
  ["phone", "Phone", "Contact"],
  ["company", "Company", "Contact"],
  ["job_title", "Job title", "Contact"],
  ["website", "Website", "Contact"],
  ["city", "City", "Contact"],
  ["country", "Country", "Contact"],
  ["utm_source", "UTM source (first touch)", "Activity"],
  ["utm_campaign", "UTM campaign (first touch)", "Activity"],
];

/** All filterable fields for the given reference data, grouped for display. */
export function buildFieldList(options: FilterOptions): FilterFieldDef[] {
  const fields: FilterFieldDef[] = [];
  for (const [key, label, group] of TEXT_FIELDS) fields.push({ key, label, kind: "text", group });
  fields.push(
    { key: "stage", label: "Stage", kind: "select", group: "Pipeline", options: options.stages.map((s) => ({ value: s.key, label: s.label })) },
    { key: "lead_status", label: "Lead status", kind: "select", group: "Pipeline", options: LEAD_STATUS_OPTIONS },
    { key: "owner_id", label: "Owner", kind: "select", group: "Pipeline", options: options.users.map((u) => ({ value: u.id, label: u.name })) },
    { key: "deal_value", label: "Deal value", kind: "number", group: "Pipeline" },
    { key: "source", label: "Source", kind: "select", group: "Contact", options: SOURCE_OPTIONS },
    { key: "email_status", label: "Email status", kind: "select", group: "Contact", options: EMAIL_STATUS_OPTIONS },
    { key: "created_at", label: "Created", kind: "date", group: "Activity" },
    { key: "last_activity_at", label: "Last activity", kind: "date", group: "Activity" },
    { key: "tag", label: "Tag", kind: "tag", group: "Tags & events" },
    { key: "event", label: "Registered for event", kind: "event", group: "Tags & events" },
    { key: "attended_event", label: "Attended event", kind: "attended_event", group: "Tags & events" },
  );
  for (const cf of options.customFields) {
    const key = `custom:${cf.key}`;
    const base = { key, label: cf.label, group: "Custom fields" as const };
    switch (cf.type) {
      case "number":
        fields.push({ ...base, kind: "number" });
        break;
      case "date":
        fields.push({ ...base, kind: "date" });
        break;
      case "checkbox":
        fields.push({ ...base, kind: "bool" });
        break;
      case "select":
        fields.push({ ...base, kind: "select", options: (cf.options ?? []).map((o) => ({ value: o, label: o })) });
        break;
      case "multiselect":
        fields.push({ ...base, kind: "multiselect", options: (cf.options ?? []).map((o) => ({ value: o, label: o })) });
        break;
      default:
        fields.push({ ...base, kind: "text" });
    }
  }
  return fields;
}

export function operatorsFor(field: Pick<FilterFieldDef, "kind" | "key">): FilterOperator[] {
  switch (field.kind) {
    case "text":
      return ["contains", "is", "is_not", "not_contains", "is_empty", "is_not_empty"];
    case "select":
      // Pipeline fields that can legitimately be unset.
      return field.key === "owner_id" || field.key === "lead_status"
        ? ["is", "is_not", "is_empty", "is_not_empty"]
        : ["is", "is_not"];
    case "multiselect":
      return ["contains", "not_contains", "is_empty", "is_not_empty"];
    case "bool":
      return ["is"];
    case "number":
      return ["is", "gt", "lt", "is_empty", "is_not_empty"];
    case "date":
      return field.key.startsWith("custom:")
        ? ["in_last_days", "before", "after", "is_empty", "is_not_empty"]
        : field.key === "last_activity_at"
          ? ["in_last_days", "before", "after", "is_empty", "is_not_empty"]
          : ["in_last_days", "before", "after"];
    case "tag":
    case "event":
    case "attended_event":
      return ["has", "has_not"];
  }
}

/** Operator label, adapted to the field kind ("has" → "registered for"…). */
export function operatorLabel(field: Pick<FilterFieldDef, "kind"> | undefined, op: FilterOperator): string {
  if (field?.kind === "event") return op === "has" ? "registered for" : "not registered for";
  if (field?.kind === "attended_event") return op === "has" ? "attended" : "didn't attend";
  if (field?.kind === "tag") return op === "has" ? "has tag" : "doesn't have tag";
  return OPERATOR_LABELS[op];
}

export function defaultOperator(field: Pick<FilterFieldDef, "kind" | "key">): FilterOperator {
  return operatorsFor(field)[0];
}

/** Human readable value of a filter ("Contacted", "VIP", "Acme webinar"…). */
export function describeValue(filter: ContactFilter, field: FilterFieldDef | undefined, options: FilterOptions): string {
  const v = filter.value;
  if (v == null || v === "") return "";
  const one = (raw: string) => {
    if (!field) return raw;
    if (field.kind === "tag") return options.tags.find((t) => t.id === raw)?.name ?? "(deleted tag)";
    if (field.kind === "event" || field.kind === "attended_event") return options.events.find((e) => e.id === raw)?.title ?? "(event)";
    if (field.kind === "bool") return raw === "true" ? "checked" : "unchecked";
    if (field.options) return field.options.find((o) => o.value === raw)?.label ?? raw;
    return raw;
  };
  if (Array.isArray(v)) return v.map(one).join(" or ");
  return one(String(v));
}

/** "Stage is Contacted" style summary for chips and tooltips. */
export function describeFilter(filter: ContactFilter, options: FilterOptions): string {
  const field = buildFieldList(options).find((f) => f.key === filter.field);
  const label = field?.label ?? filter.field;
  const op = operatorLabel(field, filter.operator);
  const value = describeValue(filter, field, options);
  return `${label} ${op}${value ? ` ${value}` : ""}`.trim();
}
