import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { automations, emailTemplates, type Automation } from "@/lib/db/schema";
import { ensureTag } from "@/lib/contacts";
import type { AutomationStep, AutomationTrigger } from "@/lib/types";

// "Start from a recipe": ready-made automations. Creating one inserts the automation as a DRAFT
// plus any email templates it needs (category "follow_up", editable in /emails/templates).

export type RecipeId =
  | "event-reminders"
  | "no-show-recovery"
  | "welcome-series"
  | "abandoned-registration"
  | "meeting-no-show"
  | "hot-lead-alert";

type TemplateDef = { key: string; name: string; subject: string; preheader?: string; html: string };
type BuildCtx = { templates: Record<string, string>; hotTagId?: string };

export type Recipe = {
  id: RecipeId;
  name: string;
  description: string;
  /** Plain-English outline shown on the recipe card. */
  outline: string[];
  triggerSummary: string;
  templates: TemplateDef[];
  allowReentry: boolean;
  build: (ctx: BuildCtx) => { trigger: AutomationTrigger; steps: AutomationStep[] };
};

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;
const step = (s: WithoutId<AutomationStep>): AutomationStep => ({ id: nanoid(8), ...s }) as AutomationStep;

const NO_FILTER = { match: "all" as const, filters: [] };
const when = `<p><strong>When:</strong> {{event.date}}, {{event.time}} – {{event.end_time}}<br><strong>Where:</strong> {{event.location}}</p>`;

export const RECIPES: Recipe[] = [
  {
    id: "event-reminders",
    name: "Event reminder & follow-up",
    description: "Remind registrants the day before, then thank the people who showed up.",
    triggerSummary: "When a contact registers for an event",
    outline: [
      "Wait until 1 day before the event starts",
      "Email a reminder",
      "Wait until 2 hours after the event ends",
      "Only continue if they attended",
      "Email a thank-you",
    ],
    allowReentry: true,
    templates: [
      {
        key: "reminder",
        name: "Event reminder (1 day before)",
        subject: "Tomorrow: {{event.title}}",
        preheader: "{{event.date}} at {{event.time}}",
        html: `<h1>See you tomorrow, {{contact.first_name | "there"}}!</h1>
<p>Just a quick reminder that <strong>{{event.title}}</strong> is happening tomorrow.</p>
${when}
<p><a data-button href="{{attendee.manage_url}}">View details &amp; join link</a></p>
<p>Can't make it? <a href="{{attendee.cancel_url}}">Let us know</a> so we can free up your spot.</p>`,
      },
      {
        key: "thanks",
        name: "Event follow-up (thanks for attending)",
        subject: "Thanks for joining {{event.title}}",
        html: `<h1>Thanks for joining us, {{contact.first_name | "there"}}!</h1>
<p>It was great to have you at <strong>{{event.title}}</strong>. We hope you found it useful.</p>
<p>If you have questions or want to talk through next steps, just reply to this email – we'd love to hear from you.</p>
<p>– {{event.host_name}}</p>`,
      },
    ],
    build: ({ templates }) => ({
      trigger: { type: "event_registered", config: {} },
      steps: [
        step({ type: "wait_until_event", anchor: "start", offsetMinutes: -24 * 60 }),
        step({ type: "send_email", templateId: templates.reminder }),
        step({ type: "wait_until_event", anchor: "end", offsetMinutes: 120 }),
        step({ type: "condition", filter: NO_FILTER, attendance: ["attended"] }),
        step({ type: "send_email", templateId: templates.thanks }),
      ],
    }),
  },
  {
    id: "no-show-recovery",
    name: "No-show recovery",
    description: "Reach out to people who missed an event and create a task to follow up personally.",
    triggerSummary: "When a contact is a no-show for an event",
    outline: ["Email “sorry we missed you”", "Wait 2 days", "Create a follow-up task for the contact owner"],
    allowReentry: true,
    templates: [
      {
        key: "missed",
        name: "No-show: sorry we missed you",
        subject: "Sorry we missed you at {{event.title}}",
        html: `<h1>We missed you, {{contact.first_name | "there"}}</h1>
<p>We noticed you couldn't make it to <strong>{{event.title}}</strong>. No worries – life happens!</p>
<p>Reply to this email and we'll help you catch up or find another time that works.</p>`,
      },
    ],
    build: ({ templates }) => ({
      trigger: { type: "event_no_show", config: {} },
      steps: [
        step({ type: "send_email", templateId: templates.missed }),
        step({ type: "wait", amount: 2, unit: "days" }),
        step({
          type: "create_task",
          title: "Follow up with {{contact.full_name}} – missed {{event.title}}",
          dueInDays: 0,
          assigneeId: null,
        }),
      ],
    }),
  },
  {
    id: "welcome-series",
    name: "Welcome series",
    description: "Greet every new contact and follow up two days later.",
    triggerSummary: "When a contact is created",
    outline: ["Email a welcome message", "Wait 2 days", "Email a follow-up"],
    allowReentry: false,
    templates: [
      {
        key: "welcome",
        name: "Welcome series · 1. Welcome",
        subject: "Welcome to {{workspace.name}}, {{contact.first_name | \"there\"}}!",
        html: `<h1>Welcome, {{contact.first_name | "there"}}!</h1>
<p>Thanks for connecting with {{workspace.name}}. We'll keep you posted about upcoming events and ways to get involved.</p>
<p>Have a question? Just reply to this email – a real person will get back to you.</p>`,
      },
      {
        key: "followup",
        name: "Welcome series · 2. Follow-up",
        subject: "Getting the most out of {{workspace.name}}",
        html: `<h1>Hi {{contact.first_name | "there"}},</h1>
<p>A couple of days ago we said hello – here's how to make the most of {{workspace.name}}:</p>
<ul><li>Keep an eye on your inbox for upcoming events and sessions</li><li>Reply to any email with questions – we read every one</li></ul>
<p>Talk soon!</p>`,
      },
    ],
    build: ({ templates }) => ({
      trigger: { type: "contact_created", config: {} },
      steps: [
        step({ type: "send_email", templateId: templates.welcome }),
        step({ type: "wait", amount: 2, unit: "days" }),
        step({ type: "send_email", templateId: templates.followup }),
      ],
    }),
  },
  {
    id: "abandoned-registration",
    name: "Abandoned registration",
    description: "Nudge people who entered their email on a form but never finished.",
    triggerSummary: "When someone starts a form but doesn't finish",
    outline: [
      "Wait 1 hour",
      "Only continue if they're still a potential lead",
      "Email “finish your registration”",
    ],
    allowReentry: true,
    templates: [
      {
        key: "nudge",
        name: "Abandoned registration: finish signing up",
        subject: "Finish your registration, {{contact.first_name | \"there\"}}",
        html: `<h1>You're almost there!</h1>
<p>Hi {{contact.first_name | "there"}}, it looks like you started signing up but didn't quite finish.</p>
<p>Head back to the page you were on to complete your registration – it only takes a minute. Or simply reply to this email and we'll take care of it for you.</p>`,
      },
    ],
    build: ({ templates }) => ({
      trigger: { type: "lead_potential", config: {} },
      steps: [
        step({ type: "wait", amount: 1, unit: "hours" }),
        step({
          type: "condition",
          filter: { match: "all", filters: [{ field: "lead_status", operator: "is", value: "potential" }] },
        }),
        step({ type: "send_email", templateId: templates.nudge }),
      ],
    }),
  },
  {
    id: "meeting-no-show",
    name: "Meeting no-show follow-up",
    description: "When a booked meeting is logged as a no-show, send a friendly link to rebook.",
    triggerSummary: "When a meeting outcome is logged as “No-show”",
    outline: ["Email with a link to pick a new time"],
    allowReentry: true,
    templates: [
      {
        key: "rebook",
        name: "Meeting no-show: let's reschedule",
        subject: "Sorry we missed you – let's find a new time",
        html: `<p>Hi {{contact.first_name | "there"}},</p>
<p>We had you down for <strong>{{event.title}}</strong> on {{event.date}}, but it looks like we missed each other.</p>
<p>No problem – you can pick a new time that suits you:</p>
<p><a data-button href="{{attendee.manage_url}}">Choose a new time</a></p>
<p>Talk soon,<br>{{event.host_name}}</p>`,
      },
    ],
    build: ({ templates }) => ({
      trigger: { type: "meeting_outcome", config: { outcome: "no_show" } },
      steps: [step({ type: "send_email", templateId: templates.rebook })],
    }),
  },
  {
    id: "hot-lead-alert",
    name: "Hot lead alert",
    description: "Tell your team the moment someone clicks a link in your emails, and tag them as hot.",
    triggerSummary: "When a contact clicks a link in an email",
    outline: ["Notify your team", "Add the tag “Hot lead”"],
    allowReentry: false,
    templates: [],
    build: ({ hotTagId }) => ({
      trigger: { type: "email_clicked", config: {} },
      steps: [
        step({ type: "notify_team", message: "{{contact.full_name}} clicked a link in an email – hot lead!", userIds: [] }),
        step({ type: "add_tag", tagId: hotTagId ?? "" }),
      ],
    }),
  },
];

