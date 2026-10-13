import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { ensureSystemTemplates } from "@/lib/email/system-templates";

/** Idempotent bootstrapping of built-in data (system email templates…). */
export async function ensureSystemData() {
  await ensureSystemTemplates();
}

/** True when no user exists yet → the first-run /setup flow is available. */
export async function needsSetup(): Promise<boolean> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return (row?.n ?? 0) === 0;
}
