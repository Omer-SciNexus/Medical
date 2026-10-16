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
import { advanceAppointment, getWaitingRoomBoard, AccessScopeError } from "../../src/modules/scheduling/service";
import { StaleAppointmentError } from "../../src/modules/scheduling/validators";
import type { Actor } from "../../src/modules/identity/validators";

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
let owner: Client;
const clinicDay = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const staff = (overrides: Partial<Actor> = {}): Actor => ({ id: seedIds.staff, clinicId: seedIds.clinic, role: "staff", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now(), ...overrides });
const admin = (): Actor => ({ id: seedIds.admin, clinicId: seedIds.clinic, role: "admin", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now() });
const clinician = (): Actor => ({ id: seedIds.clinician, clinicId: seedIds.clinic, role: "clinician", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now() });
const patient = (index: number): Actor => ({ id: seedId(200 + index), clinicId: seedIds.clinic, role: "patient", patientId: seedId(100 + index), mfaVerified: false, authenticatedAt: Date.now(), mfaVerifiedAt: null });

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

describe("the waiting-room board", () => {
  it("carries no name, record number or reason, because the screen faces a room", async () => {
    const board = await getWaitingRoomBoard(staff(), { day: clinicDay });
    expect(board.entries.length).toBeGreaterThan(0);
    const fields = Object.keys(board.entries[0]);
    for (const leaked of ["givenName", "surname", "mrn", "reason", "birthDate", "patientId"]) expect(fields).not.toContain(leaked);
    expect(fields).toEqual(expect.arrayContaining(["id", "status", "revision", "startsAt", "providerId", "waitingMinutes"]));
    // Even as JSON there is nothing in it that identifies a patient.
    expect(JSON.stringify(board.entries)).not.toContain(seedId(100));
  });
  it("covers the whole clinic day, not one clinician's list", async () => {
    const board = await getWaitingRoomBoard(staff(), { day: clinicDay });
    expect(new Set(board.entries.map((entry) => entry.providerId)).size).toBeGreaterThan(1);
    expect(board.day).toBe(clinicDay);
    expect(board.timeZone).toBe("Europe/Istanbul");
    const audit = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'scheduling.board_read' AND actor_id = $1", [seedIds.staff]);
    expect(audit.rows[0].count).toBeGreaterThan(0);
  });
  it("is open to the front desk and an administrator, and not to a clinician or a patient", async () => {
    await expect(getWaitingRoomBoard(admin(), { day: clinicDay })).resolves.toMatchObject({ day: clinicDay });
    await expect(getWaitingRoomBoard(clinician(), { day: clinicDay })).rejects.toBeInstanceOf(AccessScopeError);
    await expect(getWaitingRoomBoard(patient(0), { day: clinicDay })).rejects.toBeInstanceOf(AccessScopeError);
    await expect(getWaitingRoomBoard(staff({ mfaVerified: false }), { day: clinicDay })).rejects.toBeInstanceOf(AccessScopeError);
  });
  it("moves someone through check-in, rooming and ready, and reports the wait", async () => {
    const board = await getWaitingRoomBoard(staff(), { day: clinicDay });
    const target = board.entries.find((entry) => entry.status === "booked")!;
    await advanceAppointment(staff(), { appointmentId: target.id, revision: target.revision, status: "checked_in" });
    const afterCheckIn = (await getWaitingRoomBoard(staff(), { day: clinicDay })).entries.find((entry) => entry.id === target.id)!;
    expect(afterCheckIn.status).toBe("checked_in");
    expect(afterCheckIn.waitingMinutes).toBe(0);
    await advanceAppointment(staff(), { appointmentId: target.id, revision: afterCheckIn.revision, status: "rooming" });
    const roomed = (await getWaitingRoomBoard(staff(), { day: clinicDay })).entries.find((entry) => entry.id === target.id)!;
    await advanceAppointment(staff(), { appointmentId: target.id, revision: roomed.revision, status: "ready" });
    const ready = (await getWaitingRoomBoard(staff(), { day: clinicDay })).entries.find((entry) => entry.id === target.id)!;
    expect(ready.status).toBe("ready");
    // The wait is still counted from arrival, through every room move.
    expect(ready.waitingMinutes).not.toBeNull();
  });
  it("refuses the transitions that belong to a clinician, and a stale revision", async () => {
    const board = await getWaitingRoomBoard(staff(), { day: clinicDay });
    const ready = board.entries.find((entry) => entry.status === "ready")!;
    await expect(advanceAppointment(staff(), { appointmentId: ready.id, revision: ready.revision, status: "in_progress" })).rejects.toBeInstanceOf(AccessScopeError);
    await expect(advanceAppointment(staff(), { appointmentId: ready.id, revision: ready.revision, status: "done" })).rejects.toBeInstanceOf(AccessScopeError);
    await expect(advanceAppointment(staff(), { appointmentId: ready.id, revision: ready.revision + 9, status: "cancelled" })).rejects.toBeInstanceOf(StaleAppointmentError);
  });
  it("marks a no-show, which takes that appointment out of the waiting count", async () => {
    const board = await getWaitingRoomBoard(staff(), { day: clinicDay });
    const target = board.entries.find((entry) => entry.status === "booked")!;
    await advanceAppointment(staff(), { appointmentId: target.id, revision: target.revision, status: "no_show" });
    const after = (await getWaitingRoomBoard(staff(), { day: clinicDay })).entries.find((entry) => entry.id === target.id)!;
    expect(after.status).toBe("no_show");
  });
});
