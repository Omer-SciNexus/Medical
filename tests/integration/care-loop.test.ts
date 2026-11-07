import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { Client } from "pg";
import type { Pool } from "pg";
import type Redis from "ioredis";
import { readFile } from "node:fs/promises";
import { migrateDatabase } from "../../scripts/migrate";
import { seedDatabase, seedId, seedIds } from "../../scripts/seed";
import { encryptSecret } from "../../src/modules/identity/crypto";
import { AccessScopeError, advanceAppointment, bookAppointment, closeFollowUp, getFollowUpWorklist, listMyFollowUps, listProviderAvailability, sendFollowUpReminderNow } from "../../src/modules/scheduling/service";
import { FollowUpError } from "../../src/modules/scheduling/validators";
import { finishEncounter, signNote, startEncounter } from "../../src/modules/clinical/service";
import { remindDueFollowUps, remindFollowUp } from "../../src/jobs/follow-ups";
import type { Actor } from "../../src/modules/identity/validators";

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
let owner: Client;
const clinicDay = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const patient = (index: number): Actor => ({ id: seedId(200 + index), clinicId: seedIds.clinic, role: "patient", patientId: seedId(100 + index), mfaVerified: false, authenticatedAt: Date.now(), mfaVerifiedAt: null });
const staffAccount = (id: string, role: Actor["role"]): Actor => ({ id, clinicId: seedIds.clinic, role, patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now() });
const clinician = () => staffAccount(seedIds.clinician, "clinician");
const staff = () => staffAccount(seedIds.staff, "staff");
const openSlots = (providerId = seedIds.clinician) => listProviderAvailability(patient(0), { providerId, days: 21 });
const statusOf = async (table: "follow_ups", id: string) => (await owner.query(`SELECT status FROM ${table} WHERE id = $1`, [id])).rows[0].status as string;
const revisionOf = async (appointmentId: string) => (await owner.query("SELECT revision FROM appointments WHERE id = $1", [appointmentId])).rows[0].revision as number;

/** A whole visit, from booking to the signed and completed encounter. */
async function completeVisit(index: number, plan: { followUpDays?: string; followUpNote?: string }) {
  const [slot] = await openSlots();
  const { id: appointmentId } = await bookAppointment(patient(index), { providerId: seedIds.clinician, slotId: slot.id, reason: "Blood pressure review" });
  for (const [revision, status] of [[1, "checked_in"], [2, "rooming"], [3, "ready"]] as const) await advanceAppointment(staff(), { appointmentId, revision, status });
  const encounter = await startEncounter(clinician(), { appointmentId, revision: 4 });
  const note = (await owner.query("SELECT id, revision FROM note_versions WHERE encounter_id = $1", [encounter.id])).rows[0];
  await signNote(clinician(), { encounterId: encounter.id, versionId: note.id, revision: note.revision, content: "Subjective: well. Plan: recheck the pressure." });
  await finishEncounter(clinician(), { encounterId: encounter.id, summary: "Your blood pressure was reviewed today.", ...plan });
  return encounter.id;
}

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
  const auditor = new URL(postgres.getConnectionUri()); auditor.username = "meridian_auditor"; auditor.password = "local-audit-only"; process.env.AUDIT_DATABASE_URL = auditor.toString();
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

