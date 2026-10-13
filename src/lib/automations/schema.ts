// zod schemas for saving automations. These are intentionally lenient (drafts may have
// incomplete steps such as a send_email step without a template yet); strict checks
// for activation live in meta.ts → validateAutomation and service.ts → validateReferences.

import { z } from "zod";
import { TRIGGER_TYPES } from "./meta";
import type { AutomationStep, AutomationTrigger, TriggerType } from "@/lib/types";

const OPERATORS = [
  "is",
  "is_not",
  "contains",
  "not_contains",
  "is_empty",
  "is_not_empty",
  "gt",
  "lt",
  "before",
  "after",
  "in_last_days",
  "has",
  "has_not",
] as const;

const ATTENDEE_STATUSES = ["registered", "confirmed", "waitlisted", "attended", "no_show", "cancelled"] as const;
const OUTCOMES = ["won", "lost", "follow_up", "not_qualified", "no_show", "cancelled"] as const;

const id = z.string().min(1).max(40);
const optionalId = z.string().max(64).nullish().transform((v) => v || null);

export const triggerSchema = z.object({
  type: z.enum(TRIGGER_TYPES as [TriggerType, ...TriggerType[]]),
  config: z
    .object({
      tagId: optionalId,
      stage: z.string().max(80).nullish().transform((v) => v || null),
      eventId: optionalId,
      campaignId: optionalId,
      bookingPageId: optionalId,
      outcome: z.enum(OUTCOMES).nullish().transform((v) => v || null),
    })
    .partial()
    .default({}),
});

const filterSchema = z.object({
  field: z.string().max(80),
  operator: z.enum(OPERATORS),
  value: z.union([z.string().max(500), z.number(), z.array(z.string().max(200)).max(50), z.null()]).optional(),
});

export const stepSchema = z.discriminatedUnion("type", [
  z.object({ id, type: z.literal("send_email"), templateId: z.string().max(64) }),
  z.object({
    id,
    type: z.literal("wait"),
    amount: z.number().int().min(0).max(100_000),
    unit: z.enum(["minutes", "hours", "days"]),
  }),
  z.object({
    id,
    type: z.literal("wait_until_event"),
    anchor: z.enum(["start", "end"]),
    offsetMinutes: z.number().int().min(-525_600).max(525_600),
  }),
  z.object({
    id,
    type: z.literal("condition"),
    filter: z.object({ match: z.enum(["all", "any"]), filters: z.array(filterSchema).max(25) }),
    attendance: z.array(z.enum(ATTENDEE_STATUSES)).max(6).optional(),
  }),
  z.object({ id, type: z.literal("add_tag"), tagId: z.string().max(64) }),
  z.object({ id, type: z.literal("remove_tag"), tagId: z.string().max(64) }),
  z.object({ id, type: z.literal("set_stage"), stage: z.string().max(80) }),
  z.object({
    id,
    type: z.literal("create_task"),
    title: z.string().max(300),
    dueInDays: z.number().int().min(0).max(3650),
    assigneeId: optionalId.optional(),
  }),
  z.object({
    id,
    type: z.literal("notify_team"),
    message: z.string().max(500),
    userIds: z.array(z.string().max(64)).max(100).optional(),
  }),
  z.object({
    id,
    type: z.literal("webhook"),
    url: z.string().max(2000).refine((v) => v === "" || /^https?:\/\//i.test(v.trim()), "Webhook URLs must start with http:// or https://"),
  }),
]);

export const automationInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Give the automation a name").max(120),
  description: z.string().trim().max(500).nullish().transform((v) => v || null),
  status: z.enum(["draft", "active", "paused"]),
  allowReentry: z.boolean(),
  trigger: triggerSchema,
  steps: z.array(stepSchema).max(40, "An automation can have at most 40 steps"),
});

export type AutomationInput = z.infer<typeof automationInputSchema>;

/** Typed helpers (zod's inferred output has nullable config values; the DB type uses optional). */
export function toTrigger(t: AutomationInput["trigger"]): AutomationTrigger {
  return { type: t.type, config: t.config as AutomationTrigger["config"] };
}
export function toSteps(s: AutomationInput["steps"]): AutomationStep[] {
  return s as AutomationStep[];
}
