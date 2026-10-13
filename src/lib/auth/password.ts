import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB, hashB] = stored.split("$");
  if (algo !== "scrypt" || !saltB || !hashB) return false;
  const expected = Buffer.from(hashB, "base64url");
  const derived = await scrypt(password, Buffer.from(saltB, "base64url"), expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
