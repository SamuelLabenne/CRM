import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailTemplates, type EmailTemplate } from "@/lib/db/schema";

export type SystemTemplateKey =
  | "event_confirmation"
  | "event_waitlisted"
  | "event_reminder"
  | "event_cancellation"
  | "event_follow_up_attended"
  | "event_follow_up_no_show"
  | "meeting_confirmation"
  | "meeting_reminder"
  | "meeting_cancellation"
  | "meeting_follow_up"
  | "host_new_registration";

type Def = { name: string; subject: string; preheader?: string; html: string };

const rsvpLine = `<p>Will you be there? <a href="{{attendee.rsvp_yes_url}}">Yes, I'll be there</a> · <a href="{{attendee.rsvp_no_url}}">No, I can't make it</a></p>`;
const whenWhere = `<p><strong>When:</strong> {{event.date}}, {{event.time}} – {{event.end_time}}<br><strong>Where:</strong> {{event.location}}</p>`;

export const SYSTEM_TEMPLATES: Record<SystemTemplateKey, Def> = {
  event_confirmation: {
    name: "Event · Registration confirmed",
    subject: "You're registered: {{event.title}}",
    preheader: "{{event.date}} at {{event.time}}",
    html: `<h1>You're in, {{contact.first_name | "there"}}!</h1>
<p>Thanks for registering for <strong>{{event.title}}</strong>. Here are the details:</p>
${whenWhere}
<p><a data-button href="{{attendee.calendar_url}}">Add to my calendar</a></p>
${rsvpLine}
<p>Plans changed? You can <a href="{{attendee.manage_url}}">manage your registration</a> at any time.</p>`,
  },
  event_waitlisted: {
    name: "Event · Added to waitlist",
    subject: "You're on the waitlist for {{event.title}}",
    html: `<h1>You're on the waitlist</h1>
<p>Hi {{contact.first_name | "there"}}, <strong>{{event.title}}</strong> is currently full, so we've added you to the waitlist. We'll email you as soon as a spot opens up.</p>
${whenWhere}
<p><a href="{{attendee.manage_url}}">Manage your registration</a></p>`,
  },
  event_reminder: {
    name: "Event · Reminder",
    subject: "Reminder: {{event.title}} is coming up",
    preheader: "{{event.date}} at {{event.time}}",
    html: `<h1>See you soon, {{contact.first_name | "there"}}</h1>
<p>This is a friendly reminder that <strong>{{event.title}}</strong> is coming up.</p>
${whenWhere}
<p><a data-button href="{{attendee.manage_url}}">View details & join link</a></p>
${rsvpLine}`,
  },
  event_cancellation: {
    name: "Event · Registration cancelled",
    subject: "Cancelled: {{event.title}}",
    html: `<h1>Your registration is cancelled</h1>
<p>Hi {{contact.first_name | "there"}}, your registration for <strong>{{event.title}}</strong> on {{event.date}} has been cancelled.</p>
<p>If this was a mistake, just reply to this email and we'll sort it out.</p>`,
  },
  event_follow_up_attended: {
    name: "Event · Thanks for attending",
    subject: "Thanks for joining {{event.title}}",
    html: `<h1>Thanks for joining us!</h1>
<p>Hi {{contact.first_name | "there"}}, it was great to have you at <strong>{{event.title}}</strong>.</p>
<p>We'd love to hear what you thought – just hit reply and let us know.</p>`,
  },
  event_follow_up_no_show: {
    name: "Event · Sorry we missed you",
    subject: "Sorry we missed you at {{event.title}}",
    html: `<h1>We missed you</h1>
<p>Hi {{contact.first_name | "there"}}, we noticed you couldn't make it to <strong>{{event.title}}</strong>. No worries – life happens.</p>
<p>Reply to this email and we'll help you catch up or find another time that works.</p>`,
  },
  meeting_confirmation: {
    name: "Meeting · Booking confirmed",
    subject: "Confirmed: {{event.title}} with {{event.host_name}}",
    preheader: "{{event.date}} at {{event.time}}",
    html: `<h1>Your meeting is booked</h1>
<p>Hi {{contact.first_name | "there"}}, you're confirmed for <strong>{{event.title}}</strong> with {{event.host_name}}.</p>
${whenWhere}
<p><a data-button href="{{attendee.calendar_url}}">Add to my calendar</a></p>
${rsvpLine}
<p>Need to reschedule or cancel? <a href="{{attendee.manage_url}}">Manage your booking</a>.</p>`,
  },
  meeting_reminder: {
    name: "Meeting · Reminder",
    subject: "Reminder: {{event.title}} at {{event.time}}",
    html: `<h1>Your meeting is coming up</h1>
<p>Hi {{contact.first_name | "there"}}, just a reminder about <strong>{{event.title}}</strong> with {{event.host_name}}.</p>
${whenWhere}
<p><a data-button href="{{attendee.manage_url}}">View details & join link</a></p>
${rsvpLine}`,
  },
  meeting_cancellation: {
    name: "Meeting · Cancelled",
    subject: "Cancelled: {{event.title}}",
    html: `<h1>Your meeting was cancelled</h1>
<p>Hi {{contact.first_name | "there"}}, your meeting <strong>{{event.title}}</strong> on {{event.date}} at {{event.time}} has been cancelled.</p>
<p>Reply to this email if you'd like to find a new time.</p>`,
  },
  meeting_follow_up: {
    name: "Meeting · Follow-up",
    subject: "Great speaking with you, {{contact.first_name | \"there\"}}",
    html: `<p>Hi {{contact.first_name | "there"}},</p>
<p>Thanks for your time today. As promised, here's a quick recap and next steps – reply to this email with any questions.</p>
<p>Talk soon,<br>{{event.host_name}}</p>`,
  },
  host_new_registration: {
    name: "Internal · New registration",
    subject: "New registration: {{contact.full_name}} for {{event.title}}",
    html: `<p><strong>{{contact.full_name}}</strong> ({{contact.email}}) just signed up for <strong>{{event.title}}</strong>.</p>
${whenWhere}`,
  },
};

