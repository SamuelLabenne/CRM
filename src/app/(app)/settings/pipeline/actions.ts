"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, zodFail, type ActionResult } from "@/lib/action";
import type { Stage } from "@/lib/types";
import { PipelineError, savePipelineStages } from "../_lib/pipeline";

const schema = z.object({
  stages: z
    .array(
      z.object({
        key: z.string().max(60).nullable().optional(),
        label: z.string(),
        color: z.string(),
        category: z.enum(["active", "won", "lost"]),
      }),
    )
    .max(30),
  moves: z.record(z.string(), z.string()).default({}),
});

export async function savePipelineAction(input: z.input<typeof schema>): Promise<ActionResult<{ stages: Stage[] }>> {
  const user = await requireAdmin();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  try {
    const { stages, moved } = await savePipelineStages({ ...parsed.data, actorId: user.id });
    revalidatePath("/settings/pipeline");
    revalidatePath("/pipeline");
    revalidatePath("/contacts");
    return ok({ stages }, moved ? `Pipeline saved. ${moved} contact${moved === 1 ? "" : "s"} moved.` : "Pipeline saved");
  } catch (err) {
    if (err instanceof PipelineError) return fail(err.message);
    console.error("[settings/pipeline]", err);
    return fail("Could not save the pipeline. Please try again.");
  }
}
