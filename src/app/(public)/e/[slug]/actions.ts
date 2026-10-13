"use server";

import { z } from "zod";
import { captureStep, registerPublic, type CaptureStepResult, type RegisterPublicResult } from "@/lib/events/public";
import { kickJobs } from "@/lib/jobs/kick";

// Public server actions (no auth by design). Everything is validated inside src/lib/events/public.ts.

const utmSchema = z
  .object({
    source: z.string().max(200).optional(),
    medium: z.string().max(200).optional(),
    campaign: z.string().max(200).optional(),
    term: z.string().max(200).optional(),
    content: z.string().max(200).optional(),
  })
  .optional()
  .catch(undefined);

const slugSchema = z.string().max(80);

export async function captureStepAction(input: {
  slug: string;
  firstName: string;
  lastName?: string;
  email: string;
  phone?: string;
  website?: string;
  utm?: unknown;
}): Promise<CaptureStepResult> {
  const slug = slugSchema.safeParse(input?.slug);
  if (!slug.success) return { ok: false, error: "This event is no longer available." };
  const res = await captureStep({
    slug: slug.data,
    firstName: String(input.firstName ?? ""),
    lastName: input.lastName == null ? undefined : String(input.lastName),
    email: String(input.email ?? ""),
    phone: input.phone == null ? undefined : String(input.phone),
    website: input.website == null ? undefined : String(input.website),
    utm: utmSchema.parse(input.utm),
  });
  if (res.ok) kickJobs(); // lead_potential triggers & the confirmation resend go out right away
  return res;
}

export async function registerAction(input: {
  slug: string;
  captureId: string;
  answers: Record<string, unknown>;
  website?: string;
  utm?: unknown;
}): Promise<RegisterPublicResult> {
  const slug = slugSchema.safeParse(input?.slug);
  if (!slug.success) return { ok: false, error: "This event is no longer available.", code: "closed" };
  const res = await registerPublic({
    slug: slug.data,
    captureId: String(input.captureId ?? ""),
    answers: input.answers && typeof input.answers === "object" ? input.answers : {},
    website: input.website == null ? undefined : String(input.website),
    utm: utmSchema.parse(input.utm),
  });
  if (res.ok) kickJobs(); // confirmation email immediately
  return res;
}
