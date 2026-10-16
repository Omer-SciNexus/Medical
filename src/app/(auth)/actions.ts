"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AuthenticationError, acceptInvitation, assertSameOrigin, authConfigured, authCookieOptions, beginSignIn, completePasswordReset, finishSignIn, registerWorkspace, requestPasswordReset, revokeSession, SESSION_COOKIE, setSessionCookie } from "@/modules/identity";
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
async function credentialsAction(form: FormData, mode: "sign-in" | "sign-up" | "accept-invite"): Promise<AuthFormState> {
  let state: AuthFormState | null;
  try {
    const origin = await assertSameOrigin();
    // Validate before checking deployment configuration, so field feedback remains useful.
    const { loginSchema, registrationSchema, acceptInvitationSchema } = await import("@/modules/identity");
    const schema = mode === "sign-up" ? registrationSchema : mode === "accept-invite" ? acceptInvitationSchema : loginSchema;
    const data = schema.parse(Object.fromEntries(form));
    if (!authConfigured()) return { step: "credentials", error: unavailable };
    // Conservative shared bucket; never trust a client-supplied forwarding header for rate limits.
    const result = mode === "sign-up" ? await registerWorkspace(data, "public-web", origin)
      : mode === "accept-invite" ? await acceptInvitation(data, "public-web")
      : await beginSignIn(data, "public-web");
    state = await acceptResult(result);
  } catch (error) { return failure(error, "credentials"); }
  if (state) return state;
  redirect("/dashboard");
}
export async function signInAction(_previous: AuthFormState, form: FormData) { return credentialsAction(form, "sign-in"); }
export async function signUpAction(_previous: AuthFormState, form: FormData) { return credentialsAction(form, "sign-up"); }
export async function acceptInviteAction(_previous: AuthFormState, form: FormData) { return credentialsAction(form, "accept-invite"); }
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
export type ResetState = { sent?: boolean; done?: boolean; error?: string; errors?: Record<string, string[] | undefined> };
// The reply is the same whether or not that address has an account: an unauthenticated
// caller may not learn who is registered here.
export async function requestResetAction(_previous: ResetState, form: FormData): Promise<ResetState> {
  try {
    const origin = await assertSameOrigin();
    if (!authConfigured()) return { error: unavailable };
    await requestPasswordReset({ email: String(form.get("email") ?? "") }, "public-web", origin);
    return { sent: true };
  } catch (error) {
    if (error instanceof z.ZodError) return { errors: z.flattenError(error).fieldErrors };
    if (error instanceof AuthenticationError) return { error: error.message };
    logOperational("request.failed", { code: "RESET_UNAVAILABLE" });
    return { error: unavailable };
  }
}
export async function completeResetAction(_previous: ResetState, form: FormData): Promise<ResetState> {
  try {
    await assertSameOrigin();
    if (!authConfigured()) return { error: unavailable };
    await completePasswordReset({ token: String(form.get("token") ?? ""), password: String(form.get("password") ?? ""), confirmPassword: String(form.get("confirmPassword") ?? "") }, "public-web");
    // Sessions are already gone; drop any cookie this browser still holds.
    const jar = await cookies();
    jar.delete(SESSION_COOKIE);
    jar.delete(CHALLENGE_COOKIE);
    return { done: true };
  } catch (error) {
    if (error instanceof z.ZodError) return { errors: z.flattenError(error).fieldErrors };
    if (error instanceof AuthenticationError) return { error: error.message };
    logOperational("request.failed", { code: "RESET_UNAVAILABLE" });
    return { error: unavailable };
  }
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
