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
import { AccessDeniedError } from "../../src/modules/identity/service";
import { addProblem, changeProblemStatus, getPatientChart, recordAllergy, recordVitals, signNote, finishEncounter, startEncounter } from "../../src/modules/clinical/service";
import { EncounterStateError } from "../../src/modules/clinical/validators";
import type { Actor } from "../../src/modules/identity/validators";

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
let owner: Client;
const clinicDay = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const clinician = (overrides: Partial<Actor> = {}): Actor => ({ id: seedIds.clinician, clinicId: seedIds.clinic, role: "clinician", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now(), ...overrides });
const staff = (): Actor => ({ id: seedIds.staff, clinicId: seedIds.clinic, role: "staff", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now() });
const appointmentId = seedId(406);
const patientId = seedId(106);
let encounterId: string;

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
  encounterId = (await startEncounter(clinician(), { appointmentId })).id;
}, 180_000);

afterAll(async () => {
  const globals = globalThis as unknown as { meridianPool?: Pool; meridianAuditPool?: Pool; meridianRedis?: Redis };
  await globals.meridianPool?.end(); globals.meridianPool = undefined;
  await globals.meridianAuditPool?.end(); globals.meridianAuditPool = undefined;
  globals.meridianRedis?.disconnect(); globals.meridianRedis = undefined;
  await owner?.end(); await redis?.stop(); await postgres?.stop();
});

// Scoped to this clinician's own rows: the seed writes observations for the same patient, and
// its clinic day is tomorrow, so its observed_at values sort ahead of anything recorded now.
const storedFor = (label: string) => owner.query(
  "SELECT value, unit, reference_low, reference_high, flag, created_by FROM observations WHERE patient_id = $1 AND label = $2 AND created_by = $3 ORDER BY created_at DESC LIMIT 1",
  [patientId, label, seedIds.clinician]);

