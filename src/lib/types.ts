// Shared domain types used across modules (stored in jsonb columns or passed
// between modules). Keep this file dependency-free so it can be imported from
// both server and client code.

// ---------------------------------------------------------------------------
// Users & workspace
// ---------------------------------------------------------------------------

export type UserRole = "owner" | "admin" | "member";

/** Weekly availability, keyed by weekday (0 = Sunday … 6 = Saturday). Times are "HH:mm" in the user's timezone. */
export type WeeklyAvailability = Record<
  "0" | "1" | "2" | "3" | "4" | "5" | "6",
  { start: string; end: string }[]
>;

/** A date-specific override; an empty `slots` array means unavailable all day. */
export type DateOverride = { date: string; slots: { start: string; end: string }[] };

export type StageCategory = "active" | "won" | "lost";
export type Stage = { key: string; label: string; color: string; category: StageCategory };

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

/** System-managed funnel status (inspired by iClosed "scheduling status"). */
export type LeadStatus = "potential" | "qualified" | "disqualified" | "registered" | "booked";

export type ContactSource =
  | "manual"
  | "import"
  | "registration"
  | "booking"
  | "form"
  | "api"
  | "automation";

export type EmailStatus = "subscribed" | "unsubscribed" | "bounced" | "complained";

export type CustomFieldType =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "select"
  | "multiselect"
  | "url"
  | "checkbox";

export type Utm = {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
};

export type FilterOperator =
  | "is"
  | "is_not"
  | "contains"
  | "not_contains"
  | "is_empty"
  | "is_not_empty"
  | "gt"
  | "lt"
  | "before"
  | "after"
  | "in_last_days"
  | "has"
  | "has_not";

/**
 * A single contact filter. `field` is one of:
 *  - a contact column: "first_name" | "last_name" | "email" | "phone" | "company" | "job_title"
 *    | "city" | "country" | "stage" | "lead_status" | "source" | "owner_id" | "email_status"
 *    | "created_at" | "last_activity_at" | "deal_value" | "utm_source" | "utm_campaign"
 *  - "tag" (value = tag id, operators has / has_not)
 *  - "event" (value = event id, operators has / has_not → registered for event, any non-cancelled status)
 *  - "attended_event" (value = event id, operators has / has_not)
 *  - "custom:<key>" for custom fields
 */
export type ContactFilter = { field: string; operator: FilterOperator; value?: string | number | string[] | null };
export type FilterGroup = { match: "all" | "any"; filters: ContactFilter[] };

// ---------------------------------------------------------------------------
// Forms (event registration & booking pages)
// ---------------------------------------------------------------------------

export type FormQuestionType =
  | "text"
  | "textarea"
  | "select"
  | "multiselect"
  | "number"
  | "date"
  | "url"
  | "checkbox";

export type FormQuestion = {
  /** Stable id; used as the key in `answers` and in merge tags ({{answers.<id>}}). */
  id: string;
  label: string;
  type: FormQuestionType;
  required: boolean;
  options?: string[];
  placeholder?: string;
  /** Optionally copy the answer onto the contact: a contact column ("company", "job_title", "phone", "website", "city", "country") or "custom:<key>". */
  mapTo?: string | null;
};

export type RuleOperator = "is" | "is_not" | "includes" | "not_includes" | "lt" | "gt" | "is_empty" | "is_not_empty";
export type RuleCondition = { questionId: string; operator: RuleOperator; value?: string | number | string[] | null };
/** Conditions inside a group are joined by `combinator`; groups are OR'ed together. */
export type RuleGroup = { id: string; combinator: "and" | "or"; conditions: RuleCondition[] };

export type Answers = Record<string, string | string[] | number | boolean | null>;

// ---------------------------------------------------------------------------
// Events, registrations & meetings
// ---------------------------------------------------------------------------

export type EventKind = "event" | "meeting";
export type EventType =
  | "webinar"
  | "workshop"
  | "meetup"
  | "conference"
  | "class"
  | "meeting"
  | "call"
  | "other";
export type EventStatus = "draft" | "scheduled" | "completed" | "cancelled";
export type LocationType = "online" | "in_person" | "phone";

export type AttendeeStatus = "registered" | "confirmed" | "waitlisted" | "attended" | "no_show" | "cancelled";
export type Rsvp = "yes" | "no" | "maybe";

/** Outcome logged after a meeting (inspired by iClosed call outcomes). */
export type MeetingOutcome = "won" | "lost" | "follow_up" | "not_qualified" | "no_show" | "cancelled";
export const MEETING_OBJECTIONS = ["money", "timing", "partner", "fear", "smoke_screen", "no_objection"] as const;
export type MeetingObjection = (typeof MEETING_OBJECTIONS)[number];

