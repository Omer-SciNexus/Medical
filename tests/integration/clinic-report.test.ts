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
import { getClinicReport, AccessScopeError } from "../../src/modules/scheduling/service";
import { todayInZone } from "../../src/lib/clinic-day";
import type { Actor } from "../../src/modules/identity/validators";

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
let owner: Client;
const timeZone = "Europe/Istanbul";
// Yesterday, so the window the report covers by default contains these appointments.
const clinicDay = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const admin = (overrides: Partial<Actor> = {}): Actor => ({ id: seedIds.admin, clinicId: seedIds.clinic, role: "admin", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now(), ...overrides });
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
  process.env.CLINIC_TIMEZONE = timeZone;
  const app = new URL(postgres.getConnectionUri()); app.username = "meridian_app"; app.password = "local-app-only";
  process.env.DATABASE_URL = app.toString();
  process.env.REDIS_URL = redis.getConnectionUrl();
  await owner.query("UPDATE users SET mfa_secret = $1 WHERE role <> 'patient' AND active = true", [encryptSecret("JBSWY3DPEHPK3PXP")]);
  // A day with something to count: two kept visits, a no-show, a cancellation, and two waits.
  const slots = await owner.query("SELECT a.id, a.revision FROM appointments a JOIN availability_slots s ON s.id = a.slot_id ORDER BY s.starts_at LIMIT 4");
  const [first, second, third, fourth] = slots.rows;
  await owner.query("UPDATE appointments SET status = 'done', checked_in_at = (SELECT starts_at - interval '12 minutes' FROM availability_slots WHERE id = appointments.slot_id) WHERE id = $1", [first.id]);
  await owner.query("UPDATE appointments SET status = 'done', checked_in_at = (SELECT starts_at - interval '40 minutes' FROM availability_slots WHERE id = appointments.slot_id) WHERE id = $1", [second.id]);
  await owner.query("UPDATE appointments SET status = 'no_show' WHERE id = $1", [third.id]);
  await owner.query("UPDATE appointments SET status = 'cancelled' WHERE id = $1", [fourth.id]);
}, 180_000);

afterAll(async () => {
  const globals = globalThis as unknown as { meridianPool?: Pool; meridianAuditPool?: Pool; meridianRedis?: Redis };
  await globals.meridianPool?.end(); globals.meridianPool = undefined;
  await globals.meridianAuditPool?.end(); globals.meridianAuditPool = undefined;
  globals.meridianRedis?.disconnect(); globals.meridianRedis = undefined;
  await owner?.end(); await redis?.stop(); await postgres?.stop();
});

describe("the clinic report", () => {
  it("counts what was kept, missed and cancelled over the window", async () => {
    const report = await getClinicReport(admin(), { days: 28 });
    expect(report.totals?.booked).toBeGreaterThan(0);
    expect(report.totals?.seen).toBeGreaterThanOrEqual(2);
    expect(report.totals?.noShows).toBeGreaterThanOrEqual(1);
    expect(report.totals?.cancelled).toBeGreaterThanOrEqual(1);
    expect(report.totals?.arrived).toBeGreaterThanOrEqual(2);
    expect(report.timeZone).toBe(timeZone);
    const audit = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'scheduling.report_read' AND actor_id = $1", [seedIds.admin]);
    expect(audit.rows[0].count).toBe(1);
  });
  it("reports waits as a distribution rather than one number", async () => {
    const report = await getClinicReport(admin(), { days: 28 });
    expect(report.totals?.medianWait).not.toBeNull();
    expect(report.totals?.longestWait).toBeGreaterThanOrEqual(report.totals?.medianWait ?? 0);
    const bands = report.waits.map((band) => band.band);
    expect(bands).toContain("5 to 15");
    expect(bands).toContain("over 30");
    expect(report.waits.reduce((sum, band) => sum + band.arrivals, 0)).toBe(report.totals?.arrived);
  });
  it("shows what each provider offered against what was taken, and names nobody else", async () => {
    const report = await getClinicReport(admin(), { days: 28 });
    expect(report.providers.length).toBeGreaterThan(0);
    const [first] = report.providers;
    expect(first.slots).toBeGreaterThan(0);
    expect(first.offeredMinutes).toBeGreaterThan(0);
    expect(first.booked).toBeLessThanOrEqual(first.slots);
    // Identifiers and numbers only: a patient cannot be read out of this.
    expect(Object.keys(first)).toEqual(expect.arrayContaining(["providerId", "slots", "offeredMinutes", "booked", "seen", "noShows"]));
    expect(JSON.stringify(report)).not.toContain(seedId(100));
  });
  it("narrows to a shorter window on request", async () => {
    const week = await getClinicReport(admin(), { days: 7 });
    expect(week.days).toBe(7);
    expect(week.to).toBe(todayInZone(timeZone));
    const month = await getClinicReport(admin(), { days: 28 });
    expect(month.totals?.booked).toBeGreaterThanOrEqual(week.totals?.booked ?? 0);
    await expect(getClinicReport(admin(), { days: 400 })).rejects.toThrow();
  });
  it("is an administrator's screen alone", async () => {
    await expect(getClinicReport(staff(), { days: 7 })).rejects.toBeInstanceOf(AccessScopeError);
    await expect(getClinicReport(admin({ mfaVerified: false }), { days: 7 })).rejects.toBeInstanceOf(AccessScopeError);
  });
});
