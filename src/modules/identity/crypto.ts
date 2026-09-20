import { createCipheriv, createDecipheriv, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$32768$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: string, hash: string) {
  const [algorithm, cost, salt, encoded] = hash.split("$");
  if (algorithm !== "scrypt" || cost !== "32768" || !/^[a-f0-9]{32}$/.test(salt ?? "") || !/^[a-f0-9]{128}$/.test(encoded ?? "")) return false;
  return timingSafeEqual(await derive(password, salt), Buffer.from(encoded, "hex"));
}
export function digest(value: string) {
  const pepper = process.env.AUTH_PEPPER;
  if (!pepper || pepper.length < 32) throw new Error("AUTH_PEPPER requires at least 32 characters.");
  return createHmac("sha256", pepper).update(value).digest("hex");
}
function encryptionKey() {
  const key = Buffer.from(process.env.MFA_ENCRYPTION_KEY ?? "", "base64");
  if (key.length !== 32) throw new Error("MFA_ENCRYPTION_KEY must decode to 32 bytes.");
  return key;
}
export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}
export function decryptSecret(value: string) {
  const [iv, tag, data] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
export function newToken() { return randomBytes(32).toString("hex"); }
export function newRecoveryCodes() { return Array.from({ length: 8 }, () => `${randomBytes(4).toString("hex")}-${randomBytes(4).toString("hex")}`.toUpperCase()); }
