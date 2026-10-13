import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, leadCaptures, pageViews } from "@/lib/db/schema";
import { sha256 } from "@/lib/crypto";
import { setLeadStatus, upsertContact } from "@/lib/contacts";
import { emitTrigger } from "@/lib/automations/triggers";
import { emitWebhook } from "@/lib/webhooks";
import { logActivity } from "@/lib/activity";
import type { Answers, FormQuestion, RuleCondition, RuleGroup, Utm } from "@/lib/types";

// Shared logic for public 2-step forms (event registration & booking pages),
// inspired by iClosed: capture the lead as soon as they give their email.

/** Extract utm_* params from a URLSearchParams-like record. */
export function utmFromParams(params: Record<string, string | string[] | undefined>): Utm {
  const get = (k: string) => {
    const v = params[`utm_${k}`];
    return (Array.isArray(v) ? v[0] : v)?.slice(0, 200) || undefined;
  };
  const utm: Utm = { source: get("source"), medium: get("medium"), campaign: get("campaign"), term: get("term"), content: get("content") };
  return Object.fromEntries(Object.entries(utm).filter(([, v]) => v)) as Utm;
}

/** Record a public page view (privacy-friendly visitor hash). */
export async function recordPageView(input: {
  kind: "event" | "booking";
  targetId: string;
  ip: string | null;
  userAgent: string | null;
  referrer?: string | null;
  utm?: Utm;
}) {
  const day = new Date().toISOString().slice(0, 10);
  await db.insert(pageViews).values({
    kind: input.kind,
    targetId: input.targetId,
    visitorHash: sha256(`${input.ip ?? ""}|${input.userAgent ?? ""}|${day}`),
    referrer: input.referrer?.slice(0, 500) ?? null,
    utm: input.utm ?? {},
  });
}

/**
 * Step 1 of a public form: upsert the contact and start (or resume) a lead capture.
 * Marks the contact as a "potential" lead and fires the lead_potential trigger the first time.
 */
export async function captureLead(input: {
  kind: "registration" | "booking";
  targetId: string;
  firstName?: string | null;
  lastName?: string | null;
  email: string;
  phone?: string | null;
  utm?: Utm;
  /** Human label for the timeline, e.g. the event title. */
  label: string;
}) {
  const { contact } = await upsertContact(
    {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      utm: input.utm,
    },
    { source: input.kind === "booking" ? "booking" : "registration" },
  );
  const [existing] = await db
    .select()
    .from(leadCaptures)
    .where(and(eq(leadCaptures.contactId, contact.id), eq(leadCaptures.targetId, input.targetId)))
    .orderBy(sql`${leadCaptures.createdAt} desc`)
    .limit(1);

  if (existing && existing.status !== "completed") {
    return { contact, capture: existing };
  }
  const [capture] = await db
    .insert(leadCaptures)
    .values({ contactId: contact.id, kind: input.kind, targetId: input.targetId, utm: input.utm ?? {} })
    .returning();
  await setLeadStatus(contact.id, "potential");
  await logActivity({
    contactId: contact.id,
    type: "form_started",
    title: `Started ${input.kind === "booking" ? "booking" : "registration"}: ${input.label}`,
    meta: { captureId: capture.id, targetId: input.targetId },
  });
  await emitTrigger("lead_potential", contact.id, input.kind === "booking" ? { bookingPageId: input.targetId } : { eventId: input.targetId });
  await emitWebhook("lead.potential", { contactId: contact.id, kind: input.kind, targetId: input.targetId, email: contact.email });
  return { contact, capture };
}

export async function updateLeadCapture(
  captureId: string,
  patch: { status?: "partial" | "qualified" | "disqualified" | "completed"; answers?: Answers },
) {
  await db
    .update(leadCaptures)
    .set({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.answers ? { answers: patch.answers } : {}),
      ...(patch.status === "completed" ? { completedAt: new Date() } : {}),
    })
    .where(eq(leadCaptures.id, captureId));
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

