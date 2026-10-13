import { drizzle as drizzlePostgres, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import { mkdirSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;
/** A database handle or a transaction – accept this in helpers that may run inside `db.transaction`. */
export type Tx = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

type Holder = { db?: DB; pglite?: PGlite; ready?: Promise<void> };
const g = globalThis as unknown as { __relayDb?: Holder };
const holder: Holder = (g.__relayDb ??= {});

/** Local development uses an embedded Postgres (PGlite) stored on disk; production uses DATABASE_URL. */
export const usingPglite = !process.env.DATABASE_URL;

function create(): DB {
  if (process.env.DATABASE_URL) {
    const client = postgres(process.env.DATABASE_URL, {
      // Supabase transaction pooler (port 6543) does not support prepared statements.
      prepare: false,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idle_timeout: 20,
    });
    return drizzlePostgres(client, { schema });
  }
  const configured = process.env.PGLITE_DIR ?? ".data/pglite";
  if (configured.startsWith("memory://")) {
    holder.pglite = new PGlite(configured); // tests
  } else {
    const dir = path.resolve(configured);
    mkdirSync(path.dirname(dir), { recursive: true });
    holder.pglite = new PGlite(dir);
  }
  return drizzlePglite(holder.pglite, { schema }) as unknown as DB;
}

export const db: DB = (holder.db ??= create());
export { schema };
