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
import { AccessDeniedError, getMyRecordAccess, requestBreakGlass } from "../../src/modules/identity/service";
import { AccessScopeError, acceptWaitlistOffer, advanceAppointment, bookAppointment, closeFollowUp, getClinicReport, getFollowUpWorklist, joinWaitlist, leaveWaitlist, listMyFollowUps, listMyWaitlist, listProviderAvailability, reschedulePatientAppointment, sendFollowUpReminderNow } from "../../src/modules/scheduling/service";
import { FollowUpError, SlotUnavailableError, WaitlistError } from "../../src/modules/scheduling/validators";
import { finishEncounter, getPatientChart, signNote, startEncounter } from "../../src/modules/clinical/service";
import { remindDueFollowUps, remindFollowUp } from "../../src/jobs/follow-ups";
import { sendWaitlistOffer } from "../../src/jobs/waitlist";
import type { Actor } from "../../src/modules/identity/validators";

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
let owner: Client;
const clinicDay = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const patient = (index: number): Actor => ({ id: seedId(200 + index), clinicId: seedIds.clinic, role: "patient", patientId: seedId(100 + index), mfaVerified: false, authenticatedAt: Date.now(), mfaVerifiedAt: null });
const staffAccount = (id: string, role: Actor["role"]): Actor => ({ id, clinicId: seedIds.clinic, role, patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now() });
const clinician = () => staffAccount(seedIds.clinician, "clinician");
const otherClinician = () => staffAccount(seedIds.secondClinician, "clinician");
const staff = () => staffAccount(seedIds.staff, "staff");
const admin = () => staffAccount(seedIds.admin, "admin");
const openSlots = (providerId = seedIds.clinician) => listProviderAvailability(patient(0), { providerId, days: 21 });
const statusOf = async (table: "follow_ups" | "waitlist_entries", id: string) => (await owner.query(`SELECT status FROM ${table} WHERE id = $1`, [id])).rows[0].status as string;
const revisionOf = async (appointmentId: string) => (await owner.query("SELECT revision FROM appointments WHERE id = $1", [appointmentId])).rows[0].revision as number;
const startOf = async (appointmentId: string) => (await owner.query("SELECT s.starts_at FROM appointments a JOIN availability_slots s ON s.id = a.slot_id WHERE a.id = $1", [appointmentId])).rows[0].starts_at as Date;

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
/** Someone books a time and gives it back, which is the moment offers go out. */
async function freeATime(holder: number, slotId?: string) {
  const id = slotId ?? (await openSlots())[0].id;
  const { id: appointmentId } = await bookAppointment(patient(holder), { providerId: seedIds.clinician, slotId: id, reason: "A visit that gets cancelled" });
  await advanceAppointment(patient(holder), { appointmentId, revision: await revisionOf(appointmentId), status: "cancelled" });
  return id;
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

// Each test starts with nobody in line, so an earlier test's patient cannot absorb its offers.
afterEach(async () => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
  await owner.query("UPDATE waitlist_entries SET status = 'left' WHERE status = 'waiting'");
});

