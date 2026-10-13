import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  ActivityType,
  Answers,
  AttendeeStatus,
  Audience,
  AutomationRunStatus,
  AutomationStatus,
  AutomationStep,
  AutomationTrigger,
  BroadcastStatus,
  CampaignStatus,
  CampaignType,
  ContactSource,
  CustomFieldType,
  DateOverride,
  EmailStatus,
  EventKind,
  EventNotifications,
  EventStatus,
  EventType,
  FilterGroup,
  FormQuestion,
  JobStatus,
  LeadStatus,
  LocationType,
  MeetingOutcome,
  MessageKind,
  MessageStatus,
  Rsvp,
  RuleGroup,
  TriggerContext,
  UserRole,
  Utm,
  WeeklyAvailability,
} from "@/lib/types";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const ts = (name: string) => timestamp(name, { withTimezone: true });

// ---------------------------------------------------------------------------
// Users, sessions, invites, settings
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<UserRole>().notNull().default("member"),
  color: text("color").notNull().default("#6366f1"),
  title: text("title"),
  timezone: text("timezone"),
  /** Weekly hours used by booking pages. */
  availability: jsonb("availability").$type<WeeklyAvailability>(),
  dateOverrides: jsonb("date_overrides").$type<DateOverride[]>().notNull().default([]),
  /** Secret token for the personal ICS calendar feed. */
  calendarToken: text("calendar_token").unique(),
  lastLoginAt: ts("last_login_at"),
  deactivatedAt: ts("deactivated_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    /** sha256(token) hex. The raw token only lives in the cookie. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const invites = pgTable("invites", {
  id: id(),
  email: text("email").notNull(),
  role: text("role").$type<UserRole>().notNull().default("member"),
  tokenHash: text("token_hash").notNull().unique(),
  invitedById: uuid("invited_by_id").references(() => users.id, { onDelete: "set null" }),
  expiresAt: ts("expires_at").notNull(),
  acceptedAt: ts("accepted_at"),
  createdAt: createdAt(),
});

/** Key/value workspace settings. Typed access lives in src/lib/settings.ts. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Contacts, tags, custom fields, saved views, activities, tasks
// ---------------------------------------------------------------------------

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    /** Always stored lower-cased & trimmed. */
    email: text("email"),
    phone: text("phone"),
    company: text("company"),
    jobTitle: text("job_title"),
    website: text("website"),
    city: text("city"),
    country: text("country"),
    timezone: text("timezone"),
    /** Key into the configurable pipeline stages (settings "stages"). */
    stage: text("stage").notNull().default("new"),
    leadStatus: text("lead_status").$type<LeadStatus>(),
    initialLeadStatus: text("initial_lead_status").$type<LeadStatus>(),
    leadStatusChangedAt: ts("lead_status_changed_at"),
    source: text("source").$type<ContactSource>().notNull().default("manual"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    /** Potential deal value in whole currency units. */
    dealValue: integer("deal_value"),
    emailStatus: text("email_status").$type<EmailStatus>().notNull().default("subscribed"),
    unsubscribedAt: ts("unsubscribed_at"),
    /** Secret token for unsubscribe / preference links. */
    unsubscribeToken: text("unsubscribe_token")
      .notNull()
      .unique()
      .default(sql`replace(gen_random_uuid()::text, '-', '')`),
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>().notNull().default({}),
    /** First-touch attribution. */
    utm: jsonb("utm").$type<Utm>().notNull().default({}),
    notes: text("notes"),
    lastActivityAt: ts("last_activity_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("contacts_email_uq").on(t.email),
    index("contacts_phone_idx").on(t.phone),
    index("contacts_stage_idx").on(t.stage),
    index("contacts_created_idx").on(t.createdAt),
    index("contacts_owner_idx").on(t.ownerId),
  ],
);

export const tags = pgTable("tags", {
  id: id(),
  name: text("name").notNull().unique(),
  color: text("color").notNull().default("#64748b"),
  createdAt: createdAt(),
});

export const contactTags = pgTable(
  "contact_tags",
  {
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.contactId, t.tagId] }), index("contact_tags_tag_idx").on(t.tagId)],
);

export const customFieldDefs = pgTable("custom_field_defs", {
  id: id(),
  /** snake_case key used in contacts.custom_fields and merge tags ({{contact.custom.<key>}}). */
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  type: text("type").$type<CustomFieldType>().notNull().default("text"),
  options: jsonb("options").$type<string[]>().notNull().default([]),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
});

