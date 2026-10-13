// Applies migrations against DATABASE_URL (used during `npm run build` on Vercel
// and for manual runs). Locally without DATABASE_URL, migrations run on server start.
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.log("[migrate] No DATABASE_URL set – skipping (local PGlite migrates on startup).");
    return;
  }
  if (process.env.SKIP_MIGRATIONS === "1") {
    console.log("[migrate] SKIP_MIGRATIONS=1 – skipping.");
    return;
  }
  const client = postgres(url, { prepare: false, max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "drizzle") });
    console.log("[migrate] Migrations applied.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[migrate] Failed:", err);
  process.exit(1);
});
