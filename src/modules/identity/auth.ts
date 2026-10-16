import "server-only";
import { TOTP, Secret } from "otpauth";
import { z } from "zod";
import { getRedis } from "@/platform/redis";
import { sendMail } from "@/platform/mailer";
import { isUniqueViolation } from "@/platform/errors";
import { hashPassword, verifyPassword, digest, encryptSecret, decryptSecret, newToken, newRecoveryCodes } from "./crypto";
import { findUserByEmail, findUserById, appendAudit, clearOwnMfa, enrollMfa, consumeRecoveryCode, createClinicOwner, consumeInvitation, findInvitationByTokenHash, markEmailVerified, replaceRecoveryCodes, setPassword } from "./repository";
import { createSession, revokeAllSessions } from "./sessions";
import { acceptInvitationSchema, actorSchema, loginSchema, challengeSchema, passwordResetSchema, registrationSchema, resetRequestSchema, type Actor } from "./validators";
import { hasFreshTotp } from "./policy";
import { AuthenticationError } from "./errors";

const challengeData = z.object({ userId: z.uuid(), authenticatedAt: z.number(), secret: z.string().optional() });
const authFailure = () => new AuthenticationError("The sign-in details could not be verified. Check your details and try again.");
let dummyHash: Promise<string> | undefined;

async function throttle(scope: string, value: string, limit: number) {
  const key = `limit:${scope}:${digest(value)}`;
  const count = await getRedis().eval("local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return n", 1, key, 900);
  if (Number(count) > limit) throw new AuthenticationError("Too many attempts. Please wait 15 minutes before trying again.");
}
function actorFor(user: NonNullable<Awaited<ReturnType<typeof findUserById>>>, authenticatedAt: number, mfa: boolean, fresh: boolean): Actor {
  return { id: user.id, clinicId: user.clinicId, role: user.role, patientId: user.patientId, authenticatedAt, mfaVerified: mfa, mfaVerifiedAt: fresh ? Date.now() : null };
}
export async function beginSignIn(input: unknown, trustedClientAddress: string) {
  const { email, password } = loginSchema.parse(input);
  await throttle("address", trustedClientAddress, 60);
  await throttle("account", email, 10);
  const user = await findUserByEmail(email);
  dummyHash ??= hashPassword(newToken());
  const passwordMatches = await verifyPassword(password, user?.passwordHash ?? await dummyHash);
  if (!user?.active || !passwordMatches) {
    await appendAudit({ clinicId: null, actorId: null, action: "identity.sign_in_denied", purpose: "authentication", outcome: "denied" });
    throw authFailure();
  }
  return beginChallenge(user);
}
export async function registerWorkspace(input: unknown, trustedClientAddress: string, origin?: string) {
  const data = registrationSchema.parse(input);
  await throttle("registration_address", trustedClientAddress, 10);
  await throttle("registration_account", data.email, 3);
  const passwordHash = await hashPassword(data.password);
  let user: NonNullable<Awaited<ReturnType<typeof findUserById>>>;
  try {
    user = await createClinicOwner({ clinicName: data.clinicName, displayName: data.displayName, email: data.email, passwordHash });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AuthenticationError("We couldn’t create this workspace. If you already have an account, sign in instead.");
    throw error;
  }
  // Nothing waits on delivery: enrollment continues and the address is confirmed separately.
  if (origin) await sendEmailVerification(user.id, origin);
  return beginChallenge(user);
}
const RESET_SECONDS = 30 * 60;
const VERIFY_SECONDS = 24 * 60 * 60;
// Single-use tokens live in Redis under a peppered key, the same convention sessions and MFA
// challenges use: a Redis dump yields nothing a caller could present.
const resetKey = (token: string) => `reset:${digest(token)}`;
const verifyKey = (token: string) => `verify:${digest(token)}`;

/**
 * Always succeeds from the caller's point of view. Whether an address has an account is not
 * something an unauthenticated request may learn, so the answer never varies.
 */
