"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, ok, zodFail } from "@/lib/action";
import { changeStage } from "@/lib/contacts";
import { getStages } from "@/lib/settings";

/** Move a contact to another pipeline stage (kanban drag & drop, stage selects). */
export async function changeStageAction(contactId: string, stage: string) {
  const user = await requireUser();
  const parsed = z.object({ contactId: z.uuid(), stage: z.string().min(1).max(60) }).safeParse({ contactId, stage });
  if (!parsed.success) return zodFail(parsed.error);
  const stages = await getStages();
  const target = stages.find((s) => s.key === stage);
  if (!target) return fail("That stage no longer exists");
  const changed = await changeStage(contactId, stage, { actorId: user.id });
  revalidatePath("/pipeline");
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);
  return ok({ changed }, changed ? `Moved to ${target.label}` : undefined);
}
