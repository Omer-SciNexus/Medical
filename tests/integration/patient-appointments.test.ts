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
import { advanceAppointment, bookAppointment, getWaitingRoomBoard, listMyAppointmentPage, listMyAppointments, listProviderAvailability, reschedulePatientAppointment, AccessScopeError } from "../../src/modules/scheduling/service";
import { SlotUnavailableError, StaleAppointmentError } from "../../src/modules/scheduling/validators";
import type { Actor } from "../../src/modules/identity/validators";

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
let owner: Client;
const clinicDay = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const patient = (index: number): Actor => ({ id: seedId(200 + index), clinicId: seedIds.clinic, role: "patient", patientId: seedId(100 + index), mfaVerified: false, authenticatedAt: Date.now(), mfaVerifiedAt: null });
const staff = (): Actor => ({ id: seedIds.staff, clinicId: seedIds.clinic, role: "staff", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now() });
const slotOf = async (appointmentId: string) => (await owner.query("SELECT slot_id, revision, status FROM appointments WHERE id = $1", [appointmentId])).rows[0];
const claimedBy = async (slotId: string) => (await owner.query("SELECT count(*)::int AS count FROM appointments WHERE slot_id = $1 AND status <> 'cancelled' AND deleted_at IS NULL", [slotId])).rows[0].count as number;

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

describe("a patient's own appointments", () => {
  it("lists what is booked, with the preparation note to bring", async () => {
    const slots = await listProviderAvailability(patient(30), { providerId: seedIds.clinician, days: 21 });
    const booked = await bookAppointment(patient(30), { providerId: seedIds.clinician, slotId: slots[0].id, reason: "Recurring headaches" });
    const list = await listMyAppointments(patient(30));
    const found = list.find((appointment) => appointment.id === booked.id);
    expect(found).toMatchObject({ reason: "Recurring headaches", status: "booked" });
    expect(found?.preparation.length).toBeGreaterThan(0);
    // Another patient's list never contains it.
    expect((await listMyAppointments(patient(32))).some((appointment) => appointment.id === booked.id)).toBe(false);
  });
});

