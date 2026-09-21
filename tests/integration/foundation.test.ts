import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { Client } from "pg";
import type { Pool } from "pg";
import type Redis from "ioredis";
import { readFile } from "node:fs/promises";
import { TOTP, Secret } from "otpauth";
import { migrateDatabase } from "../../scripts/migrate";
import { seedDatabase, seedId, seedIds } from "../../scripts/seed";
import { assertCanAccessPatient, requestBreakGlass, AccessDeniedError } from "../../src/modules/identity/service";
import { beginSignIn, finishSignIn, registerWorkspace } from "../../src/modules/identity/auth";
import { resolveSession, revokeSession } from "../../src/modules/identity/sessions";
import { encryptSecret } from "../../src/modules/identity/crypto";
import type { Actor, AccessPurpose } from "../../src/modules/identity/validators";

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
let owner: Client;
let app: Client;
const password = "integration-test-password-only";
const mfaSecret = "JBSWY3DPEHPK3PXP";
const actor = (role: Actor["role"], overrides: Partial<Actor> = {}): Actor => ({ id: role === "patient" ? seedIds.firstPatientUser : seedIds[role], clinicId: seedIds.clinic, role, patientId: role === "patient" ? seedIds.firstPatient : null, mfaVerified: role !== "patient", authenticatedAt: Date.now(), mfaVerifiedAt: role !== "patient" ? Date.now() : null, ...overrides });

beforeAll(async () => {
  // These are deliberately real services; missing Docker fails this suite visibly.
  postgres = await new PostgreSqlContainer("postgres:17-alpine").withDatabase("meridian").withUsername("meridian_owner").withPassword("test-owner-password").start();
  redis = await new RedisContainer("redis:7-alpine").start();
  owner = new Client({ connectionString: postgres.getConnectionUri() }); await owner.connect();
  await owner.query(await readFile("scripts/init-db.sql", "utf8"));
  await migrateDatabase(postgres.getConnectionUri());
  await migrateDatabase(postgres.getConnectionUri());
  await seedDatabase(postgres.getConnectionUri(), password);
  process.env.AUTH_PEPPER = "integration-test-only-pepper-32-characters";
  process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  const url = new URL(postgres.getConnectionUri()); url.username = "meridian_app"; url.password = "local-app-only";
  process.env.DATABASE_URL = url.toString();
  process.env.REDIS_URL = redis.getConnectionUrl();
  app = new Client({ connectionString: url.toString() }); await app.connect();
  await owner.query("UPDATE users SET mfa_secret = $1 WHERE role <> 'patient' AND active = true", [encryptSecret(mfaSecret)]);
}, 120_000);

afterAll(async () => {
  const globals = globalThis as unknown as { meridianPool?: Pool; meridianRedis?: Redis };
  await globals.meridianPool?.end(); globals.meridianPool = undefined;
  globals.meridianRedis?.disconnect(); globals.meridianRedis = undefined;
  await app?.end(); await owner?.end(); await redis?.stop(); await postgres?.stop();
});

