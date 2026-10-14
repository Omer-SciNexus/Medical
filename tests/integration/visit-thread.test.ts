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
import { verifyAuditChain } from "../../src/modules/identity/repository";
import { AccessDeniedError } from "../../src/modules/identity/service";
import { advanceAppointment, bookAppointment, getClinicianQueue, getPatientIdentity, listProviderAvailability } from "../../src/modules/scheduling/service";
import { SlotUnavailableError } from "../../src/modules/scheduling/validators";
import { amendNote, finishEncounter, getVisitSummary, saveNote, signNote, startEncounter } from "../../src/modules/clinical/service";
import { EncounterStateError, NoteConflictError } from "../../src/modules/clinical/validators";
import type { Actor } from "../../src/modules/identity/validators";

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
let owner: Client;
const password = "integration-test-password-only";
// Seeding a day ahead keeps every generated slot in the future, so booking is exercisable.
const clinicDay = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

const clinician = (overrides: Partial<Actor> = {}): Actor => ({ id: seedIds.clinician, clinicId: seedIds.clinic, role: "clinician", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now(), ...overrides });
const staff = (): Actor => ({ id: seedIds.staff, clinicId: seedIds.clinic, role: "staff", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now() });
const patient = (index: number): Actor => ({ id: seedId(200 + index), clinicId: seedIds.clinic, role: "patient", patientId: seedId(100 + index), mfaVerified: false, authenticatedAt: Date.now(), mfaVerifiedAt: null });

