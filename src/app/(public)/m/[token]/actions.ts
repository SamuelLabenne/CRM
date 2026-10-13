"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { cancelByToken, rsvpByToken, type SelfServiceResult } from "@/lib/events/public";
import { kickJobs } from "@/lib/jobs/kick";

// Public (token-protected) self-service actions for /m/[token].

const tokenSchema = z.string().min(16).max(64);

export async function rsvpAction(token: string, rsvp: string): Promise<SelfServiceResult> {
  const t = tokenSchema.safeParse(token);
  const r = z.enum(["yes", "no", "maybe"]).safeParse(rsvp);
  if (!t.success || !r.success) return { ok: false, error: "This link is not valid." };
  const res = await rsvpByToken(t.data, r.data);
  if (res.ok) {
    if (res.cancelled) kickJobs(); // cancellation email
    revalidatePath(`/m/${t.data}`);
  }
  return res;
}

export async function cancelAction(token: string, reason?: string): Promise<SelfServiceResult> {
  const t = tokenSchema.safeParse(token);
  if (!t.success) return { ok: false, error: "This link is not valid." };
  const res = await cancelByToken(t.data, typeof reason === "string" ? reason : null);
  if (res.ok) {
    kickJobs();
    revalidatePath(`/m/${t.data}`);
  }
  return res;
}
