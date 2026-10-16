import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { Client } from "pg";
import type { Pool } from "pg";
import type Redis from "ioredis";
import { readFile } from "node:fs/promises";
import { migrateDatabase } from "../../scripts/migrate";
import { seedDatabase, seedIds } from "../../scripts/seed";
import { encryptSecret } from "../../src/modules/identity/crypto";
import { AccessDeniedError, PersonAdminError, invitePerson, listPeople, resendPersonInvitation, resetPersonMfa, revokePersonInvitation, revokePersonSessions, setPersonActive } from "../../src/modules/identity/service";
import { acceptInvitation, describeInvitation, beginSignIn } from "../../src/modules/identity/auth";
import { createSession, resolveSession } from "../../src/modules/identity/sessions";
import { AuthenticationError } from "../../src/modules/identity/errors";
import type { Actor } from "../../src/modules/identity/validators";

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
let owner: Client;
const password = "integration-test-password-only";
const newPassword = "another memorable test passphrase";
const origin = "http://127.0.0.1:4000";
const tokenOf = (link: string) => new URL(link).searchParams.get("token") ?? "";

const admin = (overrides: Partial<Actor> = {}): Actor => ({ id: seedIds.admin, clinicId: seedIds.clinic, role: "admin", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now(), ...overrides });
const clinician = (): Actor => ({ id: seedIds.clinician, clinicId: seedIds.clinic, role: "clinician", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now() });

beforeAll(async () => {
  postgres = await new PostgreSqlContainer("postgres:17-alpine").withDatabase("meridian").withUsername("meridian_owner").withPassword("test-owner-password").start();
  redis = await new RedisContainer("redis:7-alpine").start();
  owner = new Client({ connectionString: postgres.getConnectionUri() }); await owner.connect();
  await owner.query(await readFile("scripts/init-db.sql", "utf8"));
  await migrateDatabase(postgres.getConnectionUri());
  await seedDatabase(postgres.getConnectionUri(), password);
  process.env.AUTH_PEPPER = "integration-test-only-pepper-32-characters";
  process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  delete process.env.MAIL_API_KEY;
  const app = new URL(postgres.getConnectionUri()); app.username = "meridian_app"; app.password = "local-app-only";
  process.env.DATABASE_URL = app.toString();
  process.env.REDIS_URL = redis.getConnectionUrl();
  await owner.query("UPDATE users SET mfa_secret = $1 WHERE role <> 'patient' AND active = true", [encryptSecret("JBSWY3DPEHPK3PXP")]);
}, 180_000);

afterAll(async () => {
  const globals = globalThis as unknown as { meridianPool?: Pool; meridianAuditPool?: Pool; meridianRedis?: Redis };
  await globals.meridianPool?.end(); globals.meridianPool = undefined;
  await globals.meridianAuditPool?.end(); globals.meridianAuditPool = undefined;
  globals.meridianRedis?.disconnect(); globals.meridianRedis = undefined;
  await owner?.end(); await redis?.stop(); await postgres?.stop();
});

