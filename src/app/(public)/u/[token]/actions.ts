"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { resubscribeByToken, unsubscribeByToken } from "@/lib/email/tracking";

// Public, token-protected. Form posts only (never GET) so mail scanners can't unsubscribe anyone.

const tokenSchema = z.string().min(8).max(100).regex(/^[a-zA-Z0-9_-]+$/);

export async function unsubscribeAction(token: string) {
  const t = tokenSchema.safeParse(token);
  if (!t.success) redirect("/");
  await unsubscribeByToken(t.data);
  redirect(`/u/${t.data}?done=1`);
}

export async function resubscribeAction(token: string) {
  const t = tokenSchema.safeParse(token);
  if (!t.success) redirect("/");
  await resubscribeByToken(t.data);
  redirect(`/u/${t.data}?resubscribed=1`);
}
