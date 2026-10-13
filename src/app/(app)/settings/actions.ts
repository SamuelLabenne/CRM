"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, zodFail, type ActionResult } from "@/lib/action";
import { setSetting } from "@/lib/settings";
import { hexColor, timezone } from "./_lib/schemas";

const currencies = new Set<string>((() => {
  try {
    return Intl.supportedValuesOf("currency");
  } catch {
    return ["AUD", "USD", "EUR", "GBP"];
  }
})());

const generalSchema = z.object({
  name: z.string().trim().min(1, "Workspace name is required").max(80, "Keep it under 80 characters"),
  timezone,
  brandColor: hexColor,
  logoUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), "Enter a full image URL starting with https://"),
  address: z.string().trim().max(300, "Keep the address under 300 characters"),
  currency: z.string().refine((c) => currencies.has(c), "Choose a valid currency"),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]),
});

export type GeneralInput = z.input<typeof generalSchema>;

export async function saveGeneralSettingsAction(input: GeneralInput): Promise<ActionResult> {
  await requireAdmin();
  const parsed = generalSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const d = parsed.data;
  try {
    await setSetting("workspace", {
      name: d.name,
      timezone: d.timezone,
      brandColor: d.brandColor.toLowerCase(),
      logoUrl: d.logoUrl || null,
      address: d.address,
      currency: d.currency,
      weekStartsOn: d.weekStartsOn,
    });
  } catch (err) {
    console.error("[settings] general save failed", err);
    return fail("Could not save settings. Please try again.");
  }
  revalidatePath("/", "layout");
  return ok(undefined, "Workspace settings saved");
}