describe("inviting a colleague", () => {
  it("stores only a hash of the token and returns the single-use link once", async () => {
    const invitation = await invitePerson(admin(), { email: "new.clinician@example.test", displayName: "Dr Ece Kaya", role: "clinician" }, origin);
    const token = tokenOf(invitation.link);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(invitation.delivered).toBe(false);
    const row = await owner.query("SELECT token_hash, role, clinic_id, consumed_at FROM invitations WHERE id = $1", [invitation.id]);
    expect(row.rows[0].token_hash).not.toBe(token);
    expect(row.rows[0]).toMatchObject({ role: "clinician", clinic_id: seedIds.clinic, consumed_at: null });
    const stored = await owner.query("SELECT count(*)::int AS count FROM invitations WHERE token_hash = $1", [token]);
    expect(stored.rows[0].count).toBe(0);
    const audit = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'identity.invitation_created' AND resource_id = $1", [invitation.id]);
    expect(audit.rows[0].count).toBe(1);
  });
  it("describes the invitation to the holder of the link without revealing it elsewhere", async () => {
    const invitation = await invitePerson(admin(), { email: "front.desk@example.test", displayName: "Mert Demir", role: "staff" }, origin);
    await expect(describeInvitation(tokenOf(invitation.link))).resolves.toMatchObject({ displayName: "Mert Demir", role: "staff" });
    await expect(describeInvitation("f".repeat(64))).resolves.toBeNull();
    await expect(describeInvitation("not-a-token")).resolves.toBeNull();
  });
  it("creates the account in the inviter's clinic with the invited role and nothing the caller chose", async () => {
    const invitation = await invitePerson(admin(), { email: "joiner@example.test", displayName: "Selin Arslan", role: "staff" }, origin);
    const result = await acceptInvitation({ token: tokenOf(invitation.link), password: newPassword, confirmPassword: newPassword }, "test");
    // A new account always starts at authenticator enrollment; it is never signed straight in.
    expect(result.kind).toBe("enroll_mfa");
    const user = await owner.query("SELECT clinic_id, role, display_name, active, patient_id, mfa_secret FROM users WHERE email = $1", ["joiner@example.test"]);
    expect(user.rows[0]).toMatchObject({ clinic_id: seedIds.clinic, role: "staff", display_name: "Selin Arslan", active: true, patient_id: null, mfa_secret: null });
    const consumed = await owner.query("SELECT consumed_at FROM invitations WHERE id = $1", [invitation.id]);
    expect(consumed.rows[0].consumed_at).not.toBeNull();
  });
  it("refuses the same link a second time", async () => {
    const invitation = await invitePerson(admin(), { email: "once@example.test", displayName: "Only Once", role: "staff" }, origin);
    const token = tokenOf(invitation.link);
    await acceptInvitation({ token, password: newPassword, confirmPassword: newPassword }, "test");
    await expect(acceptInvitation({ token, password: newPassword, confirmPassword: newPassword }, "test")).rejects.toBeInstanceOf(AuthenticationError);
    const accounts = await owner.query("SELECT count(*)::int AS count FROM users WHERE email = $1", ["once@example.test"]);
    expect(accounts.rows[0].count).toBe(1);
  });
  it("refuses a revoked link and an expired link", async () => {
    const revoked = await invitePerson(admin(), { email: "revoked@example.test", displayName: "Revoked Invite", role: "staff" }, origin);
    await revokePersonInvitation(admin(), { invitationId: revoked.id });
    await expect(acceptInvitation({ token: tokenOf(revoked.link), password: newPassword, confirmPassword: newPassword }, "test")).rejects.toBeInstanceOf(AuthenticationError);
    const expired = await invitePerson(admin(), { email: "expired@example.test", displayName: "Expired Invite", role: "staff" }, origin);
    await owner.query("UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE id = $1", [expired.id]);
    await expect(acceptInvitation({ token: tokenOf(expired.link), password: newPassword, confirmPassword: newPassword }, "test")).rejects.toBeInstanceOf(AuthenticationError);
    const accounts = await owner.query("SELECT count(*)::int AS count FROM users WHERE email IN ('revoked@example.test', 'expired@example.test')");
    expect(accounts.rows[0].count).toBe(0);
  });
  it("replaces the previous link when a new one is issued", async () => {
    const first = await invitePerson(admin(), { email: "rotated@example.test", displayName: "Rotated Invite", role: "clinician" }, origin);
    const second = await resendPersonInvitation(admin(), { invitationId: first.id }, origin);
    expect(tokenOf(second.link)).not.toBe(tokenOf(first.link));
    await expect(acceptInvitation({ token: tokenOf(first.link), password: newPassword, confirmPassword: newPassword }, "test")).rejects.toBeInstanceOf(AuthenticationError);
    await expect(acceptInvitation({ token: tokenOf(second.link), password: newPassword, confirmPassword: newPassword }, "test")).resolves.toMatchObject({ kind: "enroll_mfa" });
  });
  it("refuses a second pending invitation for one address, and an address that already has an account", async () => {
    await invitePerson(admin(), { email: "duplicate@example.test", displayName: "First Invite", role: "staff" }, origin);
    await expect(invitePerson(admin(), { email: "duplicate@example.test", displayName: "Second Invite", role: "staff" }, origin)).rejects.toBeInstanceOf(PersonAdminError);
    await expect(invitePerson(admin(), { email: "admin@example.test", displayName: "Already Here", role: "clinician" }, origin)).rejects.toBeInstanceOf(PersonAdminError);
  });
  it("rejects a role or clinic the administrator is not allowed to grant", async () => {
    await expect(invitePerson(admin(), { email: "another.admin@example.test", displayName: "Another Admin", role: "admin" }, origin)).rejects.toThrow();
    await expect(invitePerson(admin(), { email: "patient.invite@example.test", displayName: "Patient Account", role: "patient" }, origin)).rejects.toThrow();
  });
});