describe("recording vitals", () => {
  it("stores each reading with the range it was read against and the flag that range produces", async () => {
    const written = await recordVitals(clinician(), { encounterId, readings: { systolic: "142", diastolic: "88", heart_rate: "72", temperature: "36.8" } });
    expect(written).toHaveLength(4);
    const systolic = await storedFor("Systolic blood pressure");
    expect(systolic.rows[0]).toMatchObject({ value: "142", unit: "mmHg", reference_low: "90", reference_high: "139", flag: "high", created_by: seedIds.clinician });
    const temperature = await storedFor("Temperature");
    expect(temperature.rows[0]).toMatchObject({ value: "36.8", flag: "normal" });
    const audit = await owner.query("SELECT purpose, outcome FROM audit_log WHERE action = 'clinical.observations_recorded' AND patient_id = $1", [patientId]);
    expect(audit.rows[0]).toMatchObject({ purpose: "clinical.write", outcome: "allowed" });
  });
  it("marks a reading past its critical bound as critical", async () => {
    await recordVitals(clinician(), { encounterId, readings: { oxygen_saturation: "88" } });
    const oxygen = await storedFor("Oxygen saturation");
    expect(oxygen.rows[0]).toMatchObject({ value: "88", flag: "critical" });
  });
  it("refuses a value that cannot be a reading, an unknown measurement, and an empty submission", async () => {
    await expect(recordVitals(clinician(), { encounterId, readings: { heart_rate: "900" } })).rejects.toBeInstanceOf(EncounterStateError);
    await expect(recordVitals(clinician(), { encounterId, readings: { heart_rate: "not a number" } })).rejects.toBeInstanceOf(EncounterStateError);
    await expect(recordVitals(clinician(), { encounterId, readings: { blood_colour: "7" } })).rejects.toBeInstanceOf(EncounterStateError);
    await expect(recordVitals(clinician(), { encounterId, readings: {} })).rejects.toBeInstanceOf(EncounterStateError);
    await expect(recordVitals(clinician(), { encounterId, readings: { heart_rate: "" } })).rejects.toBeInstanceOf(EncounterStateError);
    // Nothing from a rejected submission is written, including the readings that were valid.
    const count = await owner.query("SELECT count(*)::int AS count FROM observations WHERE patient_id = $1 AND label = 'Heart rate' AND created_by = $2", [patientId, seedIds.clinician]);
    expect(count.rows[0].count).toBe(1);
  });
  it("is closed to the front desk and to a clinician without clinical authority", async () => {
    await expect(recordVitals(staff(), { encounterId, readings: { heart_rate: "70" } })).rejects.toBeInstanceOf(EncounterStateError);
    await expect(recordVitals(clinician({ id: seedIds.secondClinician }), { encounterId, readings: { heart_rate: "70" } })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(recordVitals(clinician({ mfaVerified: false }), { encounterId, readings: { heart_rate: "70" } })).rejects.toBeInstanceOf(EncounterStateError);
  });
});

describe("problems and allergies", () => {
  it("adds a problem, resolves it, and refuses to resolve one twice", async () => {
    const problem = await addProblem(clinician(), { encounterId, description: "Community-acquired pneumonia" });
    expect(problem).toMatchObject({ description: "Community-acquired pneumonia", status: "active" });
    const resolved = await changeProblemStatus(clinician(), { encounterId, problemId: problem.id, status: "resolved" });
    expect(resolved.status).toBe("resolved");
    const audit = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'clinical.problem_resolved' AND patient_id = $1", [patientId]);
    expect(audit.rows[0].count).toBe(1);
    // A problem from another patient's chart cannot be reached through this encounter.
    const elsewhere = await owner.query("SELECT id FROM problems WHERE patient_id <> $1 LIMIT 1", [patientId]);
    await expect(changeProblemStatus(clinician(), { encounterId, problemId: elsewhere.rows[0].id, status: "resolved" })).rejects.toBeInstanceOf(EncounterStateError);
  });
  it("records an allergy with its severity and shows it on every later chart read", async () => {
    await recordAllergy(clinician(), { encounterId, substance: "Amoxicillin", reaction: "Angioedema", severity: "severe" });
    const chart = await getPatientChart(clinician(), patientId);
    expect(chart.allergies.some((allergy) => allergy.substance === "Amoxicillin" && allergy.severity === "severe")).toBe(true);
    await expect(recordAllergy(clinician(), { encounterId, substance: "X", reaction: "Rash", severity: "severe" })).rejects.toThrow();
    await expect(recordAllergy(clinician(), { encounterId, substance: "Codeine", reaction: "Nausea", severity: "unbearable" })).rejects.toThrow();
  });
  it("feeds what was recorded into the chart the visit reads", async () => {
    const chart = await getPatientChart(clinician(), patientId);
    expect(chart.observations.some((observation) => observation.label === "Systolic blood pressure" && observation.flag === "high")).toBe(true);
    expect(chart.problems.some((problem) => problem.description === "Community-acquired pneumonia" && problem.status === "resolved")).toBe(true);
  });
});

describe("a closed visit", () => {
  it("stops taking chart entries once the visit is complete", async () => {
    const note = await owner.query("SELECT id, revision FROM note_versions WHERE encounter_id = $1 ORDER BY version DESC LIMIT 1", [encounterId]);
    await owner.query("UPDATE note_versions SET content = $1 WHERE id = $2", ["Subjective: recorded for the chart entry suite.", note.rows[0].id]);
    const current = await owner.query("SELECT revision FROM note_versions WHERE id = $1", [note.rows[0].id]);
    await signNote(clinician(), { encounterId, versionId: note.rows[0].id, revision: current.rows[0].revision });
    await finishEncounter(clinician(), { encounterId, summary: "We measured your blood pressure and talked through the plan for the next two weeks." });
    await expect(recordVitals(clinician(), { encounterId, readings: { heart_rate: "70" } })).rejects.toBeInstanceOf(EncounterStateError);
    await expect(addProblem(clinician(), { encounterId, description: "Added after completion" })).rejects.toBeInstanceOf(EncounterStateError);
    await expect(recordAllergy(clinician(), { encounterId, substance: "Latex", reaction: "Rash", severity: "mild" })).rejects.toBeInstanceOf(EncounterStateError);
  });
});