export async function requestPasswordReset(input: unknown, trustedClientAddress: string, origin: string) {
  const { email } = resetRequestSchema.parse(input);
  await throttle("reset_address", trustedClientAddress, 20);
  await throttle("reset_account", email, 5);
  const user = await findUserByEmail(email);
  if (!user?.active) {
    await appendAudit({ clinicId: null, actorId: null, action: "identity.reset_unknown", purpose: "authentication", outcome: "denied" });
    return;
  }
  const token = newToken();
  await getRedis().set(resetKey(token), JSON.stringify({ userId: user.id }), "EX", RESET_SECONDS);
  await appendAudit({ clinicId: user.clinicId, actorId: user.id, action: "identity.reset_requested", purpose: "authentication", outcome: "allowed" });
  await sendMail({ to: user.email, subject: "Reset your Meridian password",
    text: `A password reset was requested for your account. Open the link below within 30 minutes to choose a new password. Every signed-in session will be ended.\n\n${origin}/reset-password?token=${token}\n\nIf this was not you, ignore this message: nothing has changed and the link expires on its own.` });
}
export async function completePasswordReset(input: unknown, trustedClientAddress: string) {
  const data = passwordResetSchema.parse(input);
  await throttle("reset_token", data.token, 6);
  await throttle("reset_complete_address", trustedClientAddress, 20);
  // GETDEL spends the token: a second attempt with the same link finds nothing.
  const raw = await getRedis().getdel(resetKey(data.token));
  if (!raw) throw new AuthenticationError("This reset link is no longer valid. Request a new one.");
  const { userId } = z.object({ userId: z.uuid() }).parse(JSON.parse(raw));
  const user = await setPassword(userId, await hashPassword(data.password));
  if (!user) throw new AuthenticationError("This reset link is no longer valid. Request a new one.");
  // A reset is also the remedy for a stolen session, so every session ends with it.
  await revokeAllSessions(user.id);
}
export async function sendEmailVerification(userId: string, origin: string) {
  const user = await findUserById(userId);
  if (!user?.active || user.emailVerifiedAt) return;
  const token = newToken();
  await getRedis().set(verifyKey(token), JSON.stringify({ userId: user.id }), "EX", VERIFY_SECONDS);
  await sendMail({ to: user.email, subject: "Confirm your email address",
    text: `Confirm this address to finish setting up your workspace. The link below works once and expires in 24 hours.\n\n${origin}/verify-email?token=${token}` });
}
export async function confirmEmailVerification(token: unknown) {
  const parsed = z.string().regex(/^[a-f0-9]{64}$/).safeParse(token);
  if (!parsed.success) return false;
  await throttle("verify_token", parsed.data, 10);
  const raw = await getRedis().getdel(verifyKey(parsed.data));
  if (!raw) return false;
  const { userId } = z.object({ userId: z.uuid() }).parse(JSON.parse(raw));
  return Boolean(await markEmailVerified(userId));
}
/**
 * Restarts authenticator enrollment for the person signed in. Allowed in exactly two cases:
 * they still hold the authenticator and verified with it moments ago, or they signed in with a
 * recovery code, which is what a lost authenticator leaves them.
 */
