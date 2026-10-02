import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveSession, SESSION_COOKIE, type Actor } from "@/modules/identity";

/** Every protected screen resolves its own actor; no layout is trusted to have done it. */
export async function requireActor(roles?: Actor["role"][]) {
  const actor = await resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!actor) redirect("/sign-in");
  if (roles && !roles.includes(actor.role)) redirect("/dashboard");
  return actor;
}
