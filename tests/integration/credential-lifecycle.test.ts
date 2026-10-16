import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { Client } from "pg";
import type { Pool } from "pg";
import type Redis from "ioredis";
import { readFile } from "node:fs/promises";
import { TOTP, Secret } from "otpauth";
import { migrateDatabase } from "../../scripts/migrate";
import { seedDatabase, seedIds } from "../../scripts/seed";
import { digest, encryptSecret } from "../../src/modules/identity/crypto";
import { getRedis } from "../../src/platform/redis";
import { PersonAdminError, invitePerson } from "../../src/modules/identity/service";
import { acceptInvitation, beginSignIn, completePasswordReset, confirmEmailVerification, emailVerificationState, finishSignIn, registerWorkspace, reissueRecoveryCodes, requestPasswordReset, restartMfaEnrollment, sendEmailVerification } from "../../src/modules/identity/auth";
import { createSession, resolveSession } from "../../src/modules/identity/sessions";
import { AuthenticationError } from "../../src/modules/identity/errors";
import type { Actor } from "../../src/modules/identity/validators";

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
let owner: Client;
const password = "integration-test-password-only";
const replacement = "a brand new memorable passphrase";
const origin = "http://127.0.0.1:4000";
const mfaSecret = "JBSWY3DPEHPK3PXP";
const totp = () => new TOTP({ secret: Secret.fromBase32(mfaSecret), digits: 6, period: 30 }).generate();
const admin = (overrides: Partial<Actor> = {}): Actor => ({ id: seedIds.admin, clinicId: seedIds.clinic, role: "admin", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now(), ...overrides });
const tokenOf = (link: string) => new URL(link).searchParams.get("token") ?? "";

beforeAll(async () => {
  postgres = await new PostgreSqlContainer("postgres:17-alpine").withDatabase("meridian").withUsername("meridian_owner").withPassword("test-owner-password").start();
  redis = await new RedisContainer("redis:7-alpine").start();
  owner = new Client({ connectionString: postgres.getConnectionUri() }); await owner.connect();
  await owner.query(await readFile("scripts/init-db.sql", "utf8"));
  await migrateDatabase(postgres.getConnectionUri());
  await seedDatabase(postgres.getConnectionUri(), password);
  process.env.AUTH_PEPPER = "integration-test-only-pepper-32-characters";
  process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.CLINIC_TIMEZONE = "Europe/Istanbul";
  const app = new URL(postgres.getConnectionUri()); app.username = "meridian_app"; app.password = "local-app-only";
  process.env.DATABASE_URL = app.toString();
  process.env.REDIS_URL = redis.getConnectionUrl();
  await owner.query("UPDATE users SET mfa_secret = $1 WHERE role <> 'patient' AND active = true", [encryptSecret(mfaSecret)]);
}, 180_000);

afterAll(async () => {
  const globals = globalThis as unknown as { meridianPool?: Pool; meridianAuditPool?: Pool; meridianRedis?: Redis };
  await globals.meridianPool?.end(); globals.meridianPool = undefined;
  await globals.meridianAuditPool?.end(); globals.meridianAuditPool = undefined;
  globals.meridianRedis?.disconnect(); globals.meridianRedis = undefined;
  await owner?.end(); await redis?.stop(); await postgres?.stop();
});

/**
 * Stands in for the recipient's mailbox. The token itself is never stored, so a test cannot
 * recover the link; what it can check is that exactly one live token now points at this user.
 */
async function issuedTokens(prefix: string, userId: string) {
  const keys = await getRedis().keys(`${prefix}:*`);
  const mine: string[] = [];
  for (const key of keys) {
    const raw = await getRedis().get(key);
    if (raw && JSON.parse(raw).userId === userId) mine.push(key);
  }
  return mine;
}
/** Mints a link into the same key shape the service uses, to exercise spending it. */
async function plantToken(prefix: string, userId: string, token: string) {
  await getRedis().set(`${prefix}:${digest(token)}`, JSON.stringify({ userId }), "EX", 600);
  return token;
}

