import { z } from "zod";

// Validation for the booking page editor (shared by the client form and the server actions).

const hex = /^#[0-9a-fA-F]{6}$/;

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** "" / null → null, otherwise a http(s) URL. */
const optionalHttpUrl = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (v ?? "").trim())
  .refine((v) => v === "" || (v.length <= 500 && isHttpUrl(v)), "Enter a full URL starting with https://")
  .transform((v) => v || null);

const optionalText = (max: number) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (v ?? "").trim())
    .refine((v) => v.length <= max, `Keep this under ${max} characters`)
    .transform((v) => v || null);

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const questionSchema = z
  .object({
    id: z.string().min(1).max(60),
    label: z.string().trim().min(1, "Every question needs a label").max(200),
    type: z.enum(["text", "textarea", "select", "multiselect", "number", "date", "url", "checkbox"]),
    required: z.boolean(),
    options: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
    placeholder: z.string().max(200).optional(),
    mapTo: z.string().max(80).nullable().optional(),
  })
  .superRefine((q, ctx) => {
    if ((q.type === "select" || q.type === "multiselect") && !q.options?.length) {
      ctx.addIssue({ code: "custom", path: ["options"], message: `“${q.label}” needs at least one option` });
    }
  });

const ruleValue = z.union([z.string().max(500), z.number(), z.array(z.string().max(500)).max(100), z.null()]).optional();

export const ruleGroupSchema = z.object({
  id: z.string().min(1).max(60),
  combinator: z.enum(["and", "or"]),
  conditions: z
    .array(
      z.object({
        questionId: z.string().min(1).max(60),
        operator: z.enum(["is", "is_not", "includes", "not_includes", "lt", "gt", "is_empty", "is_not_empty"]),
        value: ruleValue,
      }),
    )
    .max(30),
});

const templateId = z.union([z.string().uuid(), z.null()]).optional();

export const notificationsSchema = z.object({
  confirmation: z.object({ enabled: z.boolean(), templateId }),
  cancellation: z.object({ enabled: z.boolean(), templateId }),
  reminders: z
    .array(z.object({ id: z.string().min(1).max(60), minutesBefore: z.number().int().min(1).max(60 * 24 * 60), templateId }))
    .max(10),
  followUps: z
    .array(
      z.object({
        id: z.string().min(1).max(60),
        minutesAfter: z.number().int().min(1).max(60 * 24 * 90),
        audience: z.enum(["attended", "no_show", "all"]),
        templateId,
      }),
    )
    .max(10),
  notifyHost: z.boolean(),
});

export const bookingPageInputSchema = z
  .object({
    title: z.string().trim().min(1, "Give the page a title").max(120, "Keep the title under 120 characters"),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(2, "The link needs at least 2 characters")
      .max(60)
      .regex(SLUG_RE, "Use lowercase letters, numbers and dashes only"),
    description: optionalText(4000),
    durationMinutes: z.number().int().min(5, "At least 5 minutes").max(480, "At most 8 hours"),
    locationType: z.enum(["online", "in_person", "phone"]),
    location: optionalText(300),
    meetingUrl: optionalHttpUrl,
    hostIds: z.array(z.string().uuid()).min(1, "Choose at least one host").max(50),
    bufferBeforeMinutes: z.number().int().min(0).max(240),
    bufferAfterMinutes: z.number().int().min(0).max(240),
    minNoticeMinutes: z.number().int().min(0).max(60 * 24 * 90),
    maxDaysAhead: z.number().int().min(1, "At least 1 day").max(365, "At most 365 days"),
    slotIncrementMinutes: z.number().int().min(5).max(240),
    dailyLimit: z.number().int().min(1).max(100).nullable(),
    questions: z.array(questionSchema).max(30),
    disqualifyRules: z.array(ruleGroupSchema).max(20),
    disqualifyMessage: optionalText(2000),
    disqualifyRedirectUrl: optionalHttpUrl,
    confirmationMessage: optionalText(2000),
    redirectUrl: optionalHttpUrl,
    notifications: notificationsSchema,
    campaignId: z.union([z.string().uuid(), z.null()]),
    color: z.string().regex(hex, "Pick a color"),
    isActive: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const ids = new Set<string>();
    v.questions.forEach((q, i) => {
      if (ids.has(q.id)) ctx.addIssue({ code: "custom", path: ["questions", i, "id"], message: "Duplicate question id" });
      ids.add(q.id);
    });
  });

export type BookingPageInput = z.input<typeof bookingPageInputSchema>;
export type BookingPageParsed = z.output<typeof bookingPageInputSchema>;

/** Drop rule conditions that point at deleted questions (and groups left empty). */
export function pruneRules<T extends { id: string; conditions: { questionId: string }[] }>(rules: T[], questionIds: Iterable<string>): T[] {
  const valid = new Set(questionIds);
  return rules
    .map((g) => ({ ...g, conditions: g.conditions.filter((c) => valid.has(c.questionId)) }))
    .filter((g) => g.conditions.length > 0);
}