/** Validate and normalise answers against questions. Returns errors keyed by question id. */
export function validateAnswers(questions: FormQuestion[], raw: Record<string, unknown>) {
  const answers: Answers = {};
  const errors: Record<string, string> = {};
  for (const q of questions) {
    const v = raw[q.id];
    let value: Answers[string] = null;
    if (q.type === "multiselect") {
      const arr = (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]).map(String).filter(Boolean);
      value = q.options?.length ? arr.filter((a) => q.options!.includes(a)) : arr;
      if (q.required && !(value as string[]).length) errors[q.id] = "Please choose at least one option";
    } else if (q.type === "checkbox") {
      value = v === true || v === "on" || v === "true";
      if (q.required && !value) errors[q.id] = "This is required";
    } else if (q.type === "number") {
      const s = String(v ?? "").trim();
      value = s === "" ? null : Number(s);
      if (value !== null && Number.isNaN(value)) errors[q.id] = "Enter a number";
      if (q.required && value === null) errors[q.id] = "This is required";
    } else {
      const s = String(v ?? "").trim().slice(0, 2000);
      value = s || null;
      if (q.type === "select" && value && q.options?.length && !q.options.includes(value)) errors[q.id] = "Choose a valid option";
      if (q.type === "url" && value && !/^https?:\/\//i.test(value)) errors[q.id] = "Enter a URL starting with http(s)://";
      if (q.required && !value) errors[q.id] = "This is required";
    }
    answers[q.id] = value;
  }
  return { answers, errors, valid: Object.keys(errors).length === 0 };
}

const CONTACT_FIELDS = new Set(["company", "job_title", "phone", "website", "city", "country"]);
const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Copy answers onto the contact according to each question's `mapTo` (only fills blanks). */
export async function applyAnswerMappings(contactId: string, questions: FormQuestion[], answers: Answers) {
  const [c] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!c) return;
  const patch: Record<string, unknown> = {};
  const custom = { ...c.customFields };
  let customChanged = false;
  for (const q of questions) {
    const v = answers[q.id];
    if (!q.mapTo || v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    if (q.mapTo.startsWith("custom:")) {
      custom[q.mapTo.slice(7)] = v;
      customChanged = true;
    } else if (CONTACT_FIELDS.has(q.mapTo)) {
      const key = toCamel(q.mapTo) as keyof typeof c;
      if (!c[key]) patch[key] = Array.isArray(v) ? v.join(", ") : String(v);
    }
  }
  if (customChanged) patch.customFields = custom;
  if (Object.keys(patch).length) await db.update(contacts).set(patch).where(eq(contacts.id, contactId));
}

// ---------------------------------------------------------------------------
// Qualification rules
// ---------------------------------------------------------------------------

function conditionMatches(c: RuleCondition, answers: Answers): boolean {
  const a = answers[c.questionId];
  const list = Array.isArray(a) ? a.map(String) : a == null || a === "" ? [] : [String(a)];
  const target = Array.isArray(c.value) ? c.value.map(String) : c.value == null ? [] : [String(c.value)];
  switch (c.operator) {
    case "is":
      return list.length > 0 && target.some((t) => list.includes(t));
    case "is_not":
      return !target.some((t) => list.includes(t));
    case "includes":
      return target.some((t) => list.some((x) => x.toLowerCase().includes(t.toLowerCase())));
    case "not_includes":
      return !target.some((t) => list.some((x) => x.toLowerCase().includes(t.toLowerCase())));
    case "lt":
      return list.length > 0 && Number(list[0]) < Number(target[0]);
    case "gt":
      return list.length > 0 && Number(list[0]) > Number(target[0]);
    case "is_empty":
      return list.length === 0;
    case "is_not_empty":
      return list.length > 0;
  }
}

/** True if any rule group matches (groups are OR'ed; conditions use the group's combinator). */
export function isDisqualified(rules: RuleGroup[], answers: Answers): { disqualified: boolean; groupId?: string } {
  for (const g of rules) {
    if (!g.conditions.length) continue;
    const results = g.conditions.map((c) => conditionMatches(c, answers));
    const hit = g.combinator === "or" ? results.some(Boolean) : results.every(Boolean);
    if (hit) return { disqualified: true, groupId: g.id };
  }
  return { disqualified: false };
}
