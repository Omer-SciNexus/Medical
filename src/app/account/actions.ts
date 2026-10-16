"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { AuthenticationError, assertSameOrigin, authCookieOptions, reissueRecoveryCodes, resendOwnVerification, restartMfaEnrollment, revokeAllSessions, SESSION_COOKIE } from "@/modules/identity";
import { requireActor } from "@/app/session";
import { toActionState } from "@/app/action-errors";
import type { ActionState } from "@/lib/action-state";

const SECURITY = "/account/security";
const CHALLENGE_COOKIE = "meridian_challenge";
export type SecurityState = ActionState & { secret?: string; recoveryCodes?: string[] };

export async function resendVerificationAction(): Promise<SecurityState> {
  try {
    const origin = await assertSameOrigin();
    const actor = await requireActor();
    await resendOwnVerification(actor, origin);
    return { ok: true, notice: "A confirmation link is on its way. It works once and lasts 24 hours." };
  } catch (error) { return toActionState(error); }
}
/**
 * Clears the authenticator and hands back a fresh enrollment challenge, which the existing
 * verification step completes. Every session ends with it, including this one, so the
 * enrollment must be finished to get back in.
 */
export async function restartAuthenticatorAction(): Promise<SecurityState> {
  try {
    await assertSameOrigin();
    const actor = await requireActor();
    const challenge = await restartMfaEnrollment(actor);
    if (challenge.kind !== "enroll_mfa") return { ok: false, code: "state", error: "This account cannot restart authenticator enrollment." };
    const jar = await cookies();
    jar.set(CHALLENGE_COOKIE, challenge.challenge, { ...await authCookieOptions(), maxAge: 300 });
    jar.delete(SESSION_COOKIE);
    return { ok: true, secret: new URL(challenge.provisioningUri).searchParams.get("secret") ?? undefined };
  } catch (error) {
    if (error instanceof AuthenticationError) return { ok: false, code: "state", error: error.message };
    return toActionState(error);
  }
}
export async function reissueRecoveryCodesAction(): Promise<SecurityState> {
  try {
    await assertSameOrigin();
    const actor = await requireActor();
    const codes = await reissueRecoveryCodes(actor);
    revalidatePath(SECURITY);
    return { ok: true, recoveryCodes: codes };
  } catch (error) {
    if (error instanceof AuthenticationError) return { ok: false, code: "state", error: error.message };
    return toActionState(error);
  }
}
export async function endOtherSessionsAction(): Promise<SecurityState> {
  try {
    await assertSameOrigin();
    const actor = await requireActor();
    // Ending every session includes this one, so the cookie goes too and sign-in follows.
    await revokeAllSessions(actor.id);
    (await cookies()).delete(SESSION_COOKIE);
    return { ok: true, notice: "Every session has been ended, including this one. Sign in again to continue." };
  } catch (error) { return toActionState(error); }
}
