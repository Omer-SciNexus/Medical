"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AuthenticationError, assertSameOrigin, authConfigured, authCookieOptions, beginSignIn, finishSignIn, registerWorkspace, revokeSession, SESSION_COOKIE, setSessionCookie } from "@/modules/identity";
import type { AuthFormState } from "@/lib/auth-form-state";
import { logOperational } from "@/platform/log";

const CHALLENGE_COOKIE = "meridian_challenge";
type BeginResult = Awaited<ReturnType<typeof beginSignIn>>;
const unavailable = "Account services are not available right now. Please try again shortly. You can still explore the preview.";

async function acceptResult(result: BeginResult, recoveryCodes?: string[]): Promise<AuthFormState | null> {
  const jar = await cookies();
  if (result.kind === "session") {
    const previous = jar.get(SESSION_COOKIE)?.value;
    if (previous) await revokeSession(previous);
    await setSessionCookie(result.token);
    jar.delete(CHALLENGE_COOKIE);
    return recoveryCodes?.length ? { step: "recovery_codes", recoveryCodes } : null;
  }
  jar.set(CHALLENGE_COOKIE, result.challenge, { ...await authCookieOptions(), maxAge: 300 });
  // The challenge token never enters client state or a URL. The setup key is shown once for enrollment.
  return result.kind === "enroll_mfa" ? { step: "enroll_mfa", secret: new URL(result.provisioningUri).searchParams.get("secret") ?? undefined } : { step: "verify_mfa" };
}
function failure(error: unknown, step: AuthFormState["step"]): AuthFormState {
  if (error instanceof z.ZodError) return { step, errors: z.flattenError(error).fieldErrors };
  if (error instanceof AuthenticationError) return { step, error: error.message };
  logOperational("request.failed", { code: "AUTH_UNAVAILABLE" });
  return { step, error: unavailable };
}
async function credentialsAction(form: FormData, mode: "sign-in" | "sign-up"): Promise<AuthFormState> {
  let state: AuthFormState | null;
  try {
    await assertSameOrigin();
    // Validate before checking deployment configuration, so field feedback remains useful.
    const { loginSchema, registrationSchema } = await import("@/modules/identity");
    const data = (mode === "sign-up" ? registrationSchema : loginSchema).parse(Object.fromEntries(form));
    if (!authConfigured()) return { step: "credentials", error: unavailable };
    // Conservative shared bucket; never trust a client-supplied forwarding header for rate limits.
    const result = mode === "sign-up" ? await registerWorkspace(data, "public-web") : await beginSignIn(data, "public-web");
    state = await acceptResult(result);
  } catch (error) { return failure(error, "credentials"); }
  if (state) return state;
  redirect("/dashboard");
}
export async function signInAction(_previous: AuthFormState, form: FormData) { return credentialsAction(form, "sign-in"); }
export async function signUpAction(_previous: AuthFormState, form: FormData) { return credentialsAction(form, "sign-up"); }
export async function verifyAction(previous: AuthFormState, form: FormData): Promise<AuthFormState> {
  let state: AuthFormState | null;
  const step = previous.step === "enroll_mfa" ? "enroll_mfa" : "verify_mfa";
  try {
    await assertSameOrigin();
    const challenge = (await cookies()).get(CHALLENGE_COOKIE)?.value;
    if (!challenge) return { step: "credentials", error: "Your verification step expired. Sign in again to get a new code setup." };
    const code = String(form.get("code") ?? "").trim().toUpperCase();
    if (!/^(\d{6}|[A-F0-9]{8}-[A-F0-9]{8})$/.test(code)) return { step, error: "Enter a six-digit authenticator code or a recovery code." };
    const result = await finishSignIn({ challenge, code });
    state = await acceptResult(result, result.recoveryCodes);
  } catch (error) { return failure(error, step); }
  if (state) return state;
  redirect("/dashboard");
}
export async function signOutAction() {
  await assertSameOrigin();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  // Keep the cookie on a service failure so the user can retry revocation.
  if (token) await revokeSession(token);
  jar.delete(SESSION_COOKIE);
  jar.delete(CHALLENGE_COOKIE);
  redirect("/sign-in");
}
