import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { Client } from "pg";
import type { Pool } from "pg";
import type Redis from "ioredis";
import { readFile } from "node:fs/promises";
import { migrateDatabase } from "../../scripts/migrate";
import { seedDatabase, seedIds } from "../../scripts/seed";
import { encryptSecret } from "../../src/modules/identity/crypto";
import { addAvailabilityTemplate, addScheduleBlackout, extendProviderSchedule, getScheduleAuthoring, listProviderAvailability, removeAvailabilityTemplate, removeScheduleBlackout } from "../../src/modules/scheduling/service";
import { AccessScopeError } from "../../src/modules/scheduling/service";
import { ScheduleAuthoringError } from "../../src/modules/scheduling/validators";
import { addClinicDays, todayInZone } from "../../src/lib/clinic-day";
import type { Actor } from "../../src/modules/identity/validators";

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
let owner: Client;
const timeZone = "Europe/Istanbul";
// A clinician with an empty calendar: the seed already fills its own clinicians' weeks.
const provider = "00000000-0000-4000-8000-0000000000aa";
const admin = (overrides: Partial<Actor> = {}): Actor => ({ id: seedIds.admin, clinicId: seedIds.clinic, role: "admin", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now(), ...overrides });
const clinician = (): Actor => ({ id: seedIds.clinician, clinicId: seedIds.clinic, role: "clinician", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now() });
// A weekday far enough ahead that "today" never collides with the generated window's edge.
const dayAfter = (offset: number) => addClinicDays(todayInZone(timeZone), offset);
const weekdayOfDay = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
const slotsFor = (provider: string) => owner.query("SELECT starts_at, ends_at FROM availability_slots WHERE provider_id = $1 AND deleted_at IS NULL ORDER BY starts_at", [provider]);

beforeAll(async () => {
  postgres = await new PostgreSqlContainer("postgres:17-alpine").withDatabase("meridian").withUsername("meridian_owner").withPassword("test-owner-password").start();
  redis = await new RedisContainer("redis:7-alpine").start();
  owner = new Client({ connectionString: postgres.getConnectionUri() }); await owner.connect();
  await owner.query(await readFile("scripts/init-db.sql", "utf8"));
  await migrateDatabase(postgres.getConnectionUri());
  await seedDatabase(postgres.getConnectionUri(), "integration-test-password-only");
  process.env.AUTH_PEPPER = "integration-test-only-pepper-32-characters";
  process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.CLINIC_TIMEZONE = timeZone;
  const app = new URL(postgres.getConnectionUri()); app.username = "meridian_app"; app.password = "local-app-only";
  process.env.DATABASE_URL = app.toString();
  process.env.REDIS_URL = redis.getConnectionUrl();
  await owner.query("UPDATE users SET mfa_secret = $1 WHERE role <> 'patient' AND active = true", [encryptSecret("JBSWY3DPEHPK3PXP")]);
  // The seed fills the calendar for its own clinicians; this suite needs an empty one.
  await owner.query("INSERT INTO users (id, clinic_id, email, display_name, role, password_hash, mfa_secret) VALUES ($1, $2, 'fresh.clinician@example.test', 'Dr Fresh Start', 'clinician', 'scrypt$32768$x$y', $3)",
    [provider, seedIds.clinic, encryptSecret("JBSWY3DPEHPK3PXP")]);
}, 180_000);

afterAll(async () => {
  const globals = globalThis as unknown as { meridianPool?: Pool; meridianAuditPool?: Pool; meridianRedis?: Redis };
  await globals.meridianPool?.end(); globals.meridianPool = undefined;
  await globals.meridianAuditPool?.end(); globals.meridianAuditPool = undefined;
  globals.meridianRedis?.disconnect(); globals.meridianRedis = undefined;
  await owner?.end(); await redis?.stop(); await postgres?.stop();
});