/** Insert any missing built-in templates. Idempotent. */
export async function ensureSystemTemplates() {
  const keys = Object.keys(SYSTEM_TEMPLATES) as SystemTemplateKey[];
  const existing = await db
    .select({ key: emailTemplates.systemKey })
    .from(emailTemplates)
    .where(inArray(emailTemplates.systemKey, keys));
  const have = new Set(existing.map((e) => e.key));
  const missing = keys.filter((k) => !have.has(k));
  if (!missing.length) return;
  await db
    .insert(emailTemplates)
    .values(
      missing.map((k) => ({
        name: SYSTEM_TEMPLATES[k].name,
        subject: SYSTEM_TEMPLATES[k].subject,
        preheader: SYSTEM_TEMPLATES[k].preheader ?? null,
        contentHtml: SYSTEM_TEMPLATES[k].html,
        category: (k === "host_new_registration" ? "other" : "notification") as EmailTemplate["category"],
        systemKey: k,
      })),
    )
    .onConflictDoNothing();
}

/** Load a template by id, falling back to the (editable) system template with `key`. */
export async function getTemplateOrSystem(templateId: string | null | undefined, key: SystemTemplateKey) {
  if (templateId) {
    const [t] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, templateId));
    if (t) return t;
  }
  const [sys] = await db.select().from(emailTemplates).where(eq(emailTemplates.systemKey, key));
  if (sys) return sys;
  const def = SYSTEM_TEMPLATES[key];
  return {
    id: null,
    name: def.name,
    subject: def.subject,
    preheader: def.preheader ?? null,
    contentHtml: def.html,
  } as Pick<EmailTemplate, "name" | "subject" | "preheader" | "contentHtml"> & { id: string | null };
}
