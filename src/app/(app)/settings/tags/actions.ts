"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, zodFail, type ActionResult } from "@/lib/action";
import { TagError, createTag, deleteTag, mergeTags, updateTag } from "../_lib/tags";
import { hexColor, uuid } from "../_lib/schemas";

const tagSchema = z.object({
  name: z.string().trim().min(1, "Give the tag a name").max(40, "Keep it under 40 characters"),
  color: hexColor,
});

async function guard(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    const res = await fn();
    if (res.ok) {
      revalidatePath("/settings/tags");
      revalidatePath("/contacts", "layout");
    }
    return res;
  } catch (err) {
    if (err instanceof TagError) return fail(err.message);
    console.error("[settings/tags]", err);
    return fail("Something went wrong. Please try again.");
  }
}

export async function createTagAction(input: z.input<typeof tagSchema>): Promise<ActionResult> {
  await requireAdmin();
  const parsed = tagSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  return guard(async () => {
    const tag = await createTag(parsed.data);
    return ok(undefined, `Tag “${tag.name}” created`);
  });
}

export async function updateTagAction(input: z.input<typeof tagSchema> & { id: string }): Promise<ActionResult> {
  await requireAdmin();
  const parsed = tagSchema.extend({ id: uuid }).safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  return guard(async () => {
    await updateTag(parsed.data.id, parsed.data);
    return ok(undefined, "Tag updated");
  });
}

export async function deleteTagAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return fail("Invalid tag");
  return guard(async () => {
    await deleteTag(parsed.data);
    return ok(undefined, "Tag deleted");
  });
}

export async function mergeTagsAction(input: { sourceId: string; targetId: string }): Promise<ActionResult> {
  await requireAdmin();
  const parsed = z.object({ sourceId: uuid, targetId: uuid }).safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  return guard(async () => {
    const res = await mergeTags(parsed.data.sourceId, parsed.data.targetId);
    return ok(undefined, `Merged “${res.sourceName}” into “${res.targetName}” (${res.moved} contact${res.moved === 1 ? "" : "s"} re-tagged)`);
  });
}
