import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { Client } from "pg";
import type { Pool } from "pg";
import type Redis from "ioredis";
import { readFile } from "node:fs/promises";
import { migrateDatabase } from "../../scripts/migrate";
import { seedDatabase, seedId, seedIds } from "../../scripts/seed";
import { encryptSecret } from "../../src/modules/identity/crypto";
import { setJobQueue, type JobOptions, type JobQueue } from "../../src/platform/queue";
import { MAX_ATTEMPTS, dispatchOutboxBatch } from "../../src/platform/dispatcher";
import { listOutboxRows, outboxBacklog, outboxKey, retryOutboxRow } from "../../src/platform/outbox";
import { handlerFor, handledTopics } from "../../src/jobs/registry";
import { reminderJobId, scheduleAppointmentReminders } from "../../src/jobs/reminders";
import { bookAppointment, listProviderAvailability, reschedulePatientAppointment, advanceAppointment } from "../../src/modules/scheduling/service";
import type { Actor } from "../../src/modules/identity/validators";

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
let owner: Client;
const clinicDay = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const patient = (index: number): Actor => ({ id: seedId(200 + index), clinicId: seedIds.clinic, role: "patient", patientId: seedId(100 + index), mfaVerified: false, authenticatedAt: Date.now(), mfaVerifiedAt: null });

/** Stands in for BullMQ: the dispatcher's own rules are what this suite is about. */
type Added = { name: string; jobId: string; data: Record<string, string>; options?: JobOptions };
let added: Added[] = [];
let removed: string[] = [];
let failNext = 0;
const fakeQueue: JobQueue = {
  async add(name, jobId, data, options) {
    if (failNext > 0) { failNext -= 1; throw new Error("broker unreachable"); }
    added.push({ name, jobId, data, options });
  },
  async remove(jobId) { removed.push(jobId); },
  async close() {},
};
const rowFor = async (key: string) => (await owner.query("SELECT * FROM outbox WHERE idempotency_key = $1", [key])).rows[0];
const enqueue = (topic: string, resourceId: string) =>
  owner.query("INSERT INTO outbox (clinic_id, topic, resource_id, idempotency_key) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
    [seedIds.clinic, topic, resourceId, outboxKey(`${topic}:${resourceId}`)]);

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
  setJobQueue(fakeQueue);
}, 180_000);

afterAll(async () => {
  setJobQueue(undefined);
  const globals = globalThis as unknown as { meridianPool?: Pool; meridianAuditPool?: Pool; meridianRedis?: Redis };
  await globals.meridianPool?.end(); globals.meridianPool = undefined;
  await globals.meridianAuditPool?.end(); globals.meridianAuditPool = undefined;
  globals.meridianRedis?.disconnect(); globals.meridianRedis = undefined;
  await owner?.end(); await redis?.stop(); await postgres?.stop();
});

beforeEach(() => { added = []; removed = []; failNext = 0; });

