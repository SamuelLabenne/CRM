import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "@/test/setup-db";

const { db } = await setupTestDb();
const { apiKeys } = await import("@/lib/db/schema");
const keys = await import("./api-keys");
const { sha256 } = await import("@/lib/crypto");

describe("api keys", () => {
  it("creates a key, stores only its hash and verifies it (updating lastUsedAt)", async () => {
    const { key, record } = await keys.createApiKey({ name: "Zapier" });
    expect(key).toMatch(/^rly_[A-Za-z0-9_-]{20,}$/);
    expect(record.keyHash).toBe(sha256(key));
    expect(record.prefix).toBe(key.slice(0, 12));
    expect(record.lastUsedAt).toBeNull();
    const row = await keys.verifyApiKey(key);
    expect(row?.id).toBe(record.id);
    const [after] = await db.select().from(apiKeys).where(eq(apiKeys.id, record.id));
    expect(after.lastUsedAt).toBeTruthy();
    // The plaintext key is nowhere in the table
    expect(JSON.stringify(after)).not.toContain(key);
  });

  it("rejects unknown, malformed and revoked keys", async () => {
    const { key, record } = await keys.createApiKey({ name: "Temp" });
    expect(await keys.verifyApiKey(null)).toBeNull();
    expect(await keys.verifyApiKey("")).toBeNull();
    expect(await keys.verifyApiKey("rly_" + "x".repeat(32))).toBeNull();
    expect(await keys.verifyApiKey(key.replace(/^rly_/, "abc_"))).toBeNull();
    expect(await keys.revokeApiKey(record.id)).toBe(true);
    expect(await keys.revokeApiKey(record.id)).toBe(false);
    expect(await keys.verifyApiKey(key)).toBeNull();
  });

  it("parses the Authorization header", async () => {
    const { key } = await keys.createApiKey({ name: "Header" });
    expect(keys.bearerToken(new Headers({ authorization: `Bearer ${key}` }))).toBe(key);
    expect(keys.bearerToken(new Headers({ authorization: `bearer ${key}` }))).toBe(key);
    expect(keys.bearerToken(new Headers({ authorization: key }))).toBeNull();
    expect(keys.bearerToken(new Headers())).toBeNull();
    const ok = await keys.authenticateApiRequest(new Request("http://x", { headers: { authorization: `Bearer ${key}` } }));
    expect(ok?.name).toBe("Header");
    expect(await keys.authenticateApiRequest(new Request("http://x"))).toBeNull();
  });

  it("requires a name and lists keys without hashes", async () => {
    await expect(keys.createApiKey({ name: "  " })).rejects.toThrow();
    const list = await keys.listApiKeys();
    expect(list.length).toBeGreaterThan(0);
    expect(Object.keys(list[0])).not.toContain("keyHash");
  });
});