/** Per-event (and per-booking-page) automatic emails. `templateId: null` = use the built-in system template. */
export type EventNotifications = {
  confirmation: { enabled: boolean; templateId?: string | null };
  cancellation: { enabled: boolean; templateId?: string | null };
  reminders: { id: string; minutesBefore: number; templateId?: string | null }[];
  followUps: {
    id: string;
    minutesAfter: number;
    audience: "attended" | "no_show" | "all";
    templateId?: string | null;
  }[];
  /** Email the host/owner when someone registers or books. */
  notifyHost: boolean;
};

export const DEFAULT_EVENT_NOTIFICATIONS: EventNotifications = {
  confirmation: { enabled: true, templateId: null },
  cancellation: { enabled: true, templateId: null },
  reminders: [
    { id: "r24h", minutesBefore: 24 * 60, templateId: null },
    { id: "r1h", minutesBefore: 60, templateId: null },
  ],
  followUps: [
    { id: "f-attended", minutesAfter: 120, audience: "attended", templateId: null },
    { id: "f-noshow", minutesAfter: 120, audience: "no_show", templateId: null },
  ],
  notifyHost: true,
};

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export type EmailProvider = "outbox" | "resend" | "smtp";
export type MessageStatus = "queued" | "sent" | "simulated" | "failed" | "bounced";
export type MessageKind = "broadcast" | "automation" | "notification" | "transactional" | "test" | "manual";
export type BroadcastStatus = "draft" | "scheduled" | "sending" | "sent" | "cancelled" | "failed";

/** Who receives a broadcast. Unsubscribed/bounced contacts and contacts without an email are always excluded. */
export type Audience =
  | { type: "all" }
  | { type: "view"; viewId: string }
  | { type: "filter"; filter: FilterGroup }
  | { type: "tags"; tagIds: string[]; match: "any" | "all" }
  | { type: "event"; eventId: string; statuses: AttendeeStatus[] }
  | { type: "campaign"; campaignId: string }
  | { type: "contacts"; contactIds: string[] };

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------

export type TriggerType =
  | "contact_created"
  | "tag_added"
  | "stage_changed"
  | "lead_potential" // partial form capture (someone typed their email but didn't finish)
  | "event_registered"
  | "event_cancelled"
  | "event_attended"
  | "event_no_show"
  | "meeting_booked"
  | "meeting_cancelled"
  | "meeting_outcome"
  | "email_clicked"
  | "manual";

export type TriggerConfig = {
  tagId?: string | null;
  stage?: string | null;
  eventId?: string | null;
  campaignId?: string | null;
  bookingPageId?: string | null;
  outcome?: MeetingOutcome | null;
};

export type AutomationTrigger = { type: TriggerType; config: TriggerConfig };

/** Context carried by a trigger event and stored on the automation run. */
export type TriggerContext = {
  eventId?: string;
  attendeeId?: string;
  bookingPageId?: string;
  tagId?: string;
  stage?: string;
  outcome?: MeetingOutcome;
  messageId?: string;
  url?: string;
};

export type AutomationStep =
  | { id: string; type: "send_email"; templateId: string }
  | { id: string; type: "wait"; amount: number; unit: "minutes" | "hours" | "days" }
  | { id: string; type: "wait_until_event"; anchor: "start" | "end"; offsetMinutes: number }
  | { id: string; type: "condition"; filter: FilterGroup; attendance?: AttendeeStatus[] }
  | { id: string; type: "add_tag"; tagId: string }
  | { id: string; type: "remove_tag"; tagId: string }
  | { id: string; type: "set_stage"; stage: string }
  | { id: string; type: "create_task"; title: string; dueInDays: number; assigneeId?: string | null }
  | { id: string; type: "notify_team"; message: string; userIds?: string[] }
  | { id: string; type: "webhook"; url: string };

export type AutomationStatus = "draft" | "active" | "paused";
export type AutomationRunStatus = "active" | "waiting" | "completed" | "exited" | "failed" | "cancelled";

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export type CampaignType =
  | "event_series"
  | "webinar"
  | "email"
  | "conference"
  | "outreach"
  | "social"
  | "ads"
  | "other";
export type CampaignStatus = "planned" | "active" | "completed" | "archived";

// ---------------------------------------------------------------------------
// Activities (contact journey timeline)
// ---------------------------------------------------------------------------

export type ActivityType =
  | "note"
  | "call"
  | "contact_created"
  | "contact_updated"
  | "stage_changed"
  | "lead_status_changed"
  | "tag_added"
  | "tag_removed"
  | "email_sent"
  | "email_opened"
  | "email_clicked"
  | "unsubscribed"
  | "event_registered"
  | "event_cancelled"
  | "event_attended"
  | "event_no_show"
  | "rsvp"
  | "meeting_booked"
  | "meeting_cancelled"
  | "meeting_outcome"
  | "form_started"
  | "task_created"
  | "task_completed"
  | "automation";

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export type JobStatus = "pending" | "running" | "done" | "failed" | "cancelled";