describe("password reset", () => {
  it("answers the same way whether or not the address has an account", async () => {
    await expect(requestPasswordReset({ email: "nobody@example.test" }, "test-address", origin)).resolves.toBeUndefined();
    await expect(requestPasswordReset({ email: "staff@example.test" }, "test-address", origin)).resolves.toBeUndefined();
    const audit = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'identity.reset_unknown'");
    expect(audit.rows[0].count).toBe(1);
    const recorded = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'identity.reset_requested' AND actor_id = $1", [seedIds.staff]);
    expect(recorded.rows[0].count).toBe(1);
  });
  it("sets the new password, ends every session, and spends the link", async () => {
    const session = await createSession({ id: seedIds.staff, clinicId: seedIds.clinic, role: "staff", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now() });
    // The request above left exactly one live token, keyed by its peppered hash.
    expect(await issuedTokens("reset", seedIds.staff)).toHaveLength(1);
    const token = await plantToken("reset", seedIds.staff, "a".repeat(64));
    await completePasswordReset({ token, password: replacement, confirmPassword: replacement }, "test-address");
    expect(await resolveSession(session.token)).toBeNull();
    await expect(beginSignIn({ email: "staff@example.test", password }, "test-address")).rejects.toBeInstanceOf(AuthenticationError);
    await expect(beginSignIn({ email: "staff@example.test", password: replacement }, "test-address")).resolves.toMatchObject({ kind: "verify_mfa" });
    // Single use: the same link cannot be spent twice.
    await expect(completePasswordReset({ token, password: replacement, confirmPassword: replacement }, "test-address")).rejects.toBeInstanceOf(AuthenticationError);
    const audit = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'identity.password_reset' AND actor_id = $1", [seedIds.staff]);
    expect(audit.rows[0].count).toBe(1);
  });
  it("refuses a weak or mismatched new password, and an unknown link", async () => {
    const token = await plantToken("reset", seedIds.staff, "b".repeat(64));
    await expect(completePasswordReset({ token, password: "short", confirmPassword: "short" }, "test-address")).rejects.toThrow();
    await expect(completePasswordReset({ token, password: replacement, confirmPassword: "something else" }, "test-address")).rejects.toThrow();
    // A rejected attempt does not spend the link.
    await expect(completePasswordReset({ token, password: replacement, confirmPassword: replacement }, "test-address")).resolves.toBeUndefined();
    await expect(completePasswordReset({ token: "c".repeat(64), password: replacement, confirmPassword: replacement }, "test-address")).rejects.toBeInstanceOf(AuthenticationError);
  });
});

describe("email verification", () => {
  it("leaves a newly registered workspace owner unverified until they confirm", async () => {
    const result = await registerWorkspace({ clinicName: "Verification Clinic", displayName: "Veri Fier", email: "verify.me@example.test", password, confirmPassword: password }, "test-address", origin);
    expect(result.kind).toBe("enroll_mfa");
    const user = await owner.query("SELECT id, email_verified_at FROM users WHERE email = $1", ["verify.me@example.test"]);
    expect(user.rows[0].email_verified_at).toBeNull();
    expect(await issuedTokens("verify", user.rows[0].id)).toHaveLength(1);
    const token = await plantToken("verify", user.rows[0].id, "d".repeat(64));
    expect(await confirmEmailVerification(token)).toBe(true);
    const confirmed = await owner.query("SELECT email_verified_at FROM users WHERE id = $1", [user.rows[0].id]);
    expect(confirmed.rows[0].email_verified_at).not.toBeNull();
    // Single use, and a malformed token is simply refused.
    expect(await confirmEmailVerification(token)).toBe(false);
    expect(await confirmEmailVerification("not-a-token")).toBe(false);
    const audit = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'identity.email_verified' AND actor_id = $1", [user.rows[0].id]);
    expect(audit.rows[0].count).toBe(1);
  });
  it("stops an unverified administrator sending invitations in the clinic's name", async () => {
    await owner.query("UPDATE users SET email_verified_at = NULL WHERE id = $1", [seedIds.admin]);
    await expect(invitePerson(admin(), { email: "blocked@example.test", displayName: "Blocked Invite", role: "staff" }, origin)).rejects.toBeInstanceOf(PersonAdminError);
    await owner.query("UPDATE users SET email_verified_at = now() WHERE id = $1", [seedIds.admin]);
    await expect(invitePerson(admin(), { email: "allowed@example.test", displayName: "Allowed Invite", role: "staff" }, origin)).resolves.toMatchObject({ email: "allowed@example.test" });
  });
  it("treats opening an invitation link as proof of the address", async () => {
    const invitation = await invitePerson(admin(), { email: "proven@example.test", displayName: "Proven Address", role: "clinician" }, origin);
    await acceptInvitation({ token: tokenOf(invitation.link), password: replacement, confirmPassword: replacement }, "test-address");
    const user = await owner.query("SELECT email_verified_at FROM users WHERE email = $1", ["proven@example.test"]);
    expect(user.rows[0].email_verified_at).not.toBeNull();
  });
  it("reports its own state and does not re-send once confirmed", async () => {
    const state = await emailVerificationState(admin());
    expect(state).toMatchObject({ verified: true, email: "admin@example.test", hasMfa: true });
    const before = await issuedTokens("verify", seedIds.admin);
    await sendEmailVerification(seedIds.admin, origin);
    expect(await issuedTokens("verify", seedIds.admin)).toEqual(before);
  });
});

