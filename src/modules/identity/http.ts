import "server-only";
import { cookies, headers } from "next/headers";
import { resolveSession, SESSION_COOKIE } from "./sessions";

export async function requireActor() {
  const actor = await resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!actor) throw new Error("Your session has expired. Sign in again to continue.");
  return actor;
}
export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 8 * 60 * 60 });
}
export async function assertSameOrigin() {
  const origin = (await headers()).get("origin");
  if (!process.env.APP_ORIGIN || origin !== process.env.APP_ORIGIN) throw new Error("This request could not be verified. Reload the page and try again.");
}
