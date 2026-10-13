"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, zodFail, type ActionResult } from "@/lib/action";
import { FieldError, createFieldDef, deleteFieldDef, moveFieldDef, updateFieldDef } from "../_lib/fields";
import { uuid } from "../_lib/schemas";

const fieldSchema = z.object({
  label: z.string().trim().min(1, "Give the field a label").max(60, "Keep the label under 60 characters"),
  type: z.enum(["text", "textarea", "number", "date", "select", "multiselect", "url", "checkbox"]),
  options: z.array(z.string().max(100)).max(100).default([]),
});

async function guard(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    const res = await fn();
    if (res.ok) {
      revalidatePath("/settings/fields");
      revalidatePath("/contacts", "layout");
    }
    return res;
  } catch (err) {
    if (err instanceof FieldError) return fail(err.message);
    console.error("[settings/fields]", err);
    return fail("Something went wrong. Please try again.");
  }
}

export async function createFieldAction(input: z.input<typeof fieldSchema>): Promise<ActionResult> {
  await requireAdmin();
  const parsed = fieldSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  return guard(async () => {
    const def = await createFieldDef(parsed.data);
    return ok(undefined, `Field “${def.label}” created`);
  });
}

export async function updateFieldAction(input: z.input<typeof fieldSchema> & { id: string }): Promise<ActionResult> {
  await requireAdmin();
  const parsed = fieldSchema.extend({ id: uuid }).safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const { id, ...rest } = parsed.data;
  return guard(async () => {
    await updateFieldDef(id, rest);
    return ok(undefined, "Field updated");
  });
}

export async function deleteFieldAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return fail("Invalid field");
  return guard(async () => {
    await deleteFieldDef(parsed.data);
    return ok(undefined, "Field deleted");
  });
}

export async function moveFieldAction(input: { id: string; direction: 1 | -1 }): Promise<ActionResult> {
  await requireAdmin();
  const parsed = z.object({ id: uuid, direction: z.union([z.literal(1), z.literal(-1)]) }).safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  return guard(async () => {
    await moveFieldDef(parsed.data.id, parsed.data.direction);
    return ok(undefined, "");
  });
}
