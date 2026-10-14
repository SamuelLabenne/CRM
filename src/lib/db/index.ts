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
    // Supabase: use the TRANSACTION pooler (port 6543) – it serves up to ~200 short-lived
    // serverless clients over a few database connections (the session pooler only allows 15
    // clients, which frozen serverless instances exhaust). The transaction pooler hangs when
    // postgres.js pipelines several queries on one connection, so pipelining is disabled
    // (max_pipeline: 0): extra queries wait client-side for a free connection instead.
    const client = postgres(process.env.DATABASE_URL, {
      prepare: false, // transaction poolers don't support prepared statements
      max_pipeline: 0,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idle_timeout: 5,
      max_lifetime: 120,
    } as postgres.Options<Record<string, postgres.PostgresType>>);
    return drizzlePostgres(client, { schema });
  }
  // During `next build` several workers may load this module at once; never share the on-disk
  // dev database with them (production builds use DATABASE_URL anyway).
  const configured =
    process.env.NEXT_PHASE === "phase-production-build" ? "memory://" : (process.env.PGLITE_DIR ?? ".data/pglite");
  if (configured.startsWith("memory://")) {
    holder.pglite = new PGlite(configured); // tests
  } else {
    const dir = path.resolve(/*turbopackIgnore: true*/ configured);
    mkdirSync(path.dirname(dir), { recursive: true });
    holder.pglite = new PGlite(dir);
  }
  return drizzlePglite(holder.pglite, { schema }) as unknown as DB;
}

export const db: DB = (holder.db ??= create());
export { schema };
