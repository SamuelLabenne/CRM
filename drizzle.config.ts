import { defineConfig } from "drizzle-kit";

// Migrations are generated from src/lib/db/schema.ts into ./drizzle and applied
// at startup (local PGlite) or at build time (DATABASE_URL), see src/lib/db/migrate.ts.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
});
