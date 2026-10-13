// Vitest helper: gives each test file its own in-memory Postgres (PGlite) with
// all migrations applied. Usage at the top of a *.test.ts file:
//
//   import { setupTestDb } from "@/test/setup-db";
//   const { db } = await setupTestDb();
//
// (next/cache and server-only are aliased to no-op mocks in vitest.config.mts)

export async function setupTestDb() {
  process.env.PGLITE_DIR = "memory://";
  delete process.env.DATABASE_URL;
  const { db } = await import("@/lib/db");
  const { runMigrations } = await import("@/lib/db/migrate");
  await runMigrations();
  const { ensureSystemData } = await import("@/lib/system");
  await ensureSystemData();
  return { db };
}

/** Create a user quickly (owner by default). */
export async function createTestUser(overrides: Partial<{ email: string; name: string; role: "owner" | "admin" | "member" }> = {}) {
  const { db } = await import("@/lib/db");
  const { users } = await import("@/lib/db/schema");
  const [u] = await db
    .insert(users)
    .values({
      email: overrides.email ?? `user${Math.random().toString(36).slice(2, 8)}@test.local`,
      name: overrides.name ?? "Test User",
      passwordHash: "x",
      role: overrides.role ?? "owner",
    })
    .returning();
  return u;
}