describe("weekly sessions", () => {
  it("is open to a verified administrator only", async () => {
    await expect(getScheduleAuthoring(clinician())).rejects.toBeInstanceOf(AccessScopeError);
    await expect(getScheduleAuthoring(admin({ mfaVerified: false }))).rejects.toBeInstanceOf(AccessScopeError);
    await expect(addAvailabilityTemplate(clinician(), { providerId: provider, weekday: 1, start: "09:00", end: "12:00", slotMinutes: 20 })).rejects.toBeInstanceOf(AccessScopeError);
  });
  it("records a session in clinic-local minutes and audits it", async () => {
    await addAvailabilityTemplate(admin(), { providerId: provider, weekday: 1, start: "09:00", end: "12:00", slotMinutes: 20 });
    const row = await owner.query("SELECT weekday, start_minute, end_minute, slot_minutes FROM availability_templates WHERE provider_id = $1", [provider]);
    expect(row.rows[0]).toEqual({ weekday: 1, start_minute: 540, end_minute: 720, slot_minutes: 20 });
    const audit = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'scheduling.template_added'");
    expect(audit.rows[0].count).toBe(1);
  });
  it("lets the database refuse an overlapping session rather than searching for one", async () => {
    await expect(addAvailabilityTemplate(admin(), { providerId: provider, weekday: 1, start: "11:00", end: "13:00", slotMinutes: 30 })).rejects.toBeInstanceOf(ScheduleAuthoringError);
    // Touching at the boundary is not an overlap: the range is half-open.
    await addAvailabilityTemplate(admin(), { providerId: provider, weekday: 1, start: "12:00", end: "13:00", slotMinutes: 30 });
    // The same hours on another weekday, and for another provider, are both fine.
    await addAvailabilityTemplate(admin(), { providerId: provider, weekday: 3, start: "09:00", end: "12:00", slotMinutes: 20 });
    await addAvailabilityTemplate(admin(), { providerId: seedIds.secondClinician, weekday: 1, start: "09:00", end: "12:00", slotMinutes: 20 });
    const count = await owner.query("SELECT count(*)::int AS count FROM availability_templates WHERE deleted_at IS NULL");
    expect(count.rows[0].count).toBe(4);
  });
  it("rejects a session that cannot be divided into whole appointments", async () => {
    await expect(addAvailabilityTemplate(admin(), { providerId: provider, weekday: 5, start: "09:00", end: "09:50", slotMinutes: 20 })).rejects.toThrow();
    await expect(addAvailabilityTemplate(admin(), { providerId: provider, weekday: 5, start: "12:00", end: "09:00", slotMinutes: 20 })).rejects.toThrow();
    await expect(addAvailabilityTemplate(admin(), { providerId: provider, weekday: 9, start: "09:00", end: "10:00", slotMinutes: 20 })).rejects.toThrow();
  });
  it("frees the hours again once a session is removed", async () => {
    const added = await addAvailabilityTemplate(admin(), { providerId: provider, weekday: 6, start: "14:00", end: "15:00", slotMinutes: 30 });
    await expect(addAvailabilityTemplate(admin(), { providerId: provider, weekday: 6, start: "14:00", end: "15:00", slotMinutes: 30 })).rejects.toBeInstanceOf(ScheduleAuthoringError);
    await removeAvailabilityTemplate(admin(), { templateId: added.id });
    // The exclusion constraint ignores removed rows, so the same hours can be used again.
    await addAvailabilityTemplate(admin(), { providerId: provider, weekday: 6, start: "14:00", end: "15:00", slotMinutes: 30 });
    await expect(removeAvailabilityTemplate(admin(), { templateId: added.id })).rejects.toBeInstanceOf(ScheduleAuthoringError);
  });
});

describe("opening appointment times", () => {
  it("refuses to generate for a provider with no session", async () => {
    await expect(extendProviderSchedule(admin(), { providerId: seedIds.staff, weeks: 1 })).rejects.toBeInstanceOf(ScheduleAuthoringError);
  });
  it("expands the weekly pattern into slots of the right length at the right local time", async () => {
    const result = await extendProviderSchedule(admin(), { providerId: provider, weeks: 4 });
    expect(result.created).toBeGreaterThan(0);
    const slots = await slotsFor(provider);
    expect(slots.rows.length).toBe(result.created);
    const lengths = new Set(slots.rows.map((row) => (row.ends_at.getTime() - row.starts_at.getTime()) / 60_000));
    expect([...lengths].every((length) => length === 20 || length === 30)).toBe(true);
    // Every generated slot starts inside one of the authored windows, in clinic-local time.
    const localTimes = slots.rows.map((row) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(row.starts_at));
    expect(localTimes.every((time) => time >= "09:00" && time < "15:00")).toBe(true);
    expect(slots.rows.every((row) => row.starts_at.getTime() > Date.now())).toBe(true);
  });
  it("adds only what is missing when it runs again", async () => {
    const before = await slotsFor(provider);
    const repeat = await extendProviderSchedule(admin(), { providerId: provider, weeks: 4 });
    expect(repeat.created).toBe(0);
    expect(repeat.existing).toBeGreaterThan(0);
    const after = await slotsFor(provider);
    expect(after.rows.length).toBe(before.rows.length);
    // Extending further reuses the same weeks and adds only the new ones.
    const longer = await extendProviderSchedule(admin(), { providerId: provider, weeks: 6 });
    expect(longer.created).toBeGreaterThan(0);
    expect(longer.existing).toBe(before.rows.length);
  });
  it("makes the new times bookable through the patient-facing query", async () => {
    const open = await listProviderAvailability(admin(), { providerId: provider, days: 30 });
    expect(open.length).toBeGreaterThan(0);
  });
});

