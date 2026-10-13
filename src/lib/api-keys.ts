import { desc, eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiKeys, type ApiKey } from "@/lib/db/schema";
import { randomToken, sha256 } from "@/lib/crypto";

// ---------------------------------------------------------------------------
// REST API keys: "rly_<random>". Only sha256(key) and a short display prefix are
// stored – the full key is shown exactly once, when it is created.
// ---------------------------------------------------------------------------

export const API_KEY_PREFIX = "rly_";
/** Characters of the key shown in the UI (including the "rly_" marker). */
const DISPLAY_PREFIX_LENGTH = 12;

export function generateApiKey() {
  const key = `${API_KEY_PREFIX}${randomToken(24)}`;
  return { key, hash: sha256(key), prefix: key.slice(0, DISPLAY_PREFIX_LENGTH) };
}

/** Create a key. Returns the plaintext key (never retrievable again) and the stored row. */
export async function createApiKey(input: { name: string; createdById?: string | null }) {
  const name = input.name.trim();
  if (!name) throw new Error("Give the key a name.");
  const { key, hash, prefix } = generateApiKey();
  const [record] = await db
    .insert(apiKeys)
    .values({ name: name.slice(0, 80), keyHash: hash, prefix, createdById: input.createdById ?? null })
    .returning();
  return { key, record };
}

/**
 * Check a presented key. Returns the key row (and bumps `lastUsedAt`) or null when the key
 * is unknown or revoked.
 */
export async function verifyApiKey(key: string | null | undefined): Promise<ApiKey | null> {
  if (!key || !key.startsWith(API_KEY_PREFIX) || key.length < 16 || key.length > 200) return null;
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, sha256(key)), isNull(apiKeys.revokedAt)));
  if (!row) return null;
  const now = new Date();
  await db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, row.id));
  return { ...row, lastUsedAt: now };
}

/** Extract the token from an `Authorization: Bearer <token>` header. */
export function bearerToken(headers: Headers): string | null {
  const header = headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m ? m[1] : null;
}

/** Authenticate an incoming API request (null = missing/invalid/revoked key). */
export async function authenticateApiRequest(req: Request): Promise<ApiKey | null> {
  return verifyApiKey(bearerToken(req.headers));
}

export async function revokeApiKey(id: string): Promise<boolean> {
  const rows = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  return rows.length > 0;
}

/** All keys (hash excluded), newest first. */
export async function listApiKeys() {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .orderBy(desc(apiKeys.createdAt));
}