/** Saved contact filters ("Smart Views" / segments). */
export const savedViews = pgTable("saved_views", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
  filters: jsonb("filters").$type<FilterGroup>().notNull(),
  /** Visible column keys, in order (optional). */
  columns: jsonb("columns").$type<string[]>(),
  visibility: text("visibility").$type<"private" | "shared">().notNull().default("shared"),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Contact journey timeline. Write through src/lib/activity.ts. */
export const activities = pgTable(
  "activities",
  {
    id: id(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    type: text("type").$type<ActivityType>().notNull(),
    title: text("title").notNull(),
    body: text("body"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    eventId: uuid("event_id"),
    createdAt: createdAt(),
  },
  (t) => [index("activities_contact_idx").on(t.contactId, t.createdAt), index("activities_created_idx").on(t.createdAt)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    title: text("title").notNull(),
    description: text("description"),
    dueAt: ts("due_at"),
    completedAt: ts("completed_at"),
    priority: text("priority").$type<"low" | "normal" | "high">().notNull().default("normal"),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tasks_due_idx").on(t.dueAt), index("tasks_assignee_idx").on(t.assigneeId)],
);

// ---------------------------------------------------------------------------
// Campaigns, events, registrations, booking pages
// ---------------------------------------------------------------------------

export const campaigns = pgTable("campaigns", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").$type<CampaignType>().notNull().default("other"),
  status: text("status").$type<CampaignStatus>().notNull().default("planned"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  goal: text("goal"),
  /** Budget in whole currency units. */
  budget: integer("budget"),
  color: text("color").notNull().default("#6366f1"),
  /** Contacts whose first-touch utm.campaign equals this value are attributed to the campaign. */
  utmCampaign: text("utm_campaign"),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const bookingPages = pgTable("booking_pages", {
  id: id(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  durationMinutes: integer("duration_minutes").notNull().default(30),
  locationType: text("location_type").$type<LocationType>().notNull().default("online"),
  location: text("location"),
  meetingUrl: text("meeting_url"),
  /** Users who take these meetings; bookings are distributed round-robin. */
  hostIds: jsonb("host_ids").$type<string[]>().notNull().default([]),
  bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
  bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
  minNoticeMinutes: integer("min_notice_minutes").notNull().default(240),
  maxDaysAhead: integer("max_days_ahead").notNull().default(14),
  slotIncrementMinutes: integer("slot_increment_minutes").notNull().default(30),
  /** Max meetings per host per day (null = unlimited). */
  dailyLimit: integer("daily_limit"),
  questions: jsonb("questions").$type<FormQuestion[]>().notNull().default([]),
  disqualifyRules: jsonb("disqualify_rules").$type<RuleGroup[]>().notNull().default([]),
  disqualifyMessage: text("disqualify_message"),
  disqualifyRedirectUrl: text("disqualify_redirect_url"),
  confirmationMessage: text("confirmation_message"),
  redirectUrl: text("redirect_url"),
  notifications: jsonb("notifications").$type<EventNotifications>().notNull(),
  campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
  color: text("color").notNull().default("#0ea5e9"),
  isActive: boolean("is_active").notNull().default(true),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Anything that happens at a time: group events (webinars, workshops…) with
 * registrations, and 1:1 meetings (kind = "meeting", usually created by a booking page).
 */
export const events = pgTable(
  "events",
  {
    id: id(),
    kind: text("kind").$type<EventKind>().notNull().default("event"),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    bookingPageId: uuid("booking_page_id").references(() => bookingPages.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    /** Public registration page slug (/e/<slug>). Null for meetings. */
    slug: text("slug").unique(),
    description: text("description"),
    type: text("type").$type<EventType>().notNull().default("other"),
    locationType: text("location_type").$type<LocationType>().notNull().default("online"),
    location: text("location"),
    meetingUrl: text("meeting_url"),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    timezone: text("timezone"),
    capacity: integer("capacity"),
    waitlistEnabled: boolean("waitlist_enabled").notNull().default(false),
    status: text("status").$type<EventStatus>().notNull().default("scheduled"),
    /** Public registration page enabled. */
    isPublic: boolean("is_public").notNull().default(false),
    registrationOpen: boolean("registration_open").notNull().default(true),
    registrationQuestions: jsonb("registration_questions").$type<FormQuestion[]>().notNull().default([]),
    notifications: jsonb("notifications").$type<EventNotifications>().notNull(),
    coverImageUrl: text("cover_image_url"),
    color: text("color"),
    hostId: uuid("host_id").references(() => users.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("events_starts_idx").on(t.startsAt),
    index("events_campaign_idx").on(t.campaignId),
    index("events_host_idx").on(t.hostId),
  ],
);

/** Registrations for events, and the invitee of a meeting. */
export const eventAttendees = pgTable(
  "event_attendees",
  {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    status: text("status").$type<AttendeeStatus>().notNull().default("registered"),
    rsvp: text("rsvp").$type<Rsvp>(),
    outcome: text("outcome").$type<MeetingOutcome>(),
    objection: text("objection"),
    outcomeNotes: text("outcome_notes"),
    dealValue: integer("deal_value"),
    answers: jsonb("answers").$type<Answers>().notNull().default({}),
    source: text("source").$type<"manual" | "public" | "import" | "booking" | "api">().notNull().default("manual"),
    /** Secret token for the attendee's manage / RSVP / cancel / ICS links. */
    manageToken: text("manage_token")
      .notNull()
      .unique()
      .default(sql`replace(gen_random_uuid()::text, '-', '')`),
    utm: jsonb("utm").$type<Utm>().notNull().default({}),
    checkedInAt: ts("checked_in_at"),
    cancelledAt: ts("cancelled_at"),
    cancelReason: text("cancel_reason"),
    markedById: uuid("marked_by_id").references(() => users.id, { onDelete: "set null" }),
    registeredAt: ts("registered_at").notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("event_attendees_event_contact_uq").on(t.eventId, t.contactId),
    index("event_attendees_contact_idx").on(t.contactId),
    index("event_attendees_status_idx").on(t.status),
  ],
);

/**
 * Funnel tracking for public forms (iClosed-style "potential" leads): a row is
 * created as soon as a visitor gives their email, and updated as they progress.
 */
export const leadCaptures = pgTable(
  "lead_captures",
  {
    id: id(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"registration" | "booking">().notNull(),
    /** events.id or booking_pages.id */
    targetId: uuid("target_id").notNull(),
    status: text("status").$type<"partial" | "qualified" | "disqualified" | "completed">().notNull().default("partial"),
    answers: jsonb("answers").$type<Answers>().notNull().default({}),
    utm: jsonb("utm").$type<Utm>().notNull().default({}),
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("lead_captures_target_idx").on(t.targetId), index("lead_captures_contact_idx").on(t.contactId)],
);

/** Public page views for funnel analytics. */
export const pageViews = pgTable(
  "page_views",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kind: text("kind").$type<"event" | "booking">().notNull(),
    targetId: uuid("target_id").notNull(),
    /** sha256(ip + user agent + day) – no raw personal data stored. */
    visitorHash: text("visitor_hash").notNull(),
    referrer: text("referrer"),
    utm: jsonb("utm").$type<Utm>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("page_views_target_idx").on(t.targetId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Email: templates, broadcasts, messages, tracking events
// ---------------------------------------------------------------------------

export const emailTemplates = pgTable("email_templates", {
  id: id(),
  name: text("name").notNull(),
  subject: text("subject").notNull().default(""),
  preheader: text("preheader"),
  /** TipTap JSON document (editor source of truth). */
  contentJson: jsonb("content_json").$type<Record<string, unknown>>(),
  /** Rendered HTML body (without the layout wrapper). Contains {{merge.tags}}. */
  contentHtml: text("content_html").notNull().default(""),
  category: text("category").$type<"marketing" | "notification" | "follow_up" | "other">().notNull().default("marketing"),
  /** Built-in templates used by event/booking notifications (e.g. "event_confirmation"). */
  systemKey: text("system_key").unique(),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const broadcasts = pgTable("broadcasts", {
  id: id(),
  name: text("name").notNull(),
  subject: text("subject").notNull().default(""),
  preheader: text("preheader"),
  contentJson: jsonb("content_json").$type<Record<string, unknown>>(),
  contentHtml: text("content_html").notNull().default(""),
  templateId: uuid("template_id").references(() => emailTemplates.id, { onDelete: "set null" }),
  campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
  audience: jsonb("audience").$type<Audience>().notNull().default({ type: "all" }),
  status: text("status").$type<BroadcastStatus>().notNull().default("draft"),
  scheduledAt: ts("scheduled_at"),
  sentAt: ts("sent_at"),
  recipientCount: integer("recipient_count").notNull().default(0),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const automations = pgTable("automations", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").$type<AutomationStatus>().notNull().default("draft"),
  trigger: jsonb("trigger").$type<AutomationTrigger>().notNull(),
  steps: jsonb("steps").$type<AutomationStep[]>().notNull().default([]),
  /** Allow the same contact to be enrolled again while/after a previous run. */
  allowReentry: boolean("allow_reentry").notNull().default(false),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Every email the system sends (or simulates). */
export const messages = pgTable(
  "messages",
  {
    id: id(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    toEmail: text("to_email").notNull(),
    toName: text("to_name"),
    fromEmail: text("from_email").notNull(),
    fromName: text("from_name"),
    replyTo: text("reply_to"),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    text: text("text"),
    kind: text("kind").$type<MessageKind>().notNull().default("transactional"),
    broadcastId: uuid("broadcast_id").references(() => broadcasts.id, { onDelete: "set null" }),
    automationId: uuid("automation_id").references(() => automations.id, { onDelete: "set null" }),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    templateId: uuid("template_id").references(() => emailTemplates.id, { onDelete: "set null" }),
    status: text("status").$type<MessageStatus>().notNull().default("queued"),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    openedAt: ts("opened_at"),
    openCount: integer("open_count").notNull().default(0),
    clickedAt: ts("clicked_at"),
    clickCount: integer("click_count").notNull().default(0),
    sentAt: ts("sent_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("messages_contact_idx").on(t.contactId),
    index("messages_broadcast_idx").on(t.broadcastId),
    index("messages_created_idx").on(t.createdAt),
  ],
);

export const emailEvents = pgTable(
  "email_events",
  {
    id: id(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    type: text("type").$type<"open" | "click" | "unsubscribe" | "bounce" | "complaint">().notNull(),
    url: text("url"),
    createdAt: createdAt(),
  },
  (t) => [index("email_events_message_idx").on(t.messageId)],
);

// ---------------------------------------------------------------------------
// Automations: runs & logs
// ---------------------------------------------------------------------------

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: id(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    context: jsonb("context").$type<TriggerContext>().notNull().default({}),
    status: text("status").$type<AutomationRunStatus>().notNull().default("active"),
    currentStep: integer("current_step").notNull().default(0),
    nextRunAt: ts("next_run_at"),
    lastError: text("last_error"),
    startedAt: ts("started_at").notNull().defaultNow(),
    completedAt: ts("completed_at"),
    updatedAt: updatedAt(),
  },
  (t) => [index("automation_runs_automation_idx").on(t.automationId, t.contactId)],
);

export const automationLogs = pgTable(
  "automation_logs",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => automationRuns.id, { onDelete: "cascade" }),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    stepIndex: integer("step_index"),
    stepType: text("step_type"),
    status: text("status").$type<"ok" | "skipped" | "error" | "exited">().notNull(),
    message: text("message"),
    createdAt: createdAt(),
  },
  (t) => [index("automation_logs_run_idx").on(t.runId), index("automation_logs_automation_idx").on(t.automationId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Background jobs, notifications, webhooks, API keys
// ---------------------------------------------------------------------------

/** Durable job queue. Enqueue via src/lib/jobs/queue.ts; processed by /api/cron. */
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    runAt: ts("run_at").notNull().defaultNow(),
    status: text("status").$type<JobStatus>().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lastError: text("last_error"),
    /** Optional unique key so the same logical job is never scheduled twice. */
    dedupeKey: text("dedupe_key").unique(),
    lockedAt: ts("locked_at"),
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("jobs_due_idx").on(t.status, t.runAt)],
);

/** In-app notifications (bell icon). */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

export const webhooks = pgTable("webhooks", {
  id: id(),
  url: text("url").notNull(),
  /** Event names, e.g. "contact.created", "registration.created". Empty = all. */
  events: jsonb("events").$type<string[]>().notNull().default([]),
  secret: text("secret").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  lastDeliveryAt: ts("last_delivery_at"),
  lastStatus: integer("last_status"),
  createdAt: createdAt(),
});

export const apiKeys = pgTable("api_keys", {
  id: id(),
  name: text("name").notNull(),
  /** sha256 of the full key. */
  keyHash: text("key_hash").notNull().unique(),
  /** First characters, shown in the UI. */
  prefix: text("prefix").notNull(),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type CustomFieldDef = typeof customFieldDefs.$inferSelect;
export type SavedView = typeof savedViews.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type BookingPage = typeof bookingPages.$inferSelect;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type EventAttendee = typeof eventAttendees.$inferSelect;
export type LeadCapture = typeof leadCaptures.$inferSelect;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type Broadcast = typeof broadcasts.$inferSelect;
export type Automation = typeof automations.$inferSelect;
export type AutomationRun = typeof automationRuns.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;

export type { Answers, Audience, AttendeeStatus, EventNotifications };
