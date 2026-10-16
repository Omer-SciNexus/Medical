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
import { confirmDocumentUpload, listPatientDocuments, requestDocumentDownload, requestDocumentUpload, startEncounter } from "../../src/modules/clinical/service";
import { EncounterStateError } from "../../src/modules/clinical/validators";
import type { Actor } from "../../src/modules/identity/validators";

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
let owner: Client;
const clinicDay = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const mine = seedId(100);
const theirs = seedId(101);
const clinician = (overrides: Partial<Actor> = {}): Actor => ({ id: seedIds.clinician, clinicId: seedIds.clinic, role: "clinician", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now(), ...overrides });
const staff = (): Actor => ({ id: seedIds.staff, clinicId: seedIds.clinic, role: "staff", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now() });
const pdf = { kind: "result" as const, filename: "bloods.pdf", contentType: "application/pdf" as const, byteSize: 48_210 };
/** Stands in for the object store: the rule under test is what the server does with its answer. */
const stored = (overrides: Partial<{ byteSize: number; contentType: string }> = {}) =>
  async () => ({ byteSize: pdf.byteSize, contentType: pdf.contentType, ...overrides });
const missing = async () => undefined;

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
  process.env.MINIO_ENDPOINT = "http://127.0.0.1:9000";
  process.env.MINIO_ACCESS_KEY = "meridian-local";
  process.env.MINIO_SECRET_KEY = "local-object-store-only";
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

describe("attaching a document", () => {
  it("registers the row, signs a single upload, and shows nothing until the store is checked", async () => {
    const ticket = await requestDocumentUpload(clinician(), { patientId: mine, ...pdf });
    expect(ticket.uploadUrl).toContain("X-Amz-Signature=");
    expect(ticket.contentType).toBe("application/pdf");
    const row = await owner.query("SELECT patient_id, object_key, confirmed_at, created_by FROM documents WHERE id = $1", [ticket.documentId]);
    expect(row.rows[0]).toMatchObject({ patient_id: mine, confirmed_at: null, created_by: seedIds.clinician });
    // The key is namespaced by clinic and patient, and nothing in it is guessable.
    expect(row.rows[0].object_key.startsWith(`${seedIds.clinic}/${mine}/`)).toBe(true);
    expect(await listPatientDocuments(clinician(), mine)).toHaveLength(0);
    await confirmDocumentUpload(clinician(), { documentId: ticket.documentId }, stored());
    const documents = await listPatientDocuments(clinician(), mine);
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({ filename: "bloods.pdf", kind: "result", byteSize: pdf.byteSize });
    // Registering, storing and every read of the list are all recorded, in that order.
    const audit = await owner.query("SELECT action FROM audit_log WHERE patient_id = $1 AND action LIKE 'clinical.document%' ORDER BY seq", [mine]);
    expect(audit.rows.map((entry) => entry.action)).toEqual([
      "clinical.document_registered", "clinical.documents_read", "clinical.document_stored", "clinical.documents_read",
    ]);
  });
  it("discards an upload whose stored object is not what was attached", async () => {
    const wrongSize = await requestDocumentUpload(clinician(), { patientId: mine, ...pdf, filename: "wrong-size.pdf" });
    await expect(confirmDocumentUpload(clinician(), { documentId: wrongSize.documentId }, stored({ byteSize: 9 }))).rejects.toBeInstanceOf(EncounterStateError);
    expect((await owner.query("SELECT deleted_at FROM documents WHERE id = $1", [wrongSize.documentId])).rows[0].deleted_at).not.toBeNull();
    const wrongType = await requestDocumentUpload(clinician(), { patientId: mine, ...pdf, filename: "wrong-type.pdf" });
    await expect(confirmDocumentUpload(clinician(), { documentId: wrongType.documentId }, stored({ contentType: "text/html" }))).rejects.toBeInstanceOf(EncounterStateError);
    expect((await owner.query("SELECT deleted_at FROM documents WHERE id = $1", [wrongType.documentId])).rows[0].deleted_at).not.toBeNull();
    // Neither one joined the chart.
    expect((await listPatientDocuments(clinician(), mine)).map((document) => document.filename)).toEqual(["bloods.pdf"]);
  });
  it("refuses an upload that never arrived, and a second confirmation", async () => {
    const absent = await requestDocumentUpload(clinician(), { patientId: mine, ...pdf, filename: "never-sent.pdf" });
    await expect(confirmDocumentUpload(clinician(), { documentId: absent.documentId }, missing)).rejects.toBeInstanceOf(EncounterStateError);
    const once = await requestDocumentUpload(clinician(), { patientId: mine, ...pdf, filename: "once.pdf" });
    await confirmDocumentUpload(clinician(), { documentId: once.documentId }, stored());
    await expect(confirmDocumentUpload(clinician(), { documentId: once.documentId }, stored())).rejects.toBeInstanceOf(EncounterStateError);
  });
  it("refuses a type, a size and a filename the chart will not take", async () => {
    await expect(requestDocumentUpload(clinician(), { patientId: mine, ...pdf, contentType: "application/zip" })).rejects.toThrow();
    await expect(requestDocumentUpload(clinician(), { patientId: mine, ...pdf, byteSize: 26 * 1024 * 1024 })).rejects.toThrow();
    await expect(requestDocumentUpload(clinician(), { patientId: mine, ...pdf, byteSize: 0 })).rejects.toThrow();
    await expect(requestDocumentUpload(clinician(), { patientId: mine, ...pdf, filename: "../../etc/passwd" })).rejects.toThrow();
    await expect(requestDocumentUpload(clinician(), { patientId: mine, ...pdf, kind: "invoice" })).rejects.toThrow();
    // The table holds the same line, whatever reaches it.
    await expect(owner.query("INSERT INTO documents (clinic_id, created_by, updated_by, patient_id, kind, filename, content_type, byte_size, object_key) VALUES ($1,$2,$2,$3,'result','x.zip','application/zip',10,'k1')",
      [seedIds.clinic, seedIds.clinician, mine])).rejects.toThrow(/document_content_type/);
    await expect(owner.query("INSERT INTO documents (clinic_id, created_by, updated_by, patient_id, kind, filename, content_type, byte_size, object_key) VALUES ($1,$2,$2,$3,'result','x.pdf','application/pdf',99999999,'k2')",
      [seedIds.clinic, seedIds.clinician, mine])).rejects.toThrow(/document_size/);
  });
  it("can be attached to an open visit and refused on a closed one", async () => {
    const encounter = await startEncounter(clinician(), { appointmentId: seedId(400) });
    const attached = await requestDocumentUpload(clinician(), { patientId: mine, encounterId: encounter.id, ...pdf, filename: "consent.pdf", kind: "consent" });
    await confirmDocumentUpload(clinician(), { documentId: attached.documentId }, stored());
    const row = await owner.query("SELECT encounter_id FROM documents WHERE id = $1", [attached.documentId]);
    expect(row.rows[0].encounter_id).toBe(encounter.id);
    await owner.query("UPDATE encounters SET status = 'completed' WHERE id = $1", [encounter.id]);
    await expect(requestDocumentUpload(clinician(), { patientId: mine, encounterId: encounter.id, ...pdf, filename: "late.pdf" })).rejects.toBeInstanceOf(EncounterStateError);
  });
});

