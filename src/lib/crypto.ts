import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const DEV_SECRET = "relay-dev-secret-do-not-use-in-production-0123456789";

/** Master secret for sessions, signing and encrypting stored credentials. */
export function appSecret(): string {
  const s = process.env.APP_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production" && process.env.DATABASE_URL) {
    throw new Error("APP_SECRET must be set (at least 32 characters) in production.");
  }
  return DEV_SECRET;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmac(input: string, secret = appSecret()): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Sign a short value (e.g. a URL) so it can't be tampered with in links. */
export function sign(value: string): string {
  return hmac(value).slice(0, 22);
}

export function verifySignature(value: string, signature: string | null | undefined): boolean {
  if (!signature) return false;
  return safeEqual(sign(value), signature);
}

function key(): Buffer {
  return createHash("sha256").update(`enc:${appSecret()}`).digest();
}

/** AES-256-GCM encrypt a secret (API keys, SMTP passwords) for storage in settings. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    const [v, ivB, tagB, encB] = payload.split(".");
    if (v !== "v1") return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encB, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