export function getRecipe(id: string): Recipe | undefined {
  return RECIPES.find((r) => r.id === id);
}

/** Create a draft automation (and its email templates) from a recipe. */
export async function createAutomationFromRecipe(recipeId: string, opts: { userId?: string | null } = {}): Promise<Automation> {
  const recipe = getRecipe(recipeId);
  if (!recipe) throw new Error("Unknown recipe");
  return db.transaction(async (tx) => {
    const templates: Record<string, string> = {};
    for (const t of recipe.templates) {
      const [row] = await tx
        .insert(emailTemplates)
        .values({
          name: t.name,
          subject: t.subject,
          preheader: t.preheader ?? null,
          contentHtml: t.html,
          category: "follow_up",
          createdById: opts.userId ?? null,
        })
        .returning({ id: emailTemplates.id });
      templates[t.key] = row.id;
    }
    const hotTag = recipe.id === "hot-lead-alert" ? await ensureTag("Hot lead", "#ef4444", tx) : null;
    const { trigger, steps } = recipe.build({ templates, hotTagId: hotTag?.id });
    const [automation] = await tx
      .insert(automations)
      .values({
        name: recipe.name,
        description: recipe.description,
        status: "draft",
        trigger,
        steps,
        allowReentry: recipe.allowReentry,
        createdById: opts.userId ?? null,
      })
      .returning();
    return automation;
  });
}

export async function createBlankAutomation(opts: { userId?: string | null } = {}): Promise<Automation> {
  const [automation] = await db
    .insert(automations)
    .values({
      name: "Untitled automation",
      status: "draft",
      trigger: { type: "contact_created", config: {} },
      steps: [],
      allowReentry: false,
      createdById: opts.userId ?? null,
    })
    .returning();
  return automation;
}