describe("rescheduling", () => {
  it("takes the new time and releases the old one in one step", async () => {
    const slots = await listProviderAvailability(patient(34), { providerId: seedIds.clinician, days: 21 });
    const booked = await bookAppointment(patient(34), { providerId: seedIds.clinician, slotId: slots[0].id, reason: "Follow-up on blood pressure" });
    const before = await slotOf(booked.id);
    const open = await listProviderAvailability(patient(34), { providerId: seedIds.clinician, days: 21 });
    const target = open.find((slot) => slot.id !== before.slot_id)!;
    const moved = await reschedulePatientAppointment(patient(34), { appointmentId: booked.id, revision: before.revision, slotId: target.id });
    expect(moved.slotId).toBe(target.id);
    // The appointment is the same record, now on the new slot, and the old one is free again.
    const after = await slotOf(booked.id);
    expect(after).toMatchObject({ slot_id: target.id, status: "booked" });
    expect(after.revision).toBe(before.revision + 1);
    expect(await claimedBy(before.slot_id)).toBe(0);
    expect(await claimedBy(target.id)).toBe(1);
    const audit = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'scheduling.appointment_rescheduled' AND patient_id = $1", [seedId(134)]);
    expect(audit.rows[0].count).toBe(1);
  });
  it("refuses a time another patient already holds, leaving the original untouched", async () => {
    const slots = await listProviderAvailability(patient(36), { providerId: seedIds.clinician, days: 21 });
    const mine = await bookAppointment(patient(36), { providerId: seedIds.clinician, slotId: slots[0].id, reason: "Sore throat" });
    const theirs = await bookAppointment(patient(38), { providerId: seedIds.clinician, slotId: slots[1].id, reason: "Rash" });
    const before = await slotOf(mine.id);
    const taken = await slotOf(theirs.id);
    await expect(reschedulePatientAppointment(patient(36), { appointmentId: mine.id, revision: before.revision, slotId: taken.slot_id })).rejects.toBeInstanceOf(SlotUnavailableError);
    expect(await slotOf(mine.id)).toMatchObject({ slot_id: before.slot_id, revision: before.revision });
  });
  it("gives one slot to exactly one of two patients moving onto it at the same time", async () => {
    const slots = await listProviderAvailability(patient(2), { providerId: seedIds.clinician, days: 21 });
    const first = await bookAppointment(patient(2), { providerId: seedIds.clinician, slotId: slots[0].id, reason: "Simultaneous move A" });
    const second = await bookAppointment(patient(4), { providerId: seedIds.clinician, slotId: slots[1].id, reason: "Simultaneous move B" });
    const open = await listProviderAvailability(patient(2), { providerId: seedIds.clinician, days: 21 });
    const contested = open[0].id;
    const firstState = await slotOf(first.id);
    const secondState = await slotOf(second.id);
    const results = await Promise.allSettled([
      reschedulePatientAppointment(patient(2), { appointmentId: first.id, revision: firstState.revision, slotId: contested }),
      reschedulePatientAppointment(patient(4), { appointmentId: second.id, revision: secondState.revision, slotId: contested }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await claimedBy(contested)).toBe(1);
  });
  it("refuses a stale revision, another patient's appointment, and a slot in the past", async () => {
    const slots = await listProviderAvailability(patient(6), { providerId: seedIds.clinician, days: 21 });
    const booked = await bookAppointment(patient(6), { providerId: seedIds.clinician, slotId: slots[0].id, reason: "Medication review" });
    const open = await listProviderAvailability(patient(6), { providerId: seedIds.clinician, days: 21 });
    const state = await slotOf(booked.id);
    await expect(reschedulePatientAppointment(patient(6), { appointmentId: booked.id, revision: state.revision + 5, slotId: open[0].id })).rejects.toBeInstanceOf(StaleAppointmentError);
    await expect(reschedulePatientAppointment(patient(8), { appointmentId: booked.id, revision: state.revision, slotId: open[0].id })).rejects.toBeInstanceOf(AccessScopeError);
    await expect(reschedulePatientAppointment(staff(), { appointmentId: booked.id, revision: state.revision, slotId: open[0].id })).rejects.toBeInstanceOf(AccessScopeError);
    const past = await owner.query("INSERT INTO availability_slots (clinic_id, created_by, updated_by, provider_id, starts_at, ends_at) VALUES ($1, $2, $2, $3, now() - interval '2 hours', now() - interval '100 minutes') RETURNING id",
      [seedIds.clinic, seedIds.system, seedIds.clinician]);
    await expect(reschedulePatientAppointment(patient(6), { appointmentId: booked.id, revision: state.revision, slotId: past.rows[0].id })).rejects.toBeInstanceOf(SlotUnavailableError);
    // The clinician's own slots are the only ones offered: another provider's is refused.
    const elsewhere = await listProviderAvailability(patient(6), { providerId: seedIds.secondClinician, days: 21 });
    await expect(reschedulePatientAppointment(patient(6), { appointmentId: booked.id, revision: state.revision, slotId: elsewhere[0].id })).rejects.toBeInstanceOf(SlotUnavailableError);
  });
  it("cannot move a visit the patient has already arrived for", async () => {
    const slots = await listProviderAvailability(patient(10), { providerId: seedIds.clinician, days: 21 });
    const booked = await bookAppointment(patient(10), { providerId: seedIds.clinician, slotId: slots[0].id, reason: "Knee pain" });
    const state = await slotOf(booked.id);
    await advanceAppointment(staff(), { appointmentId: booked.id, revision: state.revision, status: "checked_in" });
    const open = await listProviderAvailability(patient(10), { providerId: seedIds.clinician, days: 21 });
    const current = await slotOf(booked.id);
    await expect(reschedulePatientAppointment(patient(10), { appointmentId: booked.id, revision: current.revision, slotId: open[0].id })).rejects.toBeInstanceOf(SlotUnavailableError);
  });
});

describe("cancelling", () => {
  it("frees the time for someone else and cannot be done twice", async () => {
    const slots = await listProviderAvailability(patient(12), { providerId: seedIds.clinician, days: 21 });
    const booked = await bookAppointment(patient(12), { providerId: seedIds.clinician, slotId: slots[0].id, reason: "Travel vaccination advice" });
    const state = await slotOf(booked.id);
    await advanceAppointment(patient(12), { appointmentId: booked.id, revision: state.revision, status: "cancelled" });
    expect((await slotOf(booked.id)).status).toBe("cancelled");
    expect(await claimedBy(state.slot_id)).toBe(0);
    // The freed slot is bookable again, by anyone.
    await expect(bookAppointment(patient(14), { providerId: seedIds.clinician, slotId: state.slot_id, reason: "Taking the freed time" })).resolves.toMatchObject({ id: expect.any(String) });
    const cancelled = await slotOf(booked.id);
    await expect(advanceAppointment(patient(12), { appointmentId: booked.id, revision: cancelled.revision, status: "cancelled" })).rejects.toThrow();
  });
  it("is the only transition a patient may make", async () => {
    const slots = await listProviderAvailability(patient(16), { providerId: seedIds.clinician, days: 21 });
    const booked = await bookAppointment(patient(16), { providerId: seedIds.clinician, slotId: slots[0].id, reason: "Ear discomfort" });
    const state = await slotOf(booked.id);
    for (const status of ["checked_in", "rooming", "ready", "in_progress", "done", "no_show"]) {
      await expect(advanceAppointment(patient(16), { appointmentId: booked.id, revision: state.revision, status })).rejects.toBeInstanceOf(AccessScopeError);
    }
    await expect(advanceAppointment(patient(18), { appointmentId: booked.id, revision: state.revision, status: "cancelled" })).rejects.toThrow();
    expect((await slotOf(booked.id)).status).toBe("booked");
  });
});

describe("appointment pagination and clinic timezone", () => {
  it("keeps upcoming visits visible after more than 100 historical records", async () => {
    const actor = patient(20);
    const slots = await listProviderAvailability(actor, { providerId: seedIds.clinician, days: 21 });
    const booked = await bookAppointment(actor, { providerId: seedIds.clinician, slotId: slots[0].id, reason: "Upcoming pagination regression" });
    await owner.query(`INSERT INTO appointments (clinic_id, created_by, updated_by, patient_id, slot_id, reason, status)
      SELECT $1, $2, $2, $3, $4, 'Historical cancellation', 'cancelled' FROM generate_series(1, 101)`,
      [seedIds.clinic, seedIds.system, actor.patientId, seedId(300)]);
    const upcoming = await listMyAppointmentPage(actor, { view: "upcoming", number: 1 });
    expect(upcoming.entries.some((row) => row.id === booked.id)).toBe(true);
    const first = await listMyAppointmentPage(actor, { view: "past", number: 1 });
    const second = await listMyAppointmentPage(actor, { view: "past", number: 2 });
    expect(first.entries).toHaveLength(25);
    expect(first.hasMore).toBe(true);
    expect(second.entries.some((row) => first.entries.some((other) => other.id === row.id))).toBe(false);
    await expect(listMyAppointmentPage(actor, { number: -1 })).rejects.toThrow();
  });
  it("uses the clinic timezone even when the process default differs", async () => {
    await owner.query("UPDATE clinics SET timezone='UTC' WHERE id=$1", [seedIds.clinic]);
    try {
      expect((await getWaitingRoomBoard(staff(), {})).timeZone).toBe("UTC");
    } finally {
      await owner.query("UPDATE clinics SET timezone='Europe/Istanbul' WHERE id=$1", [seedIds.clinic]);
    }
  });
});