describe("administering accounts", () => {
  it("is closed to everyone but a verified administrator, and records the refusal", async () => {
    await expect(listPeople(clinician())).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(invitePerson(clinician(), { email: "nope@example.test", displayName: "Not Allowed", role: "staff" }, origin)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(listPeople(admin({ mfaVerified: false }))).rejects.toBeInstanceOf(AccessDeniedError);
    const audit = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'administration.denied'");
    expect(audit.rows[0].count).toBeGreaterThanOrEqual(3);
  });
  it("lists this clinic's accounts and invitations, and no patient-linked account", async () => {
    const result = await listPeople(admin());
    expect(result.people.length).toBeGreaterThan(0);
    expect(result.people.some((person) => person.role === "patient")).toBe(false);
    expect(result.people.find((person) => person.id === seedIds.admin)).toMatchObject({ role: "admin", active: true, hasMfa: true });
    expect(result.invitations.length).toBeGreaterThan(0);
  });
  it("ends every session when an account is deactivated, and stops that account signing in", async () => {
    const { token } = await createSession(clinician());
    await expect(resolveSession(token)).resolves.toMatchObject({ id: seedIds.clinician });
    await setPersonActive(admin(), { userId: seedIds.clinician }, false);
    await expect(resolveSession(token)).resolves.toBeNull();
    await expect(beginSignIn({ email: "clinician@example.test", password }, "test")).rejects.toBeInstanceOf(AuthenticationError);
    await setPersonActive(admin(), { userId: seedIds.clinician }, true);
    const audit = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'identity.person_deactivated' AND resource_id = $1", [seedIds.clinician]);
    expect(audit.rows[0].count).toBe(1);
  });
  it("leaves a clinic with an administrator because the actor is never the account being changed", async () => {
    const deputy = await owner.query("INSERT INTO users (clinic_id, email, display_name, role, password_hash, mfa_secret) VALUES ($1, 'deputy@example.test', 'Deputy', 'admin', 'scrypt$32768$x$y', $2) RETURNING id",
      [seedIds.clinic, encryptSecret("JBSWY3DPEHPK3PXP")]);
    const deputyActor = { ...admin(), id: deputy.rows[0].id };
    // Either administrator may remove the other, and whoever acts is the one that remains.
    await expect(setPersonActive(deputyActor, { userId: seedIds.admin }, false)).resolves.toBeUndefined();
    await expect(setPersonActive(deputyActor, { userId: deputy.rows[0].id }, false)).rejects.toBeInstanceOf(PersonAdminError);
    const remaining = await owner.query("SELECT count(*)::int AS count FROM users WHERE clinic_id = $1 AND role = 'admin' AND active = true", [seedIds.clinic]);
    expect(remaining.rows[0].count).toBeGreaterThanOrEqual(1);
    await owner.query("UPDATE users SET active = true WHERE id = $1", [seedIds.admin]);
    await owner.query("UPDATE users SET active = false WHERE id = $1", [deputy.rows[0].id]);
  });
  it("clears an authenticator so the next sign-in enrolls again, and ends existing sessions", async () => {
    const { token } = await createSession(clinician());
    await resetPersonMfa(admin(), { userId: seedIds.clinician });
    await expect(resolveSession(token)).resolves.toBeNull();
    const row = await owner.query("SELECT mfa_secret, recovery_hashes FROM users WHERE id = $1", [seedIds.clinician]);
    expect(row.rows[0].mfa_secret).toBeNull();
    expect(row.rows[0].recovery_hashes).toEqual([]);
    await expect(beginSignIn({ email: "clinician@example.test", password }, "test")).resolves.toMatchObject({ kind: "enroll_mfa" });
    await owner.query("UPDATE users SET mfa_secret = $1 WHERE id = $2", [encryptSecret("JBSWY3DPEHPK3PXP"), seedIds.clinician]);
  });
  it("revokes sessions on request and records it", async () => {
    const { token } = await createSession(clinician());
    await revokePersonSessions(admin(), { userId: seedIds.clinician });
    await expect(resolveSession(token)).resolves.toBeNull();
    const audit = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'identity.sessions_revoked' AND resource_id = $1", [seedIds.clinician]);
    expect(audit.rows[0].count).toBe(1);
  });
  it("refuses to change the administrator's own account from this screen", async () => {
    await expect(setPersonActive(admin(), { userId: seedIds.admin }, false)).rejects.toBeInstanceOf(PersonAdminError);
    await expect(resetPersonMfa(admin(), { userId: seedIds.admin })).rejects.toBeInstanceOf(PersonAdminError);
    await expect(revokePersonSessions(admin(), { userId: seedIds.admin })).rejects.toBeInstanceOf(PersonAdminError);
  });
  it("cannot reach an account in another clinic, or a patient-linked account", async () => {
    const other = await owner.query("INSERT INTO clinics (name) VALUES ('Other Clinic') RETURNING id");
    const outsider = await owner.query("INSERT INTO users (clinic_id, email, display_name, role, password_hash) VALUES ($1, 'outsider@example.test', 'Outsider', 'clinician', 'scrypt$32768$x$y') RETURNING id", [other.rows[0].id]);
    await expect(setPersonActive(admin(), { userId: outsider.rows[0].id }, false)).rejects.toBeInstanceOf(PersonAdminError);
    await expect(resetPersonMfa(admin(), { userId: seedIds.firstPatientUser })).rejects.toBeInstanceOf(PersonAdminError);
    const untouched = await owner.query("SELECT active FROM users WHERE id = $1", [outsider.rows[0].id]);
    expect(untouched.rows[0].active).toBe(true);
  });
});
