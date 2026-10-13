"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/action";
import { deleteCampaign, saveCampaign } from "@/lib/campaigns";

export async function saveCampaignAction(input: { id?: string | null; values: unknown }): Promise<ActionResult<{ id: string }>> {
  await requireUser();
  if (input.id && !z.uuid().safeParse(input.id).success) return fail("Invalid campaign");
  const res = await saveCampaign({ id: input.id ?? null, values: input.values });
  if (!res.ok) return fail(res.error, res.fieldErrors);
  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${res.campaign.id}`);
  revalidatePath("/events");
  return ok({ id: res.campaign.id }, input.id ? "Campaign saved" : "Campaign created");
}

export async function deleteCampaignAction(id: string): Promise<ActionResult> {
  await requireUser();
  if (!z.uuid().safeParse(id).success) return fail("Invalid campaign");
  if (!(await deleteCampaign(id))) return fail("Campaign not found");
  revalidatePath("/campaigns");
  revalidatePath("/events");
  return ok(undefined, "Campaign deleted");
}
