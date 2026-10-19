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
import { cancelPrescription, checkPrescription, draftPrescription, findMedications, getPrescribingWorkspace, issuePrescription, recordAllergy, startEncounter } from "../../src/modules/clinical/service";
import { EncounterStateError } from "../../src/modules/clinical/validators";
import { FIXTURE_SOURCE } from "../../src/modules/clinical/safety";
import type { Actor } from "../../src/modules/identity/validators";

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
let owner: Client;
const clinicDay = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const clinician = (overrides: Partial<Actor> = {}): Actor => ({ id: seedIds.clinician, clinicId: seedIds.clinic, role: "clinician", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now(), ...overrides });
const staff = (): Actor => ({ id: seedIds.staff, clinicId: seedIds.clinic, role: "staff", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now() });
// Patient 100 is seeded with a penicillin allergy, which is what makes a hard stop reachable.
const appointmentId = seedId(400);
const patientId = seedId(100);
let encounterId: string;
const medicationId = async (name: string) => (await owner.query("SELECT id FROM medications WHERE name = $1", [name])).rows[0].id as string;
const row = async (prescriptionId: string) => (await owner.query("SELECT status, safety_status, safety_source, safety_findings, override_reason, issued_at FROM prescriptions WHERE id = $1", [prescriptionId])).rows[0];
const standardCourse = { dose: 500, unit: "mg" as const, route: "oral" as const, frequency: "twice daily" as const, durationDays: 7 };

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
  delete process.env.SAFETY_API_URL;
  delete process.env.SAFETY_PROVIDER_NAME;
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

describe("drafting a prescription", () => {
  it("is open to a clinician with prescribing authority and nobody else", async () => {
    const paracetamol = await medicationId("Paracetamol");
    await expect(draftPrescription(staff(), { encounterId, medicationId: paracetamol, ...standardCourse })).rejects.toBeInstanceOf(EncounterStateError);
    await expect(draftPrescription(clinician({ id: seedIds.secondClinician }), { encounterId, medicationId: paracetamol, ...standardCourse })).rejects.toBeInstanceOf(AccessDeniedError);
    const drafted = await draftPrescription(clinician(), { encounterId, medicationId: paracetamol, ...standardCourse });
    expect(await row(drafted.id)).toMatchObject({ status: "draft", safety_status: "unchecked", safety_source: null, issued_at: null });
    const audit = await owner.query("SELECT purpose FROM audit_log WHERE action = 'clinical.prescription_drafted' AND patient_id = $1", [patientId]);
    expect(audit.rows[0].purpose).toBe("prescribe");
  });
  it("refuses a dose, course or medicine that makes no sense", async () => {
    const paracetamol = await medicationId("Paracetamol");
    await expect(draftPrescription(clinician(), { encounterId, medicationId: paracetamol, ...standardCourse, dose: 0 })).rejects.toThrow();
    await expect(draftPrescription(clinician(), { encounterId, medicationId: paracetamol, ...standardCourse, durationDays: 0 })).rejects.toThrow();
    await expect(draftPrescription(clinician(), { encounterId, medicationId: paracetamol, ...standardCourse, unit: "spoonful" })).rejects.toThrow();
    await expect(draftPrescription(clinician(), { encounterId, medicationId: seedId(999), ...standardCourse })).rejects.toBeInstanceOf(EncounterStateError);
  });
  it("searches the catalogue by name and ingredient", async () => {
    await expect(findMedications(clinician(), { term: "amox" })).resolves.toHaveLength(1);
    await expect(findMedications(clinician(), { term: "metformin" })).resolves.toHaveLength(1);
    await expect(findMedications(clinician(), { term: "z" })).rejects.toThrow();
  });
});

