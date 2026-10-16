import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { Client } from "pg";
import type { Pool } from "pg";
import type Redis from "ioredis";
import { readFile } from "node:fs/promises";
import { migrateDatabase } from "../../scripts/migrate";
import { seedDatabase, seedId, seedIds } from "../../scripts/seed";
import { encryptSecret } from "../../src/modules/identity/crypto";
import { AccessDeniedError, requestBreakGlass } from "../../src/modules/identity/service";
import { getPatientChartView } from "../../src/modules/clinical/service";
import { EncounterStateError } from "../../src/modules/clinical/validators";
import type { Actor } from "../../src/modules/identity/validators";

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
let owner: Client;
const clinicDay = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
// Patient 100 is on this clinician's care team in the seed; 101 belongs to the other clinician.
const mine = seedId(100);
const theirs = seedId(101);
const clinician = (overrides: Partial<Actor> = {}): Actor => ({ id: seedIds.clinician, clinicId: seedIds.clinic, role: "clinician", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now(), ...overrides });
const staff = (): Actor => ({ id: seedIds.staff, clinicId: seedIds.clinic, role: "staff", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now() });

beforeAll(async () => {
  postgres = await new PostgreSqlContainer("postgres:17-alpine").withDatabase("meridian").withUsername("meridian_owner").withPassword("test-owner-password").start();
  redis = await new RedisContainer("redis:7-alpine").start();
  owner = new Client({ connectionString: postgres.getConnectionUri() }); await owner.connect();
  await owner.query(await readFile("scripts/init-db.sql", "utf8"));
  await migrateDatabase(postgres.getConnectionUri());
  await seedDatabase(postgres.getConnectionUri(), "integration-test-password-only", clinicDay);
  process.env.AUTH_PEPPER = "integration-test-only-pepper-32-characters";
  process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.CLINIC_TIMEZONE = "Europe/Istanbul";
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

describe("the patient chart", () => {
  it("gathers identity, chart, prescriptions and prior visits, and records the read", async () => {
    const view = await getPatientChartView(clinician(), mine);
    expect(view.patient).toMatchObject({ id: mine });
    expect(view.patient.age).toBeGreaterThan(0);
    expect(view.chart.observations.length).toBeGreaterThan(0);
    expect(Array.isArray(view.visits)).toBe(true);
    expect(Array.isArray(view.prescriptions)).toBe(true);
    const audit = await owner.query("SELECT action FROM audit_log WHERE patient_id = $1 AND actor_id = $2 AND action IN ('clinical.chart_read', 'clinical.chart_visits_read', 'scheduling.patient_identity_read')", [mine, seedIds.clinician]);
    expect(new Set(audit.rows.map((row) => row.action)).size).toBe(3);
  });
  it("carries each visit's note versions, with signed text and amendment reasons intact", async () => {
    const seededVisit = (await owner.query("SELECT encounter_id FROM note_versions WHERE patient_id = $1 LIMIT 1", [mine])).rows[0];
    if (!seededVisit) return;
    const view = await getPatientChartView(clinician(), mine);
    const visit = view.visits.find((candidate) => candidate.id === seededVisit.encounter_id);
    expect(visit?.notes.length).toBeGreaterThan(0);
    expect(visit?.notes[0].content.length).toBeGreaterThan(0);
    // Versions arrive in order, so an amendment reads after what it amends.
    const versions = visit?.notes.map((note) => note.version) ?? [];
    expect([...versions].sort((a, b) => a - b)).toEqual(versions);
  });
  it("is denied for a patient this clinician has no relationship with, and the denial is recorded", async () => {
    await expect(getPatientChartView(clinician(), theirs)).rejects.toBeInstanceOf(AccessDeniedError);
    const denial = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'access.denied' AND patient_id = $1 AND actor_id = $2", [theirs, seedIds.clinician]);
    expect(denial.rows[0].count).toBeGreaterThan(0);
  });
  it("is not a screen the front desk can open", async () => {
    await expect(getPatientChartView(staff(), mine)).rejects.toBeInstanceOf(EncounterStateError);
  });
});

describe("emergency access", () => {
  it("opens a denied chart read-only, and is recorded as an emergency against the clinician", async () => {
    const reason = "Patient collapsed in the waiting room and the covering clinician is unreachable.";
    await requestBreakGlass(clinician(), { patientId: theirs, reason });
    const view = await getPatientChartView(clinician(), theirs);
    expect(view.patient.id).toBe(theirs);
    const grant = await owner.query("SELECT purpose, emergency, reason, expires_at FROM care_relationships WHERE actor_id = $1 AND patient_id = $2 AND emergency = true", [seedIds.clinician, theirs]);
    expect(grant.rows[0]).toMatchObject({ purpose: "clinical.read", emergency: true, reason });
    expect(grant.rows[0].expires_at.getTime()).toBeGreaterThan(Date.now());
    expect(grant.rows[0].expires_at.getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60_000);
    const audit = await owner.query("SELECT outcome FROM audit_log WHERE action = 'access.break_glass' AND patient_id = $1", [theirs]);
    expect(audit.rows[0].outcome).toBe("emergency");
  });
  it("grants reading only, never writing or prescribing", async () => {
    const purposes = await owner.query("SELECT purpose FROM care_relationships WHERE actor_id = $1 AND patient_id = $2 AND revoked_at IS NULL", [seedIds.clinician, theirs]);
    expect(purposes.rows.map((row) => row.purpose)).toEqual(["clinical.read"]);
  });
  it("needs a fresh authenticator check that a recovery code does not satisfy, and a real reason", async () => {
    const other = seedId(103);
    const reason = "Covering an unplanned assessment while the usual clinician is in theatre.";
    // A recovery-code sign-in leaves mfaVerifiedAt null, which is deliberately not fresh.
    await expect(requestBreakGlass(clinician({ mfaVerifiedAt: null }), { patientId: other, reason })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(requestBreakGlass(clinician({ mfaVerifiedAt: Date.now() - 10 * 60_000 }), { patientId: other, reason })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(requestBreakGlass(clinician(), { patientId: other, reason: "too short" })).rejects.toThrow();
    await expect(requestBreakGlass(staff(), { patientId: other, reason })).rejects.toBeInstanceOf(AccessDeniedError);
    const none = await owner.query("SELECT count(*)::int AS count FROM care_relationships WHERE patient_id = $1 AND emergency = true", [other]);
    expect(none.rows[0].count).toBe(0);
  });
  it("lapses on its own rather than needing to be withdrawn", async () => {
    await owner.query("UPDATE care_relationships SET expires_at = now() - interval '1 minute' WHERE actor_id = $1 AND patient_id = $2 AND emergency = true", [seedIds.clinician, theirs]);
    await expect(getPatientChartView(clinician(), theirs)).rejects.toBeInstanceOf(AccessDeniedError);
  });
});
