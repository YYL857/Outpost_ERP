import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16384;
const KEYLEN = 64;

/** 格式：scrypt$saltHex$hashHex */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N: SCRYPT_N });
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "hex");
  const expected = Buffer.from(parts[2]!, "hex");
  if (salt.length === 0 || expected.length !== KEYLEN) return false;
  const actual = scryptSync(password, salt, KEYLEN, { N: SCRYPT_N });
  return timingSafeEqual(actual, expected);
}

export function generateBootstrapPassword(): string {
  return randomBytes(9).toString("base64url");
}