describe("the safety boundary", () => {
  it("cannot issue anything the fixture cleared, because the database refuses its source", async () => {
    const drafted = await draftPrescription(clinician(), { encounterId, medicationId: await medicationId("Metformin"), ...standardCourse });
    const verdict = await checkPrescription(clinician(), { prescriptionId: drafted.id });
    expect(verdict).toMatchObject({ status: "clear", source: FIXTURE_SOURCE });
    const checked = await row(drafted.id);
    expect(checked).toMatchObject({ safety_status: "clear", safety_source: FIXTURE_SOURCE });
    expect(checked.safety_findings.length).toBeGreaterThan(0);
    await expect(issuePrescription(clinician(), { prescriptionId: drafted.id })).rejects.toBeInstanceOf(EncounterStateError);
    expect((await row(drafted.id)).status).toBe("draft");
    // The constraint, not the service, is what makes that impossible.
    await expect(owner.query("UPDATE prescriptions SET status = 'issued', issued_at = now() WHERE id = $1", [drafted.id])).rejects.toThrow(/issued_requires_safety/);
  });
  it("makes an allergy match a hard stop that no override can pass", async () => {
    const drafted = await draftPrescription(clinician(), { encounterId, medicationId: await medicationId("Amoxicillin"), ...standardCourse });
    // The seeded chart records a penicillin allergy; amoxicillin is checked against it.
    await recordAllergy(clinician(), { encounterId, substance: "amoxicillin", reaction: "Anaphylaxis", severity: "severe" });
    const verdict = await checkPrescription(clinician(), { prescriptionId: drafted.id });
    expect(verdict.status).toBe("blocked");
    expect(verdict.findings.join(" ")).toContain("allergy");
    await expect(issuePrescription(clinician(), { prescriptionId: drafted.id, overrideReason: "The patient says the reaction was mild and long ago." })).rejects.toBeInstanceOf(EncounterStateError);
    expect((await row(drafted.id)).status).toBe("draft");
    await expect(owner.query("UPDATE prescriptions SET status = 'issued', issued_at = now(), safety_checked_at = now(), safety_source = 'real-service', override_reason = 'A reason long enough to pass the length check.' WHERE id = $1", [drafted.id]))
      .rejects.toThrow(/issued_requires_safety/);
  });
  it("will not issue before a check has run, or after the check went stale", async () => {
    const drafted = await draftPrescription(clinician(), { encounterId, medicationId: await medicationId("Ramipril"), ...standardCourse });
    await expect(issuePrescription(clinician(), { prescriptionId: drafted.id })).rejects.toBeInstanceOf(EncounterStateError);
    await checkPrescription(clinician(), { prescriptionId: drafted.id });
    // A concurrent re-check moves the verdict; issuing against the old one matches no row.
    await owner.query("UPDATE prescriptions SET safety_status = 'warning' WHERE id = $1", [drafted.id]);
    await expect(issuePrescription(clinician(), { prescriptionId: drafted.id })).rejects.toBeInstanceOf(EncounterStateError);
  });
});