beforeAll(async () => {
  postgres = await new PostgreSqlContainer("postgres:17-alpine").withDatabase("meridian").withUsername("meridian_owner").withPassword("test-owner-password").start();
  redis = await new RedisContainer("redis:7-alpine").start();
  owner = new Client({ connectionString: postgres.getConnectionUri() }); await owner.connect();
  await owner.query(await readFile("scripts/init-db.sql", "utf8"));
  await migrateDatabase(postgres.getConnectionUri());
  await seedDatabase(postgres.getConnectionUri(), password, clinicDay);
  process.env.AUTH_PEPPER = "integration-test-only-pepper-32-characters";
  process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.CLINIC_TIMEZONE = "Europe/Istanbul";
  const app = new URL(postgres.getConnectionUri()); app.username = "meridian_app"; app.password = "local-app-only";
  const auditor = new URL(postgres.getConnectionUri()); auditor.username = "meridian_auditor"; auditor.password = "local-audit-only";
  process.env.DATABASE_URL = app.toString();
  process.env.AUDIT_DATABASE_URL = auditor.toString();
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

describe("transactional booking", () => {
  it("claims a free slot and records an audited appointment", async () => {
    const slots = await listProviderAvailability(patient(20), { providerId: seedIds.clinician, days: 21 });
    expect(slots.length).toBeGreaterThan(0);
    const appointment = await bookAppointment(patient(20), { providerId: seedIds.clinician, slotId: slots[0].id, reason: "New patient consultation" });
    expect(appointment.id).toMatch(/^[0-9a-f-]{36}$/);
    const audit = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'scheduling.appointment_booked' AND patient_id = $1", [seedId(120)]);
    expect(audit.rows[0].count).toBe(1);
  });
  it("gives the slot to exactly one of two simultaneous bookings", async () => {
    const slots = await listProviderAvailability(patient(22), { providerId: seedIds.clinician, days: 21 });
    const contested = slots[0].id;
    const results = await Promise.allSettled([
      bookAppointment(patient(22), { providerId: seedIds.clinician, slotId: contested, reason: "Simultaneous booking A" }),
      bookAppointment(patient(24), { providerId: seedIds.clinician, slotId: contested, reason: "Simultaneous booking B" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(SlotUnavailableError);
    const rows = await owner.query("SELECT count(*)::int AS count FROM appointments WHERE slot_id = $1 AND status <> 'cancelled' AND deleted_at IS NULL", [contested]);
    expect(rows.rows[0].count).toBe(1);
  });
  it("refuses a slot that is already claimed and one in the past", async () => {
    const taken = await owner.query("SELECT slot_id FROM appointments WHERE deleted_at IS NULL LIMIT 1");
    await expect(bookAppointment(patient(26), { providerId: seedIds.clinician, slotId: taken.rows[0].slot_id, reason: "Should not be bookable" })).rejects.toThrow();
    const past = await owner.query("INSERT INTO availability_slots (clinic_id,created_by,updated_by,provider_id,starts_at,ends_at) VALUES ($1,$2,$2,$3,now() - interval '2 hours', now() - interval '100 minutes') RETURNING id",
      [seedIds.clinic, seedIds.system, seedIds.clinician]);
    await expect(bookAppointment(patient(26), { providerId: seedIds.clinician, slotId: past.rows[0].id, reason: "A time that has already passed" })).rejects.toBeInstanceOf(SlotUnavailableError);
  });
  it("scopes the clinician queue to their own sessions and audits the read", async () => {
    const queue = await getClinicianQueue(clinician(), { day: clinicDay });
    expect(queue.entries.length).toBeGreaterThan(0);
    const providers = await owner.query("SELECT DISTINCT s.provider_id FROM appointments a JOIN availability_slots s ON s.id = a.slot_id WHERE a.id = ANY($1::uuid[])", [queue.entries.map((entry) => entry.id)]);
    expect(providers.rows).toEqual([{ provider_id: seedIds.clinician }]);
    const audit = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'scheduling.queue_read'");
    expect(audit.rows[0].count).toBeGreaterThan(0);
  });
});

describe("the complete visit thread", () => {
  const appointmentId = seedId(406);
  let encounterId: string;
  it("moves the patient through the waiting room under server-side rules", async () => {
    await advanceAppointment(staff(), { appointmentId, revision: 1, status: "checked_in" });
    await advanceAppointment(staff(), { appointmentId, revision: 2, status: "rooming" });
    await advanceAppointment(staff(), { appointmentId, revision: 3, status: "ready" });
    // Staff may run the waiting room but not start the visit itself.
    await expect(advanceAppointment(staff(), { appointmentId, revision: 4, status: "in_progress" })).rejects.toThrow();
    await advanceAppointment(clinician(), { appointmentId, revision: 4, status: "in_progress" });
    const row = await owner.query("SELECT status, revision FROM appointments WHERE id = $1", [appointmentId]);
    expect(row.rows[0]).toEqual({ status: "in_progress", revision: 5 });
  });
  it("rejects a transition that skips a step or uses a stale revision", async () => {
    await expect(advanceAppointment(clinician(), { appointmentId, revision: 5, status: "checked_in" })).rejects.toThrow();
    await expect(advanceAppointment(clinician(), { appointmentId, revision: 2, status: "done" })).rejects.toThrow();
  });
  it("opens one encounter per appointment, however many times it is started", async () => {
    const first = await startEncounter(clinician(), { appointmentId });
    const second = await startEncounter(clinician(), { appointmentId });
    expect(second.id).toBe(first.id);
    encounterId = first.id;
    const notes = await owner.query("SELECT count(*)::int AS count FROM note_versions WHERE encounter_id = $1", [encounterId]);
    expect(notes.rows[0].count).toBe(1);
  });
  it("autosaves the note and refuses a write from a stale editor", async () => {
    const note = await owner.query("SELECT id, revision FROM note_versions WHERE encounter_id = $1", [encounterId]);
    const { id: versionId, revision } = note.rows[0];
    const saved = await saveNote(clinician(), { encounterId, versionId, revision, content: "Subjective: reports intermittent headache for two weeks." });
    expect(saved.revision).toBe(revision + 1);
    // A second editor still holding the old revision must not overwrite the newer text.
    await expect(saveNote(clinician(), { encounterId, versionId, revision, content: "Overwritten by a stale tab." })).rejects.toBeInstanceOf(NoteConflictError);
    const stored = await owner.query("SELECT content FROM note_versions WHERE id = $1", [versionId]);
    expect(stored.rows[0].content).toContain("intermittent headache");
  });
  it("freezes the signed version and keeps its text through an amendment", async () => {
    const note = await owner.query("SELECT id, revision FROM note_versions WHERE encounter_id = $1 ORDER BY version DESC LIMIT 1", [encounterId]);
    await signNote(clinician(), { encounterId, versionId: note.rows[0].id, revision: note.rows[0].revision });
    const signed = await owner.query("SELECT status, signed_by, revision FROM note_versions WHERE id = $1", [note.rows[0].id]);
    expect(signed.rows[0].status).toBe("signed");
    expect(signed.rows[0].signed_by).toBe(seedIds.clinician);
    await expect(saveNote(clinician(), { encounterId, versionId: note.rows[0].id, revision: signed.rows[0].revision, content: "Editing after signature." })).rejects.toBeInstanceOf(NoteConflictError);
    await amendNote(clinician(), { encounterId, versionId: note.rows[0].id, revision: signed.rows[0].revision, content: "Subjective: corrected to four weeks of headache.", reason: "Corrected the reported duration of symptoms." });
    const versions = await owner.query("SELECT version, status, content, amendment_reason, previous_version_id FROM note_versions WHERE encounter_id = $1 ORDER BY version", [encounterId]);
    expect(versions.rows).toHaveLength(2);
    expect(versions.rows[0].status).toBe("amended");
    expect(versions.rows[0].content).toContain("intermittent headache");
    expect(versions.rows[1].previous_version_id).toBe(note.rows[0].id);
    expect(versions.rows[1].amendment_reason).toContain("Corrected");
    expect(versions.rows[1].status).toBe("draft");
  });
  it("requires the amendment to be signed in its own right before the visit can complete", async () => {
    // An amendment does not inherit the previous signature, so the visit is not billable yet.
    await expect(finishEncounter(clinician(), { encounterId, summary: "Attempting to complete on an unsigned amendment." })).rejects.toBeInstanceOf(EncounterStateError);
    const amended = await owner.query("SELECT id, revision FROM note_versions WHERE encounter_id = $1 ORDER BY version DESC LIMIT 1", [encounterId]);
    await signNote(clinician(), { encounterId, versionId: amended.rows[0].id, revision: amended.rows[0].revision });
    const signed = await owner.query("SELECT status, signed_by FROM note_versions WHERE id = $1", [amended.rows[0].id]);
    expect(signed.rows[0]).toMatchObject({ status: "signed", signed_by: seedIds.clinician });
  });
  it("records exactly one charge however many times completion is submitted", async () => {
    const summary = "We talked about your headaches and agreed to review your blood pressure readings at home over the next two weeks.";
    const first = await finishEncounter(clinician(), { encounterId, summary });
    expect(first.repeated).toBe(false);
    expect(first.charge?.amountMinor).toBe(150_000);
    const again = await finishEncounter(clinician(), { encounterId, summary: `${summary} Resubmitted.` });
    expect(again.repeated).toBe(true);
    const charges = await owner.query("SELECT count(*)::int AS count FROM charges WHERE encounter_id = $1", [encounterId]);
    expect(charges.rows[0].count).toBe(1);
    const appointment = await owner.query("SELECT status FROM appointments WHERE id = $1", [appointmentId]);
    expect(appointment.rows[0].status).toBe("done");
    const outbox = await owner.query("SELECT topic FROM outbox WHERE resource_id = $1 ORDER BY topic", [encounterId]);
    expect(outbox.rows.map((row) => row.topic)).toEqual(["encounter.completed", "visit_summary.published"]);
  });
  it("publishes the summary to its own patient and nobody else", async () => {
    const visit = await getVisitSummary(patient(6), encounterId);
    expect(visit.summary.published).toBe(true);
    expect(visit.summary.summary).toContain("blood pressure readings at home");
    await expect(getVisitSummary(patient(7), encounterId)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(getVisitSummary(clinician({ id: seedIds.secondClinician }), encounterId)).rejects.toBeInstanceOf(AccessDeniedError);
  });
  it("refuses to complete a visit whose note was never signed", async () => {
    const other = await startEncounter(clinician(), { appointmentId: seedId(408) });
    await expect(finishEncounter(clinician(), { encounterId: other.id, summary: "Trying to bill an unsigned visit record." })).rejects.toThrow();
    const charges = await owner.query("SELECT count(*)::int AS count FROM charges WHERE encounter_id = $1", [other.id]);
    expect(charges.rows[0].count).toBe(0);
  });
});

describe("audit chain", () => {
  it("keeps seq order and chain order identical when events are written concurrently", async () => {
    // This is the case that broke the chain: the seq column's sequence default is evaluated
    // before the chaining trigger takes its lock, so two writers could take seq values in
    // one order and the lock in the other, leaving a lower seq chained onto a higher one.
    await Promise.all([0, 2, 4, 6, 8, 10, 12, 14].map((index) => getPatientIdentity(clinician(), seedId(100 + index))));
    expect((await verifyAuditChain()).brokenSeq).toBeNull();
  });
  it("chains every event and verifies the whole log", async () => {
    const result = await verifyAuditChain();
    expect(result.checked).toBeGreaterThan(10);
    expect(result.brokenSeq).toBeNull();
    const unchained = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE hash IS NULL");
    expect(unchained.rows[0].count).toBe(0);
    const first = await owner.query("SELECT prev_hash FROM audit_log ORDER BY seq LIMIT 1");
    expect(first.rows[0].prev_hash).toBeNull();
    // seq now comes from the highest committed row inside the lock, so it is contiguous
    // from 1: a rolled-back transaction consumes no value the way a sequence would.
    const shape = await owner.query("SELECT count(*)::int AS total, min(seq)::int AS lowest, max(seq)::int AS highest FROM audit_log");
    expect(shape.rows[0].lowest).toBe(1);
    expect(shape.rows[0].highest).toBe(shape.rows[0].total);
  });
  it("detects a row altered by the table owner, which append-only grants alone cannot", async () => {
    // The owner can bypass the append-only trigger; the chain is what makes that visible.
    const target = await owner.query("SELECT seq FROM audit_log ORDER BY seq OFFSET 2 LIMIT 1");
    const seq = Number(target.rows[0].seq);
    await owner.query("ALTER TABLE audit_log DISABLE TRIGGER audit_no_mutation");
    await owner.query("UPDATE audit_log SET action = 'tampered' WHERE seq = $1", [seq]);
    await owner.query("ALTER TABLE audit_log ENABLE TRIGGER audit_no_mutation");
    const result = await verifyAuditChain();
    expect(result.brokenSeq).toBe(seq);
  });
});