describe("draining the outbox", () => {
  it("hands each pending row to the queue under its own idempotency key and marks it dispatched", async () => {
    await enqueue("encounter.completed", seedId(500));
    const key = outboxKey(`encounter.completed:${seedId(500)}`);
    const result = await dispatchOutboxBatch();
    expect(result.dispatched).toBeGreaterThan(0);
    const job = added.find((candidate) => candidate.jobId === key);
    expect(job).toMatchObject({ name: "encounter.completed", data: { resourceId: seedId(500), clinicId: seedIds.clinic } });
    // Identifiers only: nothing about the patient travels in the job.
    expect(Object.keys(job!.data).sort()).toEqual(["clinicId", "outboxId", "resourceId", "topic"]);
    const row = await rowFor(key);
    expect(row.dispatched_at).not.toBeNull();
  });
  it("does not hand the same row over twice", async () => {
    const before = added.length;
    const result = await dispatchOutboxBatch();
    expect(result.claimed).toBe(0);
    expect(added.length).toBe(before);
  });
  it("leaves a row pending when the broker refuses it, and backs off before trying again", async () => {
    await enqueue("visit_summary.published", seedId(501));
    const key = outboxKey(`visit_summary.published:${seedId(501)}`);
    failNext = 1;
    const result = await dispatchOutboxBatch();
    expect(result.failed).toBe(1);
    expect(result.dispatched).toBe(0);
    const row = await rowFor(key);
    expect(row.dispatched_at).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.last_error).toContain("broker unreachable");
    // Backed off, so an immediate pass does not pick it up again.
    expect(row.next_attempt_at.getTime()).toBeGreaterThan(Date.now());
    expect((await dispatchOutboxBatch()).claimed).toBe(0);
    // Once the backoff has passed it is claimable, and succeeds this time.
    await owner.query("UPDATE outbox SET next_attempt_at = now() - interval '1 second' WHERE idempotency_key = $1", [key]);
    expect((await dispatchOutboxBatch()).dispatched).toBe(1);
    expect((await rowFor(key)).dispatched_at).not.toBeNull();
  });
  it("gives up after enough attempts and leaves a dead letter for an operator", async () => {
    await enqueue("encounter.completed", seedId(502));
    const key = outboxKey(`encounter.completed:${seedId(502)}`);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await owner.query("UPDATE outbox SET next_attempt_at = NULL WHERE idempotency_key = $1", [key]);
      failNext = 1;
      await dispatchOutboxBatch();
    }
    const dead = await rowFor(key);
    expect(dead.failed_at).not.toBeNull();
    expect(dead.attempts).toBe(MAX_ATTEMPTS);
    // A dead letter is not retried on its own.
    expect((await dispatchOutboxBatch()).claimed).toBe(0);
    expect((await outboxBacklog()).dead).toBeGreaterThan(0);
    expect((await listOutboxRows(seedIds.clinic, "dead")).some((row) => row.id === dead.id)).toBe(true);
    // The operator screen can put it back, and then it goes.
    expect(await retryOutboxRow(seedIds.clinic, dead.id)).toMatchObject({ topic: "encounter.completed" });
    const revived = await rowFor(key);
    expect(revived.failed_at).toBeNull();
    expect(revived.attempts).toBe(0);
    expect((await dispatchOutboxBatch()).dispatched).toBe(1);
    // Another clinic's administrator cannot reach it.
    const other = await owner.query("INSERT INTO clinics (name) VALUES ('Outbox Other') RETURNING id");
    expect(await retryOutboxRow(other.rows[0].id, dead.id)).toBeUndefined();
  });
  it("lets two dispatchers run at once without either taking the other's rows", async () => {
    for (const index of [510, 511, 512, 513, 514, 515]) await enqueue("encounter.completed", seedId(index));
    const [first, second] = await Promise.all([dispatchOutboxBatch(3), dispatchOutboxBatch(3)]);
    expect(first.dispatched + second.dispatched).toBe(6);
    const jobIds = added.map((job) => job.jobId);
    expect(new Set(jobIds).size).toBe(jobIds.length);
    expect((await dispatchOutboxBatch()).claimed).toBe(0);
  });
  it("keeps an unknown topic from jamming the queue", async () => {
    await enqueue("retired.topic", seedId(520));
    expect((await dispatchOutboxBatch()).dispatched).toBe(1);
    expect(handlerFor("retired.topic")).toBeUndefined();
    expect(handledTopics()).toContain("appointment.reminder");
  });
});

