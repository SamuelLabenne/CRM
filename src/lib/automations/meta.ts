// Client-safe automation metadata: trigger/step catalogues, plain-English summaries
// and validation. Used by the builder UI, the list page and the server actions.
// No server-only imports here.

import { nanoid } from "nanoid";
import type {
  AttendeeStatus,
  AutomationStep,
  AutomationTrigger,
  ContactFilter,
  FilterGroup,
  FilterOperator,
  MeetingOutcome,
  Stage,
  TriggerConfig,
  TriggerType,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

export type TriggerGroupName = "Contacts" | "Events" | "Meetings" | "Email" | "Manual";

export type TriggerMeta = {
  label: string;
  description: string;
  group: TriggerGroupName;
  /** Which config selectors the builder shows for this trigger. */
  fields: (keyof TriggerConfig)[];
  /**
   * Does the trigger context carry an event? "maybe" = only sometimes (lead_potential for
   * registration forms, manual enrolment with an event picked).
   */
  event: "yes" | "maybe" | "no";
};

export const TRIGGER_META: Record<TriggerType, TriggerMeta> = {
  contact_created: {
    label: "Contact created",
    description: "A new contact is added from any source",
    group: "Contacts",
    fields: [],
    event: "no",
  },
  tag_added: {
    label: "Tag added",
    description: "A tag is added to a contact",
    group: "Contacts",
    fields: ["tagId"],
    event: "no",
  },
  stage_changed: {
    label: "Stage changed",
    description: "A contact moves to a pipeline stage",
    group: "Contacts",
    fields: ["stage"],
    event: "no",
  },
  lead_potential: {
    label: "Potential lead",
    description: "Someone enters their email on a form but doesn't finish",
    group: "Contacts",
    fields: ["eventId", "bookingPageId", "campaignId"],
    event: "maybe",
  },
  event_registered: {
    label: "Registered for event",
    description: "A contact registers for an event",
    group: "Events",
    fields: ["eventId", "campaignId"],
    event: "yes",
  },
  event_cancelled: {
    label: "Cancelled registration",
    description: "A contact cancels their event registration",
    group: "Events",
    fields: ["eventId", "campaignId"],
    event: "yes",
  },
  event_attended: {
    label: "Attended event",
    description: "A contact is marked as attended",
    group: "Events",
    fields: ["eventId", "campaignId"],
    event: "yes",
  },
  event_no_show: {
    label: "No-show at event",
    description: "A contact is marked as a no-show",
    group: "Events",
    fields: ["eventId", "campaignId"],
    event: "yes",
  },
  meeting_booked: {
    label: "Meeting booked",
    description: "A contact books a meeting through a booking page",
    group: "Meetings",
    fields: ["bookingPageId", "campaignId"],
    event: "yes",
  },
  meeting_cancelled: {
    label: "Meeting cancelled",
    description: "A booked meeting is cancelled",
    group: "Meetings",
    fields: ["bookingPageId", "campaignId"],
    event: "yes",
  },
  meeting_outcome: {
    label: "Meeting outcome logged",
    description: "An outcome (won, lost, no-show…) is logged for a meeting",
    group: "Meetings",
    fields: ["bookingPageId", "outcome", "campaignId"],
    event: "yes",
  },
  email_clicked: {
    label: "Email link clicked",
    description: "A contact clicks a link in an email you sent",
    group: "Email",
    fields: [],
    event: "no",
  },
  manual: {
    label: "Manual enrolment",
    description: "You enroll contacts yourself, one by one or from a smart view",
    group: "Manual",
    fields: [],
    event: "maybe",
  },
};

export const TRIGGER_GROUPS: TriggerGroupName[] = ["Contacts", "Events", "Meetings", "Email", "Manual"];
export const TRIGGER_TYPES = Object.keys(TRIGGER_META) as TriggerType[];

export const OUTCOME_LABELS: Record<MeetingOutcome, string> = {
  won: "Won",
  lost: "Lost",
  follow_up: "Follow-up",
  not_qualified: "Not qualified",
  no_show: "No-show",
  cancelled: "Cancelled",
};

/** Keep only the config keys that make sense for a trigger type (and drop empty values). */
export function pruneTriggerConfig(type: TriggerType, config: TriggerConfig | null | undefined): TriggerConfig {
  const out: TriggerConfig = {};
  for (const key of TRIGGER_META[type]?.fields ?? []) {
    const v = config?.[key];
    if (v) (out as Record<string, unknown>)[key] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Names (for plain-English summaries)
// ---------------------------------------------------------------------------

export type NameLookups = {
  tags?: Record<string, string>;
  stages?: Record<string, string>;
  events?: Record<string, string>;
  campaigns?: Record<string, string>;
  bookingPages?: Record<string, string>;
  templates?: Record<string, string>;
  users?: Record<string, string>;
};

const q = (s: string) => `“${s}”`;

export function describeTrigger(trigger: AutomationTrigger, n: NameLookups = {}): string {
  const c = trigger.config ?? {};
  const eventName = c.eventId ? q(n.events?.[c.eventId] ?? "selected event") : null;
  const campaignName = c.campaignId ? q(n.campaigns?.[c.campaignId] ?? "selected campaign") : null;
  const pageName = c.bookingPageId ? q(n.bookingPages?.[c.bookingPageId] ?? "selected booking page") : null;
  const eventScope = eventName ?? (campaignName ? `any event in ${campaignName}` : "any event");
  const meetingScope = pageName ? ` on ${pageName}` : campaignName ? ` in ${campaignName}` : "";

  switch (trigger.type) {
    case "contact_created":
      return "When a contact is created";
    case "tag_added":
      return c.tagId ? `When a contact is tagged ${q(n.tags?.[c.tagId] ?? "tag")}` : "When any tag is added to a contact";
    case "stage_changed":
      return c.stage ? `When a contact moves to ${q(n.stages?.[c.stage] ?? c.stage)}` : "When a contact's stage changes";
    case "lead_potential": {
      const scope = eventName ? ` for ${eventName}` : pageName ? ` for ${pageName}` : campaignName ? ` in ${campaignName}` : "";
      return `When someone starts a form but doesn't finish${scope}`;
    }
    case "event_registered":
      return `When a contact registers for ${eventScope}`;
    case "event_cancelled":
      return `When a contact cancels their registration for ${eventScope}`;
    case "event_attended":
      return `When a contact attends ${eventScope}`;
    case "event_no_show":
      return `When a contact is a no-show for ${eventScope}`;
    case "meeting_booked":
      return `When a meeting is booked${meetingScope}`;
    case "meeting_cancelled":
      return `When a meeting is cancelled${meetingScope}`;
    case "meeting_outcome":
      return `When a meeting outcome ${c.outcome ? `is logged as ${q(OUTCOME_LABELS[c.outcome] ?? c.outcome)}` : "is logged"}${meetingScope}`;
    case "email_clicked":
      return "When a contact clicks a link in an email";
    case "manual":
      return "When contacts are enrolled manually";
    default:
      return "When something happens";
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export type StepType = AutomationStep["type"];
export type StepGroupName = "Messages" | "Timing" | "Logic" | "CRM" | "Team & integrations";

export const STEP_META: Record<StepType, { label: string; description: string; group: StepGroupName }> = {
  send_email: { label: "Send email", description: "Send an email template to the contact", group: "Messages" },
  wait: { label: "Wait", description: "Pause for a set amount of time", group: "Timing" },
  wait_until_event: {
    label: "Wait until event",
    description: "Pause until a set time before or after an event starts or ends",
    group: "Timing",
  },
  condition: {
    label: "Condition",
    description: "Only continue if the contact matches – otherwise exit the automation",
    group: "Logic",
  },
  add_tag: { label: "Add tag", description: "Tag the contact", group: "CRM" },
  remove_tag: { label: "Remove tag", description: "Remove a tag from the contact", group: "CRM" },
  set_stage: { label: "Change stage", description: "Move the contact to another pipeline stage", group: "CRM" },
  create_task: { label: "Create task", description: "Add a follow-up task for the contact owner or a teammate", group: "CRM" },
  notify_team: { label: "Notify team", description: "Send an in-app notification to your team", group: "Team & integrations" },
  webhook: { label: "Send webhook", description: "POST the contact and run details to a URL", group: "Team & integrations" },
};

export const STEP_GROUPS: StepGroupName[] = ["Messages", "Timing", "Logic", "CRM", "Team & integrations"];
export const STEP_TYPES = Object.keys(STEP_META) as StepType[];

export const WAIT_UNITS = ["minutes", "hours", "days"] as const;
export type WaitUnit = (typeof WAIT_UNITS)[number];
const UNIT_MS: Record<WaitUnit, number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };

export function waitToMs(amount: number, unit: WaitUnit) {
  return Math.max(0, amount) * UNIT_MS[unit];
}

/** 1440 → { amount: 1, unit: "days" }; picks the largest unit that divides evenly. */
export function splitMinutes(minutes: number): { amount: number; unit: WaitUnit } {
  const m = Math.abs(Math.round(minutes));
  if (m > 0 && m % 1440 === 0) return { amount: m / 1440, unit: "days" };
  if (m > 0 && m % 60 === 0) return { amount: m / 60, unit: "hours" };
  return { amount: m, unit: "minutes" };
}

export function minutesFrom(amount: number, unit: WaitUnit) {
  return Math.round(waitToMs(amount, unit) / 60_000);
}

const plural = (n: number, unit: string) => `${n} ${n === 1 ? unit.replace(/s$/, "") : unit}`;

export function formatWait(amount: number, unit: WaitUnit) {
  return plural(amount, unit);
}

export function formatOffset(minutes: number) {
  const { amount, unit } = splitMinutes(minutes);
  return formatWait(amount, unit);
}

export const ATTENDANCE_OPTIONS: { value: AttendeeStatus; label: string }[] = [
  { value: "registered", label: "Registered" },
  { value: "confirmed", label: "Confirmed (RSVP yes)" },
  { value: "waitlisted", label: "Waitlisted" },
  { value: "attended", label: "Attended" },
  { value: "no_show", label: "No-show" },
  { value: "cancelled", label: "Cancelled" },
];

// ---------------------------------------------------------------------------
// Condition filters (minimal editor – the engine supports any FilterGroup field)
// ---------------------------------------------------------------------------

export const LEAD_STATUS_OPTIONS = [
  { value: "potential", label: "Potential" },
  { value: "qualified", label: "Qualified" },
  { value: "disqualified", label: "Disqualified" },
  { value: "registered", label: "Registered" },
  { value: "booked", label: "Booked" },
];
export const EMAIL_STATUS_OPTIONS = [
  { value: "subscribed", label: "Subscribed" },
  { value: "unsubscribed", label: "Unsubscribed" },
  { value: "bounced", label: "Bounced" },
  { value: "complained", label: "Complained" },
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

export type ConditionFieldKind = "stage" | "enum" | "tag" | "text";
export type ConditionField = {
  value: string;
  label: string;
  kind: ConditionFieldKind;
  options?: { value: string; label: string }[];
};

export const CONDITION_FIELDS: ConditionField[] = [
  { value: "stage", label: "Stage", kind: "stage" },
  { value: "lead_status", label: "Lead status", kind: "enum", options: LEAD_STATUS_OPTIONS },
  { value: "tag", label: "Tag", kind: "tag" },
  { value: "email_status", label: "Email status", kind: "enum", options: EMAIL_STATUS_OPTIONS },
  { value: "source", label: "Source", kind: "enum", options: SOURCE_OPTIONS },
  { value: "company", label: "Company", kind: "text" },
  { value: "job_title", label: "Job title", kind: "text" },
  { value: "city", label: "City", kind: "text" },
  { value: "country", label: "Country", kind: "text" },
  { value: "email", label: "Email", kind: "text" },
];

export function conditionFieldFor(field: string, customFields: { key: string; label: string }[] = []): ConditionField | null {
  const base = CONDITION_FIELDS.find((f) => f.value === field);
  if (base) return base;
  if (field.startsWith("custom:")) {
    const key = field.slice(7);
    const cf = customFields.find((c) => c.key === key);
    return { value: field, label: cf ? `${cf.label} (custom)` : `${key} (custom)`, kind: "text" };
  }
  return null;
}

export const OPERATOR_LABELS: Partial<Record<FilterOperator, string>> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  not_contains: "doesn't contain",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  has: "has",
  has_not: "doesn't have",
};

export function operatorsFor(kind: ConditionFieldKind): FilterOperator[] {
  switch (kind) {
    case "tag":
      return ["has", "has_not"];
    case "stage":
    case "enum":
      return ["is", "is_not"];
    default:
      return ["is", "is_not", "contains", "not_contains", "is_empty", "is_not_empty"];
  }
}

export const valueless = (op: FilterOperator) => op === "is_empty" || op === "is_not_empty";

export function describeFilter(f: ContactFilter, n: NameLookups = {}, customFields: { key: string; label: string }[] = []): string {
  const field = conditionFieldFor(f.field, customFields);
  const label = field?.label ?? f.field;
  const op = OPERATOR_LABELS[f.operator] ?? f.operator;
  if (valueless(f.operator)) return `${label} ${op}`;
  let value = Array.isArray(f.value) ? f.value.join(", ") : String(f.value ?? "…");
  if (f.field === "tag") value = q(n.tags?.[value] ?? "tag");
  else if (f.field === "stage") value = q(n.stages?.[value] ?? value);
  else if (field?.options) value = q(field.options.find((o) => o.value === value)?.label ?? value);
  else value = q(value);
  return `${label} ${op} ${value}`;
}

export function describeCondition(step: Extract<AutomationStep, { type: "condition" }>, n: NameLookups = {}): string {
  const parts: string[] = step.filter.filters.map((f) => describeFilter(f, n));
  if (step.attendance?.length) {
    const labels = step.attendance.map((s) => ATTENDANCE_OPTIONS.find((o) => o.value === s)?.label.split(" (")[0].toLowerCase() ?? s);
    parts.push(`attendance is ${labels.join(" or ")}`);
  }
  if (!parts.length) return "Continue only if… (no conditions yet)";
  return `Continue only if ${parts.join(step.filter.match === "any" && !step.attendance?.length ? " or " : " and ")}`;
}

export function describeStep(step: AutomationStep, n: NameLookups = {}): string {
  switch (step.type) {
    case "send_email":
      return step.templateId ? `Send ${q(n.templates?.[step.templateId] ?? "email")}` : "Send an email (choose a template)";
    case "wait":
      return `Wait ${formatWait(step.amount, step.unit)}`;
    case "wait_until_event": {
      const anchor = step.anchor === "start" ? "starts" : "ends";
      if (step.offsetMinutes === 0) return `Wait until the event ${anchor}`;
      return `Wait until ${formatOffset(step.offsetMinutes)} ${step.offsetMinutes < 0 ? "before" : "after"} the event ${anchor}`;
    }
    case "condition":
      return describeCondition(step, n);
    case "add_tag":
      return step.tagId ? `Add tag ${q(n.tags?.[step.tagId] ?? "tag")}` : "Add a tag (choose one)";
    case "remove_tag":
      return step.tagId ? `Remove tag ${q(n.tags?.[step.tagId] ?? "tag")}` : "Remove a tag (choose one)";
    case "set_stage":
      return step.stage ? `Move to stage ${q(n.stages?.[step.stage] ?? step.stage)}` : "Change stage (choose one)";
    case "create_task":
      return step.title
        ? `Create task ${q(step.title)} due in ${plural(step.dueInDays, "days")}`
        : "Create a task (add a title)";
    case "notify_team":
      return step.message ? `Notify team: ${q(step.message)}` : "Notify team (add a message)";
    case "webhook":
      return step.url ? `POST to ${step.url}` : "Send a webhook (add a URL)";
  }
}

/** A fresh step with sensible defaults. */
export function newStep(type: StepType): AutomationStep {
  const id = nanoid(8);
  switch (type) {
    case "send_email":
      return { id, type, templateId: "" };
    case "wait":
      return { id, type, amount: 1, unit: "days" };
    case "wait_until_event":
      return { id, type, anchor: "start", offsetMinutes: -1440 };
    case "condition":
      return { id, type, filter: { match: "all", filters: [] }, attendance: [] };
    case "add_tag":
    case "remove_tag":
      return { id, type, tagId: "" };
    case "set_stage":
      return { id, type, stage: "" };
    case "create_task":
      return { id, type, title: "Follow up with {{contact.first_name}}", dueInDays: 1, assigneeId: null };
    case "notify_team":
      return { id, type, message: "{{contact.full_name}} needs attention", userIds: [] };
    case "webhook":
      return { id, type, url: "" };
  }
}

// ---------------------------------------------------------------------------
// Validation (used by the builder UI and again on the server before activating)
// ---------------------------------------------------------------------------

export type AutomationIssue = { field: "name" | "trigger" | "steps" | "step"; stepId?: string; message: string };

export function validateAutomation(
  input: { name: string; trigger: AutomationTrigger; steps: AutomationStep[] },
): AutomationIssue[] {
  const issues: AutomationIssue[] = [];
  if (!input.name.trim()) issues.push({ field: "name", message: "Give the automation a name" });
  if (!TRIGGER_META[input.trigger.type]) issues.push({ field: "trigger", message: "Choose a trigger" });
  if (!input.steps.length) issues.push({ field: "steps", message: "Add at least one step" });

  const eventAvailability = TRIGGER_META[input.trigger.type]?.event ?? "no";
  const needsEvent = "This step needs an event – use an event or meeting trigger (or enroll contacts manually with an event)";

  for (const step of input.steps) {
    const add = (message: string) => issues.push({ field: "step", stepId: step.id, message });
    switch (step.type) {
      case "send_email":
        if (!step.templateId) add("Choose an email template");
        break;
      case "wait":
        if (!Number.isFinite(step.amount) || step.amount < 1) add("Wait for at least 1 minute, hour or day");
        break;
      case "wait_until_event":
        if (eventAvailability === "no") add(needsEvent);
        if (!Number.isFinite(step.offsetMinutes)) add("Enter a valid offset");
        break;
      case "condition": {
        const hasAttendance = Boolean(step.attendance?.length);
        if (!step.filter.filters.length && !hasAttendance) add("Add at least one condition");
        for (const f of step.filter.filters) {
          if (!f.field || !f.operator) {
            add("Complete every condition row");
            break;
          }
          if (!valueless(f.operator) && (f.value == null || f.value === "" || (Array.isArray(f.value) && !f.value.length))) {
            add("Complete every condition row");
            break;
          }
        }
        if (hasAttendance && eventAvailability === "no") add(needsEvent);
        break;
      }
      case "add_tag":
      case "remove_tag":
        if (!step.tagId) add("Choose a tag");
        break;
      case "set_stage":
        if (!step.stage) add("Choose a stage");
        break;
      case "create_task":
        if (!step.title.trim()) add("Give the task a title");
        if (!Number.isFinite(step.dueInDays) || step.dueInDays < 0) add("Due in must be 0 days or more");
        break;
      case "notify_team":
        if (!step.message.trim()) add("Write a notification message");
        break;
      case "webhook":
        if (!/^https?:\/\/[^\s/]+/i.test(step.url.trim())) add("Enter a valid http(s) URL");
        break;
    }
  }
  return issues;
}

export function emptyFilterGroup(): FilterGroup {
  return { match: "all", filters: [] };
}

/** Serializable option lists for the builder UI. */
export type BuilderLookups = {
  timezone: string;
  tags: { id: string; name: string; color: string }[];
  stages: Stage[];
  events: { id: string; title: string; startsAt: string; kind: "event" | "meeting" }[];
  campaigns: { id: string; name: string }[];
  bookingPages: { id: string; title: string }[];
  templates: { id: string; name: string; subject: string; system: boolean }[];
  users: { id: string; name: string }[];
  customFields: { key: string; label: string }[];
  views: { id: string; name: string }[];
};

/** Name maps for plain-English summaries. */
export function toNameLookups(l: BuilderLookups): NameLookups {
  return {
    tags: Object.fromEntries(l.tags.map((t) => [t.id, t.name])),
    stages: Object.fromEntries(l.stages.map((s) => [s.key, s.label])),
    events: Object.fromEntries(l.events.map((e) => [e.id, e.title])),
    campaigns: Object.fromEntries(l.campaigns.map((c) => [c.id, c.name])),
    bookingPages: Object.fromEntries(l.bookingPages.map((p) => [p.id, p.title])),
    templates: Object.fromEntries(l.templates.map((t) => [t.id, t.name])),
    users: Object.fromEntries(l.users.map((u) => [u.id, u.name])),
  };
}