describe("hostile patient-access matrix", () => {
  const purposes: AccessPurpose[] = ["patient.view", "scheduling", "clinical.read", "clinical.write", "prescribe"];
  for (const role of ["patient", "clinician", "staff", "admin"] as const) {
    const allowed: string[] = { patient: ["patient.view", "scheduling"], clinician: ["clinical.read", "clinical.write", "prescribe", "scheduling"], staff: ["scheduling"], admin: [] }[role];
    for (const purpose of purposes) it(`${role}: ${purpose}`, async () => {
      const operation = assertCanAccessPatient(actor(role), seedIds.firstPatient, purpose);
      if (allowed.includes(purpose)) await expect(operation).resolves.toBeUndefined();
      else await expect(operation).rejects.toBeInstanceOf(AccessDeniedError);
    });
  }
  it("denies a clinician without that patient's care relationship", async () => { await expect(assertCanAccessPatient(actor("clinician"), seedId(101), "clinical.read")).rejects.toBeInstanceOf(AccessDeniedError); });
  it("denies a patient's access to another patient", async () => { await expect(assertCanAccessPatient(actor("patient"), seedId(101), "patient.view")).rejects.toBeInstanceOf(AccessDeniedError); });
  it("denies non-MFA staff and forged clinic/role claims", async () => {
    await expect(assertCanAccessPatient(actor("staff", { mfaVerified: false }), seedIds.firstPatient, "scheduling")).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(assertCanAccessPatient(actor("clinician", { clinicId: seedId(9999) }), seedIds.firstPatient, "clinical.read")).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(assertCanAccessPatient(actor("admin", { role: "clinician" }), seedIds.firstPatient, "clinical.read")).rejects.toBeInstanceOf(AccessDeniedError);
  });
  it("retains denied access evidence", async () => { const result = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'access.denied'"); expect(result.rows[0].count).toBeGreaterThan(0); });
  it("break-glass is time-limited, read-only and cannot cross clinic scope", async () => {
    await requestBreakGlass(actor("clinician"), { patientId: seedId(103), reason: "Urgent continuity of care during an unplanned assessment." });
    await expect(assertCanAccessPatient(actor("clinician"), seedId(103), "clinical.read")).resolves.toBeUndefined();
    await expect(assertCanAccessPatient(actor("clinician"), seedId(103), "prescribe")).rejects.toBeInstanceOf(AccessDeniedError);
    await owner.query("UPDATE care_relationships SET expires_at = now() - interval '1 second' WHERE emergency = true");
    await expect(assertCanAccessPatient(actor("clinician"), seedId(103), "clinical.read")).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(requestBreakGlass(actor("clinician", { mfaVerifiedAt: null }), { patientId: seedId(103), reason: "Urgent continuity of care during an unplanned assessment." })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(requestBreakGlass(actor("clinician"), { patientId: seedId(9000), reason: "Urgent continuity of care during an unplanned assessment." })).rejects.toBeInstanceOf(AccessDeniedError);
  });
});

describe("database invariants as runtime user", () => {
  it("makes development seeding repeatable", async () => { expect(await seedDatabase(postgres!.getConnectionUri(), password)).toContain("no records changed"); expect((await owner.query("SELECT count(*)::int AS count FROM patients")).rows[0].count).toBe(40); });
  it("denies audit mutation, even to owner via trigger", async () => {
    await expect(app.query("SELECT * FROM audit_log")).rejects.toThrow();
    await expect(app.query("UPDATE audit_log SET action = 'tampered'")).rejects.toThrow();
    await expect(app.query("DELETE FROM audit_log")).rejects.toThrow();
    await expect(owner.query("UPDATE audit_log SET action = 'tampered'")).rejects.toThrow();
    await expect(app.query("DELETE FROM patients")).rejects.toThrow();
  });
  it("rejects a second active booking on a claimed slot", async () => {
    await expect(app.query("INSERT INTO appointments (clinic_id,created_by,updated_by,patient_id,slot_id,reason) VALUES ($1,$2,$2,$3,$4,'Synthetic follow-up')", [seedIds.clinic, seedIds.staff, seedIds.firstPatient, seedId(300)])).rejects.toThrow();
  });
  it("rejects overlapping provider availability", async () => {
    await expect(app.query("INSERT INTO availability_slots (clinic_id,created_by,updated_by,provider_id,starts_at,ends_at) VALUES ($1,$2,$2,$3,'2026-09-21T06:10:00Z','2026-09-21T06:30:00Z')", [seedIds.clinic, seedIds.staff, seedIds.clinician])).rejects.toThrow();
  });
  it("records one charge per encounter", async () => {
    const query = "INSERT INTO charges (clinic_id,created_by,updated_by,patient_id,encounter_id,amount_minor,currency,description) VALUES ($1,$2,$2,$3,$4,150000,'TRY','Consultation')";
    const args = [seedIds.clinic, seedIds.clinician, seedIds.firstPatient, seedId(500)];
    await app.query(query, args); await expect(app.query(query, args)).rejects.toThrow();
  });
  it("preserves signed note text and only allows the amendment marker", async () => {
    await owner.query("UPDATE note_versions SET status='signed',signed_at=now(),signed_by=$1 WHERE encounter_id=$2", [seedIds.clinician, seedId(500)]);
    await expect(app.query("UPDATE note_versions SET content='Overwritten' WHERE encounter_id=$1", [seedId(500)])).rejects.toThrow();
    await app.query("UPDATE note_versions SET status='amended',updated_by=$1 WHERE encounter_id=$2", [seedIds.clinician, seedId(500)]);
  });
});

describe("real Redis authentication", () => {
  it("creates an isolated clinic, enrolls its owner, and consumes recovery codes once", async () => {
    const input = { clinicName: "Integration clinic", displayName: "Synthetic Owner", email: "new-owner@example.test", password, confirmPassword: password, clinicId: seedIds.clinic, role: "clinician" };
    const result = await registerWorkspace(input, "registration-test");
    expect(result.kind).toBe("enroll_mfa");
    if (result.kind !== "enroll_mfa") throw new Error("New owners must enroll MFA.");
    const user = (await owner.query("SELECT * FROM users WHERE email = $1", [input.email])).rows[0];
    expect(user.role).toBe("admin");
    expect(user.clinic_id).not.toBe(seedIds.clinic);
    expect(user.patient_id).toBeNull();
    expect(await resolveSession(result.challenge)).toBeNull();
    const secret = new URL(result.provisioningUri).searchParams.get("secret")!;
    const code = new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate();
    const session = await finishSignIn({ challenge: result.challenge, code });
    const signedIn = await resolveSession(session.token);
    expect(signedIn?.mfaVerified).toBe(true);
    expect(signedIn?.clinicId).toBe(user.clinic_id);
    expect(session.recoveryCodes).toHaveLength(8);
    await expect(assertCanAccessPatient(signedIn!, seedIds.firstPatient, "clinical.read")).rejects.toBeInstanceOf(AccessDeniedError);
    await revokeSession(session.token);
    const retry = await beginSignIn(input, "registration-test");
    if (retry.kind !== "verify_mfa") throw new Error("Enrolled owners must verify MFA.");
    const recovered = await finishSignIn({ challenge: retry.challenge, code: session.recoveryCodes![0] });
    expect((await resolveSession(recovered.token))?.mfaVerifiedAt).toBeNull();
    const repeated = await beginSignIn(input, "registration-test");
    if (repeated.kind !== "verify_mfa") throw new Error("Expected verification.");
    await expect(finishSignIn({ challenge: repeated.challenge, code: session.recoveryCodes![0] })).rejects.toThrow();
    const clinicCount = (await owner.query("SELECT count(*)::int AS count FROM clinics")).rows[0].count;
    await expect(registerWorkspace(input, "registration-test")).rejects.toThrow("couldn’t create");
    expect((await owner.query("SELECT count(*)::int AS count FROM clinics")).rows[0].count).toBe(clinicCount);
  });
  it("creates and revokes a patient session", async () => {
    const result = await beginSignIn({ email: "patient@example.test", password }, "127.0.0.1");
    expect(result.kind).toBe("session");
    if (result.kind !== "session") throw new Error("Expected a patient session.");
    expect((await resolveSession(result.token))?.role).toBe("patient");
    await revokeSession(result.token); expect(await resolveSession(result.token)).toBeNull();
  });
  it("requires staff MFA, consumes the challenge and rejects TOTP replay", async () => {
    const first = await beginSignIn({ email: "staff@example.test", password }, "127.0.0.1");
    expect(first.kind).toBe("verify_mfa");
    if (first.kind !== "verify_mfa") throw new Error("Expected an MFA challenge.");
    const code = new TOTP({ secret: Secret.fromBase32(mfaSecret), digits: 6, period: 30 }).generate();
    const session = await finishSignIn({ challenge: first.challenge, code });
    expect((await resolveSession(session.token))?.mfaVerified).toBe(true);
    await expect(finishSignIn({ challenge: first.challenge, code })).rejects.toThrow();
    const second = await beginSignIn({ email: "staff@example.test", password }, "127.0.0.1");
    if (second.kind !== "verify_mfa") throw new Error("Expected an MFA challenge.");
    await expect(finishSignIn({ challenge: second.challenge, code })).rejects.toThrow();
  });
});