describe("with a real safety service configured", () => {
  // The service name is what the constraint cares about, so this stands in for one.
  const asRealProvider = async (work: () => Promise<void>) => {
    process.env.SAFETY_PROVIDER_NAME = "integration-safety-service";
    try { await work(); } finally { delete process.env.SAFETY_PROVIDER_NAME; }
  };
  it("issues a cleared prescription and records it", async () => {
    await asRealProvider(async () => {
      const drafted = await draftPrescription(clinician(), { encounterId, medicationId: await medicationId("Levothyroxine"), ...standardCourse, dose: 50, unit: "micrograms" });
      await owner.query("UPDATE prescriptions SET safety_status = 'clear', safety_source = 'integration-safety-service', safety_checked_at = now(), safety_findings = ARRAY['Cleared by the integration service.'] WHERE id = $1", [drafted.id]);
      const issued = await issuePrescription(clinician(), { prescriptionId: drafted.id });
      expect(issued.status).toBe("issued");
      expect(await row(drafted.id)).toMatchObject({ status: "issued", safety_source: "integration-safety-service", override_reason: null });
      const audit = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'clinical.prescription_issued' AND patient_id = $1", [patientId]);
      expect(audit.rows[0].count).toBe(1);
    });
  });
  it("needs a fresh authenticator check and a written justification to override a warning", async () => {
    await asRealProvider(async () => {
      const drafted = await draftPrescription(clinician(), { encounterId, medicationId: await medicationId("Amlodipine"), ...standardCourse, dose: 5 });
      await owner.query("UPDATE prescriptions SET safety_status = 'warning', safety_source = 'integration-safety-service', safety_checked_at = now(), safety_findings = ARRAY['Duplicate therapy.'] WHERE id = $1", [drafted.id]);
      const stale = clinician({ mfaVerifiedAt: Date.now() - 10 * 60_000 });
      await expect(issuePrescription(stale, { prescriptionId: drafted.id, overrideReason: "A justification that is comfortably long enough." })).rejects.toBeInstanceOf(EncounterStateError);
      await expect(issuePrescription(clinician(), { prescriptionId: drafted.id })).rejects.toBeInstanceOf(EncounterStateError);
      await expect(issuePrescription(clinician(), { prescriptionId: drafted.id, overrideReason: "too short" })).rejects.toBeInstanceOf(EncounterStateError);
      expect((await row(drafted.id)).status).toBe("draft");
      const reason = "Known duplicate while the previous course is tapered, agreed with the patient.";
      await issuePrescription(clinician(), { prescriptionId: drafted.id, overrideReason: reason });
      expect(await row(drafted.id)).toMatchObject({ status: "issued", override_reason: reason });
    });
  });
  it("rejects an expired result and a chart changed after checking", async () => {
    await asRealProvider(async () => {
      const drafted = await draftPrescription(clinician(), { encounterId, medicationId: await medicationId("Paracetamol"), ...standardCourse });
      await owner.query("UPDATE prescriptions SET safety_status='clear', safety_source='integration-safety-service', safety_checked_at=now()-interval '16 minutes' WHERE id=$1", [drafted.id]);
      await expect(issuePrescription(clinician(), { prescriptionId: drafted.id })).rejects.toBeInstanceOf(EncounterStateError);
      await owner.query("UPDATE prescriptions SET safety_checked_at=now() WHERE id=$1", [drafted.id]);
      await recordAllergy(clinician(), { encounterId, substance: "latex", reaction: "Skin rash", severity: "mild" });
      await expect(issuePrescription(clinician(), { prescriptionId: drafted.id })).rejects.toBeInstanceOf(EncounterStateError);
      expect((await row(drafted.id)).status).toBe("draft");
      await owner.query("UPDATE prescriptions SET safety_checked_at=now() WHERE id=$1", [drafted.id]);
      await expect(issuePrescription(clinician(), { prescriptionId: drafted.id })).resolves.toMatchObject({ status: "issued" });
    });
  });
  it("refuses to issue twice, and cancelling leaves the issued one alone", async () => {
    await asRealProvider(async () => {
      const issued = await owner.query("SELECT id FROM prescriptions WHERE status = 'issued' LIMIT 1");
      await expect(issuePrescription(clinician(), { prescriptionId: issued.rows[0].id })).rejects.toBeInstanceOf(EncounterStateError);
      const drafted = await draftPrescription(clinician(), { encounterId, medicationId: await medicationId("Paracetamol"), ...standardCourse });
      await cancelPrescription(clinician(), { prescriptionId: drafted.id });
      expect((await row(drafted.id)).status).toBe("cancelled");
      await expect(cancelPrescription(clinician(), { prescriptionId: drafted.id })).rejects.toBeInstanceOf(EncounterStateError);
      await expect(issuePrescription(clinician(), { prescriptionId: drafted.id })).rejects.toBeInstanceOf(EncounterStateError);
    });
  });
});

describe("the prescribing workspace", () => {
  it("shows this visit's prescriptions, the chart they were checked against, and the provider in use", async () => {
    const workspace = await getPrescribingWorkspace(clinician(), encounterId);
    expect(workspace.provider).toEqual({ name: FIXTURE_SOURCE, fixture: true });
    expect(workspace.prescriptions.length).toBeGreaterThan(3);
    expect(workspace.chart.allergies.length).toBeGreaterThan(0);
    expect(workspace.prescriptions.some((prescription) => prescription.status === "issued")).toBe(true);
    await expect(getPrescribingWorkspace(staff(), encounterId)).rejects.toBeInstanceOf(EncounterStateError);
  });
});