describe("blackouts", () => {
  it("withdraws the open times it covers and reports booked ones it will not touch", async () => {
    const target = (await owner.query("SELECT starts_at FROM availability_slots WHERE provider_id = $1 AND deleted_at IS NULL ORDER BY starts_at LIMIT 1", [provider])).rows[0].starts_at as Date;
    const day = new Intl.DateTimeFormat("en-CA", { timeZone }).format(target);
    // Book one of that day's slots so the blackout has something it must refuse to remove.
    const booked = (await owner.query("SELECT id FROM availability_slots WHERE provider_id = $1 AND deleted_at IS NULL AND starts_at >= $2 ORDER BY starts_at LIMIT 1", [provider, target])).rows[0].id;
    await owner.query("INSERT INTO appointments (clinic_id, created_by, updated_by, patient_id, slot_id, reason) VALUES ($1, $2, $2, $3, $4, 'Synthetic booking before a blackout')",
      [seedIds.clinic, seedIds.staff, seedIds.firstPatient, booked]);
    const result = await addScheduleBlackout(admin(), { providerId: provider, day, reason: "Provider away for the day" });
    expect(result.booked).toBe(1);
    expect(result.withdrawn).toBeGreaterThan(0);
    const left = await owner.query("SELECT count(*)::int AS count FROM availability_slots WHERE provider_id = $1 AND deleted_at IS NULL AND starts_at::date = $2::date", [provider, day]);
    expect(left.rows[0].count).toBe(1);
    const stillBooked = await owner.query("SELECT deleted_at FROM availability_slots WHERE id = $1", [booked]);
    expect(stillBooked.rows[0].deleted_at).toBeNull();
  });
  it("skips blacked-out days when times are generated again", async () => {
    const day = dayAfter(1);
    await addScheduleBlackout(admin(), { providerId: null, day, endDay: dayAfter(2), reason: "Clinic-wide closure" });
    await owner.query("UPDATE availability_slots SET deleted_at = now() WHERE provider_id = $1 AND starts_at::date IN ($2::date, $3::date)", [provider, day, dayAfter(2)]);
    const result = await extendProviderSchedule(admin(), { providerId: provider, weeks: 2 });
    const hasSessionOnBlackedOutDays = [weekdayOfDay(day), weekdayOfDay(dayAfter(2))].some((weekday) => [1, 3, 6].includes(weekday));
    if (hasSessionOnBlackedOutDays) expect(result.blackedOut).toBeGreaterThan(0);
    const inside = await owner.query("SELECT count(*)::int AS count FROM availability_slots WHERE provider_id = $1 AND deleted_at IS NULL AND starts_at::date IN ($2::date, $3::date)", [provider, day, dayAfter(2)]);
    expect(inside.rows[0].count).toBe(0);
  });
  it("lists and lifts a blackout, and refuses to lift it twice", async () => {
    const authoring = await getScheduleAuthoring(admin());
    expect(authoring.blackouts.length).toBeGreaterThanOrEqual(2);
    expect(authoring.timeZone).toBe(timeZone);
    const [first] = authoring.blackouts;
    await removeScheduleBlackout(admin(), { blackoutId: first.id });
    await expect(removeScheduleBlackout(admin(), { blackoutId: first.id })).rejects.toBeInstanceOf(ScheduleAuthoringError);
  });
  it("rejects a range that ends before it starts", async () => {
    await expect(addScheduleBlackout(admin(), { providerId: null, day: dayAfter(9), endDay: dayAfter(8), reason: "Backwards range" })).rejects.toBeInstanceOf(ScheduleAuthoringError);
  });
});
