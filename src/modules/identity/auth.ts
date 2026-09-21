import "server-only";
import { TOTP, Secret } from "otpauth";
import { z } from "zod";
import { getRedis } from "@/platform/redis";
import { hashPassword, verifyPassword, digest, encryptSecret, decryptSecret, newToken, newRecoveryCodes } from "./crypto";
import { findUserByEmail, findUserById, appendAudit, enrollMfa, consumeRecoveryCode, createClinicOwner } from "./repository";
import { createSession } from "./sessions";
import { loginSchema, challengeSchema, registrationSchema, type Actor } from "./validators";
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
export async function registerWorkspace(input: unknown, trustedClientAddress: string) {
  const data = registrationSchema.parse(input);
  await throttle("registration_address", trustedClientAddress, 10);
  await throttle("registration_account", data.email, 3);
  const passwordHash = await hashPassword(data.password);
  let user: NonNullable<Awaited<ReturnType<typeof findUserById>>>;
  try {
    user = await createClinicOwner({ clinicName: data.clinicName, displayName: data.displayName, email: data.email, passwordHash });
  } catch (error) {
    const cause = error instanceof Error && "cause" in error ? error.cause : error;
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "23505") throw new AuthenticationError("We couldn’t create this workspace. If you already have an account, sign in instead.");
    throw error;
  }
  return beginChallenge(user);
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
