import { z } from "zod";

// Shared zod schemas for the email module (server actions + tests).

const FILTER_OPERATORS = [
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

const uuid = z.string().uuid("Invalid id");

export const contactFilterSchema = z.object({
  field: z.string().min(1).max(100),
  operator: z.enum(FILTER_OPERATORS),
  value: z.union([z.string().max(500), z.number(), z.array(z.string().max(100)).max(200), z.null()]).optional(),
});

export const audienceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all") }),
  z.object({ type: z.literal("view"), viewId: uuid }),
  z.object({
    type: z.literal("filter"),
    filter: z.object({ match: z.enum(["all", "any"]), filters: z.array(contactFilterSchema).max(25) }),
  }),
  z.object({ type: z.literal("tags"), tagIds: z.array(uuid).max(100), match: z.enum(["any", "all"]) }),
  z.object({ type: z.literal("event"), eventId: uuid, statuses: z.array(z.enum(ATTENDEE_STATUSES)).max(6) }),
  z.object({ type: z.literal("campaign"), campaignId: uuid }),
  z.object({ type: z.literal("contacts"), contactIds: z.array(uuid).max(5000) }),
]);

const jsonDoc = z.record(z.string(), z.unknown()).nullable();

export const TEMPLATE_CATEGORIES = ["marketing", "notification", "follow_up", "other"] as const;

export const templateInputSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1, "Give the template a name").max(120, "Name is too long"),
  subject: z.string().trim().max(300, "Subject is too long").default(""),
  preheader: z.string().trim().max(300, "Preheader is too long").nullable().optional(),
  category: z.enum(TEMPLATE_CATEGORIES).default("marketing"),
  contentJson: jsonDoc.optional(),
  contentHtml: z.string().max(500_000, "The email is too large").default(""),
});
export type TemplateInput = z.infer<typeof templateInputSchema>;

export const broadcastInputSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1, "Give the broadcast a name").max(120, "Name is too long"),
  campaignId: uuid.nullable().optional(),
  templateId: uuid.nullable().optional(),
  audience: audienceSchema,
  subject: z.string().trim().max(300, "Subject is too long").default(""),
  preheader: z.string().trim().max(300, "Preheader is too long").nullable().optional(),
  contentJson: jsonDoc.optional(),
  contentHtml: z.string().max(500_000, "The email is too large").default(""),
});
export type BroadcastInput = z.infer<typeof broadcastInputSchema>;

export const testEmailSchema = z.object({
  subject: z.string().max(300).default(""),
  preheader: z.string().max(300).nullable().optional(),
  html: z.string().max(500_000),
  contactId: uuid.nullable().optional(),
  /** Mirror a marketing send (adds the unsubscribe footer). */
  marketing: z.boolean().optional(),
});

export const OUTBOX_KINDS = ["broadcast", "automation", "notification", "transactional", "test", "manual"] as const;
export const OUTBOX_STATUSES = ["queued", "sent", "simulated", "failed", "bounced"] as const;
