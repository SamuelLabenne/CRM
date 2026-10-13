import path from "node:path";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { migrate as migrateLite } from "drizzle-orm/pglite/migrator";
import { db, usingPglite } from "./index";

const migrationsFolder = path.join(process.cwd(), "drizzle");

/** Apply pending migrations from ./drizzle. Safe to call repeatedly. */
export async function runMigrations() {
  if (usingPglite) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrateLite(db as any, { migrationsFolder });
  } else {
    await migratePg(db, { migrationsFolder });
  }
}