describe("opening a document", () => {
  it("signs a short-lived link and records the read like any other chart read", async () => {
    const [document] = await listPatientDocuments(clinician(), mine);
    const link = await requestDocumentDownload(clinician(), { documentId: document.id });
    expect(link.url).toContain("X-Amz-Signature=");
    expect(link.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 130_000);
    expect(link.filename).toBe(document.filename);
    const audit = await owner.query("SELECT purpose FROM audit_log WHERE action = 'clinical.document_opened' AND patient_id = $1", [mine]);
    expect(audit.rows[0].purpose).toBe("clinical.read");
  });
  it("is refused for a patient this clinician has no relationship with", async () => {
    await expect(requestDocumentUpload(clinician(), { patientId: theirs, ...pdf })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(listPatientDocuments(clinician(), theirs)).rejects.toBeInstanceOf(AccessDeniedError);
  });
  it("is refused to the front desk, which has no clinical purpose", async () => {
    const [document] = await listPatientDocuments(clinician(), mine);
    await expect(requestDocumentDownload(staff(), { documentId: document.id })).rejects.toBeInstanceOf(EncounterStateError);
    await expect(listPatientDocuments(staff(), mine)).rejects.toBeInstanceOf(EncounterStateError);
  });
  it("will not open an unconfirmed or discarded document", async () => {
    const pending = await requestDocumentUpload(clinician(), { patientId: mine, ...pdf, filename: "pending.pdf" });
    await expect(requestDocumentDownload(clinician(), { documentId: pending.documentId })).rejects.toBeInstanceOf(EncounterStateError);
    await owner.query("UPDATE documents SET deleted_at = now() WHERE id = $1", [pending.documentId]);
    await expect(requestDocumentDownload(clinician(), { documentId: pending.documentId })).rejects.toBeInstanceOf(EncounterStateError);
  });
});