describe("the events the clinic actually raises", () => {
  it("queues a booking, a reschedule and a cancellation as separate rows", async () => {
    const slots = await listProviderAvailability(patient(20), { providerId: seedIds.clinician, days: 21 });
    const booked = await bookAppointment(patient(20), { providerId: seedIds.clinician, slotId: slots[0].id, reason: "Outbox booking" });
    expect((await rowFor(outboxKey(`appointment.booked:${booked.id}`))).topic).toBe("appointment.booked");
    const state = await owner.query("SELECT revision FROM appointments WHERE id = $1", [booked.id]);
    const open = await listProviderAvailability(patient(20), { providerId: seedIds.clinician, days: 21 });
    await reschedulePatientAppointment(patient(20), { appointmentId: booked.id, revision: state.rows[0].revision, slotId: open[0].id });
    const moved = await owner.query("SELECT revision FROM appointments WHERE id = $1", [booked.id]);
    // A second move of the same appointment is its own row rather than a swallowed duplicate.
    const openAgain = await listProviderAvailability(patient(20), { providerId: seedIds.clinician, days: 21 });
    await reschedulePatientAppointment(patient(20), { appointmentId: booked.id, revision: moved.rows[0].revision, slotId: openAgain[0].id });
    const reschedules = await owner.query("SELECT count(*)::int AS count FROM outbox WHERE topic = 'appointment.rescheduled' AND resource_id = $1", [booked.id]);
    expect(reschedules.rows[0].count).toBe(2);
    const current = await owner.query("SELECT revision FROM appointments WHERE id = $1", [booked.id]);
    await advanceAppointment(patient(20), { appointmentId: booked.id, revision: current.rows[0].revision, status: "cancelled" });
    expect((await rowFor(outboxKey(`appointment.cancelled:${booked.id}`))).topic).toBe("appointment.cancelled");
  });
  it("schedules reminders from the appointment alone, and replaces them when it moves", async () => {
    const slots = await listProviderAvailability(patient(22), { providerId: seedIds.clinician, days: 21 });
    const booked = await bookAppointment(patient(22), { providerId: seedIds.clinician, slotId: slots[0].id, reason: "Reminder scheduling" });
    added = []; removed = [];
    const scheduled = await scheduleAppointmentReminders(booked.id);
    expect(scheduled.scheduled).toBeGreaterThan(0);
    // The job id is the appointment and the offset, so a second pass replaces rather than adds.
    expect(added.map((job) => job.jobId).sort()).toEqual([reminderJobId(booked.id, 2), reminderJobId(booked.id, 24)].sort());
    expect(added.every((job) => (job.options?.delayMs ?? 0) > 0)).toBe(true);
    expect(Object.keys(added[0].data).sort()).toEqual(["appointmentId", "offsetHours"]);
    added = []; removed = [];
    await scheduleAppointmentReminders(booked.id);
    expect(removed).toContain(reminderJobId(booked.id, 24));
    // Cancelling removes them and schedules nothing new.
    const state = await owner.query("SELECT revision FROM appointments WHERE id = $1", [booked.id]);
    await advanceAppointment(patient(22), { appointmentId: booked.id, revision: state.rows[0].revision, status: "cancelled" });
    added = []; removed = [];
    expect((await scheduleAppointmentReminders(booked.id)).scheduled).toBe(0);
    expect(removed.length).toBeGreaterThan(0);
    expect(added).toHaveLength(0);
  });
  it("runs the handler for a dispatched job, which re-reads by id and records what it did", async () => {
    const encounter = await owner.query("SELECT id, clinic_id FROM encounters WHERE published_at IS NOT NULL LIMIT 1");
    if (!encounter.rowCount) return;
    const handler = handlerFor("visit_summary.published")!;
    const outcome = await handler({ clinicId: encounter.rows[0].clinic_id, resourceId: encounter.rows[0].id, topic: "visit_summary.published", outboxId: seedId(1) });
    expect(outcome).toMatchObject({ sent: true });
    // The system, not a person, is recorded as having sent it.
    const audit = await owner.query("SELECT actor_id, purpose FROM audit_log WHERE action = 'clinical.summary_notified' AND resource_id = $1", [encounter.rows[0].id]);
    expect(audit.rows[0]).toMatchObject({ actor_id: null, purpose: "patient.view" });
  });
});
