import "server-only";
import { cookies, headers } from "next/headers";
import { resolveSession, SESSION_COOKIE } from "./sessions";
import { AuthenticationError } from "./errors";

const localOrigins = ["http://127.0.0.1:4000", "http://127.0.0.1:4001", "http://localhost:4000", "http://localhost:4001", "http://127.0.0.1:3000", "http://localhost:3000"];
export function allowedAuthOrigins() {
  return process.env.APP_ORIGIN ? [process.env.APP_ORIGIN, ...(process.env.APP_ADDITIONAL_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean)] : localOrigins;
}
export function authConfigured() {
  return Boolean(process.env.DATABASE_URL && process.env.REDIS_URL && process.env.AUTH_PEPPER && process.env.AUTH_PEPPER.length >= 32 && process.env.MFA_ENCRYPTION_KEY && Buffer.from(process.env.MFA_ENCRYPTION_KEY, "base64").length === 32);
}

export async function requireActor() {
  const actor = await resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!actor) throw new Error("Your session has expired. Sign in again to continue.");
  return actor;
}
export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, { ...await authCookieOptions(), maxAge: 8 * 60 * 60 });
}
export async function authCookieOptions() {
  const origin = await assertSameOrigin();
  return { httpOnly: true, secure: new URL(origin).protocol === "https:", sameSite: "strict" as const, path: "/" };
}
export async function assertSameOrigin() {
  const origin = (await headers()).get("origin");
  if (!origin || !allowedAuthOrigins().includes(origin) || (!origin.startsWith("https://") && !localOrigins.includes(origin))) throw new AuthenticationError("This request could not be verified. Reload the page and try again.");
  return origin;
}