export async function restartMfaEnrollment(inputActor: unknown) {
  const actor = actorSchema.parse(inputActor);
  if (actor.role === "patient") throw new AuthenticationError("Patient accounts do not use an authenticator.");
  const recoverySession = actor.mfaVerifiedAt === null;
  if (!recoverySession && !hasFreshTotp(actor)) throw new AuthenticationError("Verify with your authenticator again, then restart enrollment.");
  await throttle("mfa_restart", actor.id, 5);
  const user = await clearOwnMfa(actor.id);
  if (!user) throw new AuthenticationError("This account is no longer active.");
  await revokeAllSessions(actor.id);
  return beginChallenge(user);
}
export async function reissueRecoveryCodes(inputActor: unknown) {
  const actor = actorSchema.parse(inputActor);
  if (!hasFreshTotp(actor)) throw new AuthenticationError("Verify with your authenticator again, then reissue your recovery codes.");
  const codes = newRecoveryCodes();
  const user = await replaceRecoveryCodes(actor.id, codes.map((code) => digest(`${actor.id}:${code}`)));
  if (!user) throw new AuthenticationError("This account cannot be given recovery codes right now.");
  return codes;
}
// The invitation is the only source of clinic and role here. Nothing the caller sends can
// choose either, which is the same rule public registration follows.
export async function acceptInvitation(input: unknown, trustedClientAddress: string) {
  const data = acceptInvitationSchema.parse(input);
  await throttle("invitation_address", trustedClientAddress, 20);
  await throttle("invitation_token", data.token, 6);
  const invitation = await findInvitationByTokenHash(digest(data.token));
  if (!invitation || invitation.role === "admin") throw new AuthenticationError("This invitation link is no longer valid. Ask whoever invited you to send a new one.");
  const passwordHash = await hashPassword(data.password);
  let user: Awaited<ReturnType<typeof consumeInvitation>>;
  try {
    user = await consumeInvitation(invitation.id, { clinicId: invitation.clinicId, email: invitation.email, displayName: invitation.displayName, role: invitation.role, patientId: invitation.patientId, passwordHash });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AuthenticationError("An account already exists for that email address. Sign in instead.");
    throw error;
  }
  if (!user) throw new AuthenticationError("This invitation link has already been used.");
  // Opening the link is itself proof of control over the address it was sent to.
  await markEmailVerified(user.id);
  return beginChallenge(user);
}
export async function describeInvitation(token: string) {
  const parsed = z.string().regex(/^[a-f0-9]{64}$/).safeParse(token);
  if (!parsed.success) return null;
  const invitation = await findInvitationByTokenHash(digest(parsed.data));
  if (!invitation || invitation.role === "admin") return null;
  return { displayName: invitation.displayName, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt };
}
async function beginChallenge(user: NonNullable<Awaited<ReturnType<typeof findUserById>>>) {
  const authenticatedAt = Date.now();
  if (user.role === "patient" && !user.mfaSecret) return { kind: "session" as const, ...await createSession(actorFor(user, authenticatedAt, false, false)) };
  const challenge = newToken();
  const secret = user.mfaSecret ? undefined : new Secret({ size: 20 }).base32;
  await getRedis().set(`challenge:${digest(challenge)}`, JSON.stringify({ userId: user.id, authenticatedAt, secret: secret ? encryptSecret(secret) : undefined }), "EX", 300);
  if (secret) {
    const totp = new TOTP({ issuer: "Meridian", label: user.email, algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secret) });
    return { kind: "enroll_mfa" as const, challenge, provisioningUri: totp.toString() };
  }
  return { kind: "verify_mfa" as const, challenge };
}
export async function finishSignIn(input: unknown) {
  const { challenge, code } = challengeSchema.parse(input);
  const redis = getRedis();
  const challengeKey = `challenge:${digest(challenge)}`;
  await throttle("challenge", challenge, 6);
  const raw = await redis.get(challengeKey);
  if (!raw) throw authFailure();
  const data = challengeData.parse(JSON.parse(raw));
  let user = await findUserById(data.userId);
  if (!user?.active) throw authFailure();
  await throttle("mfa_account", user.id, 10);
  // Prevent one challenge being processed concurrently; keep failed challenges retryable.
  const lockKey = `${challengeKey}:lock`;
  const lockToken = newToken();
  if (!await redis.set(lockKey, lockToken, "EX", 30, "NX")) throw authFailure();
  try {
    if (await redis.get(challengeKey) !== raw) throw authFailure();
    let fresh = false;
    let recoveryCodes: string[] | undefined;
    if (code.includes("-")) {
      if (data.secret || !user.mfaSecret) throw authFailure();
      const recovered = await consumeRecoveryCode(user.id, digest(`${user.id}:${code}`));
      if (!recovered) throw authFailure();
      user = recovered;
    } else {
      const encrypted = data.secret ?? user.mfaSecret;
      if (!encrypted) throw authFailure();
      const totp = new TOTP({ secret: Secret.fromBase32(decryptSecret(encrypted)), digits: 6, period: 30 });
      const now = Date.now();
      const delta = totp.validate({ token: code, window: 1, timestamp: now });
      if (delta === null) throw authFailure();
      const step = Math.floor(now / 30_000) + delta;
      if (!await redis.set(`mfa_used:${user.id}:${step}`, "1", "EX", 120, "NX")) throw authFailure();
      if (data.secret) {
        recoveryCodes = newRecoveryCodes();
        const userId = user.id;
        user = await enrollMfa(userId, data.secret, recoveryCodes.map((value) => digest(`${userId}:${value}`)));
      }
      fresh = true;
    }
    await redis.del(challengeKey);
    return { kind: "session" as const, ...await createSession(actorFor(user, data.authenticatedAt, true, fresh)), recoveryCodes };
  } catch (error) {
    await appendAudit({ clinicId: user.clinicId, actorId: user.id, action: "identity.mfa_denied", purpose: "authentication", outcome: "denied" });
    throw error;
  } finally {
    await redis.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end", 1, lockKey, lockToken);
  }
}
export async function resendOwnVerification(inputActor: unknown, origin: string) {
  const actor = actorSchema.parse(inputActor);
  await throttle("verify_resend", actor.id, 5);
  await sendEmailVerification(actor.id, origin);
}
export async function emailVerificationState(inputActor: unknown) {
  const actor = actorSchema.parse(inputActor);
  const user = await findUserById(actor.id);
  return { verified: Boolean(user?.emailVerifiedAt), email: user?.email ?? "", hasMfa: Boolean(user?.mfaSecret), recoveryRemaining: user?.recoveryHashes.length ?? 0 };
}