afterEach(() => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

describe("follow-up plans", () => {
  it("records the plan with the visit and shows the note to the patient but not the front desk", async () => {
    const encounterId = await completeVisit(12, { followUpDays: "90", followUpNote: "Recheck your blood pressure" });
    const [mine] = await listMyFollowUps(patient(12));
    expect(mine).toMatchObject({ providerId: seedIds.clinician, note: "Recheck your blood pressure" });
    expect(Date.parse(mine.dueOn)).toBeGreaterThan(Date.now() + 85 * 86_400_000);
    const row = (await getFollowUpWorklist(staff())).followUps.find((candidate) => candidate.id === mine.id);
    expect(row).toMatchObject({ mrn: "MR-2493", givenName: "Omar" });
    expect(row).not.toHaveProperty("note");
    const outbox = await owner.query("SELECT count(*)::int AS count FROM outbox WHERE topic = 'follow_up.planned' AND resource_id = $1", [mine.id]);
    expect(outbox.rows[0].count).toBe(1);
    expect((await owner.query("SELECT encounter_id FROM follow_ups WHERE id = $1", [mine.id])).rows[0].encounter_id).toBe(encounterId);
  });
  it("plans nothing when none is chosen", async () => {
    await completeVisit(14, {});
    expect(await listMyFollowUps(patient(14))).toEqual([]);
  });
  it("refuses a note with no date, and leaves the visit open", async () => {
    const [slot] = await openSlots();
    const { id: appointmentId } = await bookAppointment(patient(16), { providerId: seedIds.clinician, slotId: slot.id, reason: "Review" });
    for (const [revision, status] of [[1, "checked_in"], [2, "rooming"], [3, "ready"]] as const) await advanceAppointment(staff(), { appointmentId, revision, status });
    const encounter = await startEncounter(clinician(), { appointmentId, revision: 4 });
    await expect(finishEncounter(clinician(), { encounterId: encounter.id, summary: "Your visit went well, thank you.", followUpNote: "Recheck", followUpDays: "" })).rejects.toThrow();
    await expect(finishEncounter(clinician(), { encounterId: encounter.id, summary: "Your visit went well, thank you.", followUpDays: "13" })).rejects.toThrow();
    expect((await owner.query("SELECT status FROM encounters WHERE id = $1", [encounter.id])).rows[0].status).toBe("in_progress");
  });
  it("is satisfied by booking with that clinician, and comes back if that visit is cancelled", async () => {
    await completeVisit(18, { followUpDays: "30" });
    const [followUp] = await listMyFollowUps(patient(18));
    const [slot] = await openSlots();
    const { id: appointmentId } = await bookAppointment(patient(18), { providerId: seedIds.clinician, slotId: slot.id, reason: "Follow-up visit" });
    expect(await statusOf("follow_ups", followUp.id)).toBe("booked");
    expect(await listMyFollowUps(patient(18))).toEqual([]);
    await advanceAppointment(patient(18), { appointmentId, revision: await revisionOf(appointmentId), status: "cancelled" });
    expect((await listMyFollowUps(patient(18))).map((row) => row.id)).toEqual([followUp.id]);
  });
  it("comes back if the patient misses the visit", async () => {
    await completeVisit(20, { followUpDays: "30" });
    const [followUp] = await listMyFollowUps(patient(20));
    const [slot] = await openSlots();
    const { id: appointmentId } = await bookAppointment(patient(20), { providerId: seedIds.clinician, slotId: slot.id, reason: "Follow-up visit" });
    await advanceAppointment(staff(), { appointmentId, revision: await revisionOf(appointmentId), status: "no_show" });
    expect(await statusOf("follow_ups", followUp.id)).toBe("pending");
  });
  it("is not satisfied by seeing a different clinician", async () => {
    await completeVisit(22, { followUpDays: "30" });
    const [slot] = await openSlots(seedIds.secondClinician);
    await bookAppointment(patient(22), { providerId: seedIds.secondClinician, slotId: slot.id, reason: "Something else" });
    expect(await listMyFollowUps(patient(22))).toHaveLength(1);
  });
  it("can be closed by the front desk, once, and not by a patient", async () => {
    await completeVisit(24, { followUpDays: "30" });
    const [followUp] = await listMyFollowUps(patient(24));
    await expect(closeFollowUp(patient(24), { followUpId: followUp.id, reason: "Patient declined" })).rejects.toBeInstanceOf(AccessScopeError);
    await expect(closeFollowUp(staff(), { followUpId: followUp.id, reason: "Because" })).rejects.toThrow();
    await closeFollowUp(staff(), { followUpId: followUp.id, reason: "Patient declined" });
    expect(await listMyFollowUps(patient(24))).toEqual([]);
    await expect(closeFollowUp(staff(), { followUpId: followUp.id, reason: "Patient declined" })).rejects.toBeInstanceOf(FollowUpError);
  });
  it("reminds a week before the date, once, and keeps the note out of the mail", async () => {
    vi.stubEnv("MAIL_API_KEY", "synthetic-provider-key");
    const fetcher = vi.fn().mockImplementation(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    await completeVisit(26, { followUpDays: "7", followUpNote: "Recheck your blood pressure" });
    await completeVisit(28, { followUpDays: "90" });
    const [soon] = await listMyFollowUps(patient(26));
    const [later] = await listMyFollowUps(patient(28));
    expect(await remindFollowUp(seedIds.clinic, later.id)).toMatchObject({ sent: false, reason: "not due" });
    expect(await remindFollowUp(seedIds.clinic, soon.id)).toMatchObject({ sent: true });
    expect(await remindFollowUp(seedIds.clinic, soon.id)).toMatchObject({ sent: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(sent.to).toBe("portal.2507@example.test");
    expect(`${sent.subject} ${sent.text}`).not.toContain("blood pressure");
  });
  it("sweeps up what is coming due, and one failed delivery does not stop the rest", async () => {
    vi.stubEnv("MAIL_API_KEY", "synthetic-provider-key");
    await owner.query("UPDATE follow_ups SET reminded_at = now() WHERE status = 'pending'");
    await completeVisit(30, { followUpDays: "7" });
    await completeVisit(32, { followUpDays: "7" });
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(null, { status: (calls += 1) === 1 ? 503 : 200 })));
    expect(await remindDueFollowUps()).toEqual({ due: 2, sent: 1 });
    expect(await remindDueFollowUps()).toEqual({ due: 1, sent: 1 });
  });
  it("lets the front desk ask for another reminder, at most once a day", async () => {
    await completeVisit(34, { followUpDays: "90" });
    const [followUp] = await listMyFollowUps(patient(34));
    await sendFollowUpReminderNow(staff(), { followUpId: followUp.id });
    await sendFollowUpReminderNow(staff(), { followUpId: followUp.id });
    const outbox = await owner.query("SELECT count(*)::int AS count FROM outbox WHERE topic = 'follow_up.remind' AND resource_id = $1", [followUp.id]);
    expect(outbox.rows[0].count).toBe(1);
    await owner.query("UPDATE follow_ups SET reminded_at = now() WHERE id = $1", [followUp.id]);
    await expect(sendFollowUpReminderNow(staff(), { followUpId: followUp.id })).rejects.toBeInstanceOf(FollowUpError);
  });
});
