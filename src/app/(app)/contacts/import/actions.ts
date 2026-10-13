"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, ok, zodFail } from "@/lib/action";
import { importContactsChunk } from "@/lib/contacts/import";

const str = (max: number) => z.string().trim().max(max).optional();
const rowSchema = z.object({
  line: z.number().int().min(1),
  firstName: str(100),
  lastName: str(100),
  email: str(254),
  phone: str(40),
  company: str(200),
  jobTitle: str(200),
  website: str(300),
  city: str(120),
  country: str(120),
  notes: z.string().max(10_000).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  stage: str(60),
  dealValue: z.number().finite().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

const chunkSchema = z.object({
  rows: z.array(rowSchema).min(1).max(250),
  mode: z.enum(["update", "fill", "skip"]),
  tagName: z.string().trim().max(60).nullish(),
});

/** Import one chunk (≤250 rows) of already-mapped CSV rows. The client calls this repeatedly. */
export async function importChunkAction(input: z.input<typeof chunkSchema>) {
  const user = await requireUser();
  const parsed = chunkSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  try {
    const result = await importContactsChunk(parsed.data.rows, {
      mode: parsed.data.mode,
      tagName: parsed.data.tagName,
      actorId: user.id,
    });
    revalidatePath("/contacts");
    return ok(result);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Import failed");
  }
}