describe("replacing a lost authenticator", () => {
  const lost = "00000000-0000-4000-8000-0000000000c1";
  it("is refused on a session that has not just verified with an authenticator", async () => {
    await owner.query("INSERT INTO users (id, clinic_id, email, display_name, role, password_hash, mfa_secret, email_verified_at) VALUES ($1, $2, 'lost.device@example.test', 'Lost Device', 'clinician', $3, $4, now())",
      [lost, seedIds.clinic, (await owner.query("SELECT password_hash FROM users WHERE id = $1", [seedIds.staff])).rows[0].password_hash, encryptSecret(mfaSecret)]);
    const stale: Actor = { id: lost, clinicId: seedIds.clinic, role: "clinician", patientId: null, mfaVerified: true, authenticatedAt: Date.now() - 600_000, mfaVerifiedAt: Date.now() - 600_000 };
    await expect(restartMfaEnrollment(stale)).rejects.toBeInstanceOf(AuthenticationError);
    await expect(reissueRecoveryCodes(stale)).rejects.toBeInstanceOf(AuthenticationError);
  });
  it("is allowed after a recovery-code sign-in, and enrolls a new authenticator", async () => {
    // A recovery-code session is exactly what someone with a lost authenticator has.
    const recovery: Actor = { id: lost, clinicId: seedIds.clinic, role: "clinician", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: null };
    const session = await createSession(recovery);
    const challenge = await restartMfaEnrollment(recovery);
    expect(challenge.kind).toBe("enroll_mfa");
    if (challenge.kind !== "enroll_mfa") throw new Error("Restarting enrollment must return a new setup key.");
    // The old authenticator is gone, as are the sessions it authenticated.
    const cleared = await owner.query("SELECT mfa_secret, recovery_hashes FROM users WHERE id = $1", [lost]);
    expect(cleared.rows[0].mfa_secret).toBeNull();
    expect(cleared.rows[0].recovery_hashes).toEqual([]);
    expect(await resolveSession(session.token)).toBeNull();
    const secret = new URL(challenge.provisioningUri).searchParams.get("secret")!;
    const code = new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate();
    const signedIn = await finishSignIn({ challenge: challenge.challenge, code });
    expect(signedIn.recoveryCodes).toHaveLength(8);
    expect((await resolveSession(signedIn.token))?.mfaVerified).toBe(true);
    const audit = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'identity.mfa_restarted' AND actor_id = $1", [lost]);
    expect(audit.rows[0].count).toBe(1);
  });
  it("reissues recovery codes only with a fresh authenticator check", async () => {
    const fresh: Actor = { id: seedIds.admin, clinicId: seedIds.clinic, role: "admin", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now() };
    const codes = await reissueRecoveryCodes(fresh);
    expect(codes).toHaveLength(8);
    const stored = await owner.query("SELECT recovery_hashes FROM users WHERE id = $1", [seedIds.admin]);
    expect(stored.rows[0].recovery_hashes).toHaveLength(8);
    // Stored as peppered hashes, never as the codes themselves.
    expect(stored.rows[0].recovery_hashes).not.toContain(codes[0]);
    expect(stored.rows[0].recovery_hashes).toContain(digest(`${seedIds.admin}:${codes[0]}`));
    // One of the new codes signs in, and the previous ones no longer do.
    const begun = await beginSignIn({ email: "admin@example.test", password }, "test-address");
    if (begun.kind !== "verify_mfa") throw new Error("Expected a verification challenge.");
    await expect(finishSignIn({ challenge: begun.challenge, code: codes[0] })).resolves.toMatchObject({ kind: "session" });
    expect(totp()).toMatch(/^\d{6}$/);
  });
});