describe("who viewed my record", () => {
  it("shows what a clinician did in plain words, and not what the patient did themselves", async () => {
    const [slot] = await openSlots();
    await bookAppointment(patient(2), { providerId: seedIds.clinician, slotId: slot.id, reason: "Headaches" });
    await getPatientChart(clinician(), seedId(102));
    const { entries } = await getMyRecordAccess(patient(2), {});
    expect(entries[0]).toMatchObject({ person: "Dr. Selin Arslan", role: "Clinician", kind: "routine", note: null });
    expect(entries[0].activities).toContain("Opened your chart");
    expect(entries.flatMap((entry) => entry.activities)).not.toContain("Looked at your appointments");
    expect(entries.some((entry) => entry.person === "Sofia Moretti")).toBe(false);
  });
  it("sets emergency access apart, with the reason the clinician gave", async () => {
    const reason = "Unconscious on arrival, allergies needed before treating.";
    await requestBreakGlass(otherClinician(), { patientId: seedId(104), reason });
    const { entries } = await getMyRecordAccess(patient(4), {});
    expect(entries[0]).toMatchObject({ person: "Dr. Levent Erdem", kind: "emergency", note: reason });
  });
  it("shows a refused attempt, because the attempt happened", async () => {
    await expect(getPatientChart(otherClinician(), seedId(106))).rejects.toBeInstanceOf(AccessDeniedError);
    const { entries } = await getMyRecordAccess(patient(6), {});
    expect(entries[0]).toMatchObject({ person: "Dr. Levent Erdem", kind: "refused" });
    expect(entries[0].activities).toEqual(["Tried to open your record and was refused"]);
  });
  it("is one patient's own, and reading it is recorded", async () => {
    await getPatientChart(clinician(), seedId(108));
    expect((await getMyRecordAccess(patient(10), {})).entries.flatMap((entry) => entry.activities)).not.toContain("Opened your chart");
    await expect(getMyRecordAccess(staff(), {})).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(getMyRecordAccess(admin(), {})).rejects.toBeInstanceOf(AccessDeniedError);
    const audit = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'identity.record_access_viewed' AND patient_id = $1", [seedId(110)]);
    expect(audit.rows[0].count).toBe(1);
  });
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

describe("the waiting list", () => {
  it("offers a cancelled time to the people waiting longest, and no more than three", async () => {
    for (const index of [1, 3, 5, 7]) await joinWaitlist(patient(index), { providerId: seedIds.clinician, reason: "Any time soon" });
    const slotId = await freeATime(9);
    for (const index of [1, 3, 5]) expect((await listMyWaitlist(patient(index))).offers.map((offer) => offer.slotId)).toEqual([slotId]);
    expect((await listMyWaitlist(patient(7))).offers).toEqual([]);
    expect((await listMyWaitlist(patient(9))).entries).toEqual([]);
  });
  it("passes over someone already holding an open offer, so the next person gets a turn", async () => {
    for (const index of [1, 3, 5, 7]) await joinWaitlist(patient(index), { providerId: seedIds.clinician, reason: "Any time soon" });
    await freeATime(9);
    const second = await freeATime(9);
    expect((await listMyWaitlist(patient(7))).offers.map((offer) => offer.slotId)).toEqual([second]);
    expect((await listMyWaitlist(patient(1))).offers).toHaveLength(1);
  });
  it("gives the time to exactly one of two people accepting at once", async () => {
    await joinWaitlist(patient(11), { providerId: seedIds.clinician, reason: "Any time soon" });
    await joinWaitlist(patient(13), { providerId: seedIds.clinician, reason: "Any time soon" });
    const slotId = await freeATime(9);
    const [first] = (await listMyWaitlist(patient(11))).offers;
    const [second] = (await listMyWaitlist(patient(13))).offers;
    const results = await Promise.allSettled([acceptWaitlistOffer(patient(11), { offerId: first.id }), acceptWaitlistOffer(patient(13), { offerId: second.id })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(SlotUnavailableError);
    const claims = await owner.query("SELECT count(*)::int AS count FROM appointments WHERE slot_id = $1 AND status <> 'cancelled'", [slotId]);
    expect(claims.rows[0].count).toBe(1);
    // Whoever lost keeps their place, and the offer that has gone is no longer shown.
    const loser = results[0].status === "rejected" ? 11 : 13;
    expect(await listMyWaitlist(patient(loser))).toMatchObject({ offers: [], entries: [{ reason: "Any time soon" }] });
  });
  it("never lets one patient take an offer made to another", async () => {
    await joinWaitlist(patient(15), { providerId: seedIds.clinician, reason: "Any time soon" });
    await freeATime(9);
    const [offer] = (await listMyWaitlist(patient(15))).offers;
    await expect(acceptWaitlistOffer(patient(17), { offerId: offer.id })).rejects.toBeInstanceOf(WaitlistError);
    expect((await listMyWaitlist(patient(15))).offers).toHaveLength(1);
  });
  it("moves a visit earlier, and only ever earlier, then offers the old time on", async () => {
    const open = await openSlots();
    const [earlySlot, lateSlot, laterSlot] = [open[0], open[open.length - 2], open[open.length - 1]];
    const { id: visit } = await bookAppointment(patient(19), { providerId: seedIds.clinician, slotId: lateSlot.id, reason: "Knee pain" });
    await joinWaitlist(patient(19), { providerId: seedIds.clinician, appointmentId: visit });
    await joinWaitlist(patient(21), { providerId: seedIds.clinician, reason: "Any time soon" });
    // A time after the visit they hold is no use to them, so it goes past them.
    await freeATime(9, laterSlot.id);
    expect((await listMyWaitlist(patient(19))).offers).toEqual([]);
    expect((await listMyWaitlist(patient(21))).offers.map((offer) => offer.slotId)).toEqual([laterSlot.id]);
    await freeATime(9, earlySlot.id);
    const [offer] = (await listMyWaitlist(patient(19))).offers;
    expect(offer.slotId).toBe(earlySlot.id);
    await joinWaitlist(patient(17), { providerId: seedIds.clinician, reason: "Any time soon" });
    await acceptWaitlistOffer(patient(19), { offerId: offer.id });
    expect((await startOf(visit)).getTime()).toBe(earlySlot.startsAt.getTime());
    const after = await owner.query("SELECT count(*)::int AS count FROM appointments WHERE patient_id = $1 AND status = 'booked'", [seedId(119)]);
    expect(after.rows[0].count).toBe(1);
    expect((await listMyWaitlist(patient(19))).entries).toEqual([]);
    // The time they gave up is the next person's chance.
    expect((await listMyWaitlist(patient(17))).offers.map((candidate) => candidate.slotId)).toEqual([lateSlot.id]);
  });
  it("offers a time given up by rescheduling", async () => {
    const open = await openSlots();
    const { id: visit } = await bookAppointment(patient(23), { providerId: seedIds.clinician, slotId: open[0].id, reason: "Rash" });
    await joinWaitlist(patient(25), { providerId: seedIds.clinician, reason: "Any time soon" });
    await reschedulePatientAppointment(patient(23), { appointmentId: visit, revision: await revisionOf(visit), slotId: open[1].id });
    expect((await listMyWaitlist(patient(25))).offers.map((offer) => offer.slotId)).toEqual([open[0].id]);
  });
  it("stops offering a time once anyone has booked it", async () => {
    await joinWaitlist(patient(27), { providerId: seedIds.clinician, reason: "Any time soon" });
    const slotId = await freeATime(9);
    const [offer] = (await listMyWaitlist(patient(27))).offers;
    await bookAppointment(patient(29), { providerId: seedIds.clinician, slotId, reason: "Booked it directly" });
    expect((await listMyWaitlist(patient(27))).offers).toEqual([]);
    await expect(acceptWaitlistOffer(patient(27), { offerId: offer.id })).rejects.toBeInstanceOf(SlotUnavailableError);
  });
  it("takes someone off the list when they book that clinician anyway, or leave, or cancel the visit they wanted moved", async () => {
    const booked = await joinWaitlist(patient(31), { providerId: seedIds.clinician, reason: "Any time soon" });
    const open = await openSlots();
    await bookAppointment(patient(31), { providerId: seedIds.clinician, slotId: open[0].id, reason: "Found a time" });
    expect(await statusOf("waitlist_entries", booked.id)).toBe("booked");

    const left = await joinWaitlist(patient(33), { providerId: seedIds.clinician, reason: "Any time soon" });
    await expect(leaveWaitlist(patient(35), { entryId: left.id })).rejects.toBeInstanceOf(WaitlistError);
    await leaveWaitlist(patient(33), { entryId: left.id });
    expect(await statusOf("waitlist_entries", left.id)).toBe("left");

    const { id: visit } = await bookAppointment(patient(37), { providerId: seedIds.clinician, slotId: open[1].id, reason: "Cough" });
    const moving = await joinWaitlist(patient(37), { providerId: seedIds.clinician, appointmentId: visit });
    await advanceAppointment(patient(37), { appointmentId: visit, revision: await revisionOf(visit), status: "cancelled" });
    expect(await statusOf("waitlist_entries", moving.id)).toBe("left");
  });
  it("holds one place per clinician, refuses someone else's visit, and refuses an empty reason", async () => {
    await joinWaitlist(patient(39), { providerId: seedIds.clinician, reason: "Any time soon" });
    await expect(joinWaitlist(patient(39), { providerId: seedIds.clinician, reason: "Again please" })).rejects.toBeInstanceOf(WaitlistError);
    const [slot] = await openSlots(seedIds.secondClinician);
    const { id: theirs } = await bookAppointment(patient(38), { providerId: seedIds.secondClinician, slotId: slot.id, reason: "Theirs" });
    await expect(joinWaitlist(patient(39), { providerId: seedIds.secondClinician, appointmentId: theirs })).rejects.toBeInstanceOf(AccessScopeError);
    await expect(joinWaitlist(patient(39), { providerId: seedIds.secondClinician })).rejects.toThrow();
    await expect(joinWaitlist(staff(), { providerId: seedIds.clinician, reason: "Not a patient" })).rejects.toBeInstanceOf(AccessScopeError);
  });
  it("tells them by mail without saying why they are waiting, and says nothing once the time has gone", async () => {
    vi.stubEnv("MAIL_API_KEY", "synthetic-provider-key");
    const fetcher = vi.fn().mockImplementation(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    await joinWaitlist(patient(1), { providerId: seedIds.clinician, reason: "Private matter" });
    const slotId = await freeATime(9);
    const [offer] = (await listMyWaitlist(patient(1))).offers;
    const outbox = await owner.query("SELECT count(*)::int AS count FROM outbox WHERE topic = 'waitlist.offered' AND resource_id = $1", [offer.id]);
    expect(outbox.rows[0].count).toBe(1);
    expect(await sendWaitlistOffer(seedIds.clinic, offer.id)).toMatchObject({ sent: true });
    expect(fetcher.mock.calls[0][1].body).not.toContain("Private matter");
    await bookAppointment(patient(3), { providerId: seedIds.clinician, slotId, reason: "Booked it directly" });
    expect(await sendWaitlistOffer(seedIds.clinic, offer.id)).toMatchObject({ sent: false });
  });
  it("counts the visits it saved in the clinic report, naming nobody", async () => {
    const window = { from: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), days: 3 };
    const before = (await getClinicReport(admin(), window)).waitlist;
    await joinWaitlist(patient(5), { providerId: seedIds.clinician, reason: "Any time soon" });
    await joinWaitlist(patient(7), { providerId: seedIds.clinician, reason: "Any time soon" });
    await freeATime(9);
    const [offer] = (await listMyWaitlist(patient(5))).offers;
    await acceptWaitlistOffer(patient(5), { offerId: offer.id });
    const after = (await getClinicReport(admin(), window)).waitlist;
    expect(before.waiting).toBe(0);
    expect(after).toEqual({ waiting: 1, offered: before.offered + 2, filled: before.filled + 1 });
  });
});
