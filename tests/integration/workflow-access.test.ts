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
import { AccessDeniedError, PersonAdminError, assertCanAccessPatient, listAccessGrants, revokeAccessGrant } from "../../src/modules/identity/service";
import { advanceAppointment, bookAppointment, getPatientIdentity, listProviderAvailability, registerPatient } from "../../src/modules/scheduling/service";
import { startEncounter } from "../../src/modules/clinical/service";
import type { Actor } from "../../src/modules/identity/validators";

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
let owner: Client;
// A clinician with no seeded relationships at all: the point is that the workflow grants them.
const freshProvider = "00000000-0000-4000-8000-0000000000b1";
const freshStaff = "00000000-0000-4000-8000-0000000000b2";
const clinicDay = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const actorFor = (id: string, role: Actor["role"], overrides: Partial<Actor> = {}): Actor =>
  ({ id, clinicId: seedIds.clinic, role, patientId: null, mfaVerified: role !== "patient", authenticatedAt: Date.now(), mfaVerifiedAt: role === "patient" ? null : Date.now(), ...overrides });
const provider = () => actorFor(freshProvider, "clinician");
const newStaff = () => actorFor(freshStaff, "staff");
const admin = () => actorFor(seedIds.admin, "admin");
// Sorted here rather than in SQL: ordering by the enum would follow its declaration order.
const livePurposes = async (actorId: string, patientId: string) =>
  (await owner.query("SELECT purpose FROM care_relationships WHERE actor_id = $1 AND patient_id = $2 AND revoked_at IS NULL", [actorId, patientId])).rows.map((row) => row.purpose as string).sort();

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
  const secret = encryptSecret("JBSWY3DPEHPK3PXP");
  await owner.query("INSERT INTO users (id, clinic_id, email, display_name, role, password_hash, mfa_secret) VALUES ($1, $2, 'fresh.provider@example.test', 'Dr Fresh Provider', 'clinician', 'scrypt$32768$x$y', $3), ($4, $2, 'fresh.desk@example.test', 'Fresh Desk', 'staff', 'scrypt$32768$x$y', $3)",
    [freshProvider, seedIds.clinic, secret, freshStaff]);
  // One session for this provider, far enough ahead to be bookable.
  await owner.query("INSERT INTO availability_slots (clinic_id, created_by, updated_by, provider_id, starts_at, ends_at) VALUES ($1, $2, $2, $3, now() + interval '3 hours', now() + interval '3 hours 20 minutes'), ($1, $2, $2, $3, now() + interval '4 hours', now() + interval '4 hours 20 minutes')",
    [seedIds.clinic, seedIds.system, freshProvider]);
}, 180_000);

afterAll(async () => {
  const globals = globalThis as unknown as { meridianPool?: Pool; meridianAuditPool?: Pool; meridianRedis?: Redis };
  await globals.meridianPool?.end(); globals.meridianPool = undefined;
  await globals.meridianAuditPool?.end(); globals.meridianAuditPool = undefined;
  globals.meridianRedis?.disconnect(); globals.meridianRedis = undefined;
  await owner?.end(); await redis?.stop(); await postgres?.stop();
});

describe("authority follows the workflow", () => {
  let appointmentId: string;
  let patientId: string;
  const patient = () => actorFor(seedId(200), "patient", { patientId: seedId(100) });

  it("starts with no access to a patient this clinician has never seen", async () => {
    patientId = seedId(100);
    expect(await livePurposes(freshProvider, patientId)).toEqual([]);
    await expect(assertCanAccessPatient(provider(), patientId, "clinical.read")).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(assertCanAccessPatient(provider(), patientId, "scheduling")).rejects.toBeInstanceOf(AccessDeniedError);
  });
  it("grants the provider scheduling access when the patient books with them", async () => {
    const slots = await listProviderAvailability(patient(), { providerId: freshProvider, days: 2 });
    expect(slots.length).toBeGreaterThan(0);
    const appointment = await bookAppointment(patient(), { providerId: freshProvider, slotId: slots[0].id, reason: "First visit with a new clinician" });
    appointmentId = appointment.id;
    expect(await livePurposes(freshProvider, patientId)).toEqual(["scheduling"]);
    await expect(assertCanAccessPatient(provider(), patientId, "scheduling")).resolves.toBeUndefined();
    // The chart stays closed until the patient actually arrives.
    await expect(assertCanAccessPatient(provider(), patientId, "clinical.read")).rejects.toBeInstanceOf(AccessDeniedError);
    const audit = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'access.granted' AND patient_id = $1 AND resource_id = $2", [patientId, freshProvider]);
    expect(audit.rows[0].count).toBe(1);
  });
  it("lets the front desk check in a patient it holds no standing grant over", async () => {
    expect(await livePurposes(freshStaff, patientId)).toEqual([]);
    // The appointment itself is the front desk's authority, so a colleague who joined after the
    // booking can still run the waiting room.
    const appointment = await owner.query("SELECT revision FROM appointments WHERE id = $1", [appointmentId]);
    await advanceAppointment(newStaff(), { appointmentId, revision: appointment.rows[0].revision, status: "checked_in" });
    const after = await owner.query("SELECT status, checked_in_at FROM appointments WHERE id = $1", [appointmentId]);
    expect(after.rows[0].status).toBe("checked_in");
    expect(after.rows[0].checked_in_at).not.toBeNull();
    // Scheduling authority only: a chart is still closed to the front desk.
    await expect(assertCanAccessPatient(newStaff(), patientId, "clinical.read")).rejects.toBeInstanceOf(AccessDeniedError);
    expect(await livePurposes(freshStaff, patientId)).toEqual([]);
  });
  it("opens the chart to the attending clinician on arrival", async () => {
    expect(await livePurposes(freshProvider, patientId)).toEqual(["clinical.read", "clinical.write", "prescribe", "scheduling"]);
    await expect(assertCanAccessPatient(provider(), patientId, "clinical.read")).resolves.toBeUndefined();
    await expect(getPatientIdentity(provider(), patientId)).resolves.toMatchObject({ id: patientId });
  });
  it("carries the patient through to a visit that can actually be opened", async () => {
    const appointment = await owner.query("SELECT revision FROM appointments WHERE id = $1", [appointmentId]);
    await advanceAppointment(newStaff(), { appointmentId, revision: appointment.rows[0].revision, status: "rooming" });
    const roomed = await owner.query("SELECT revision FROM appointments WHERE id = $1", [appointmentId]);
    await advanceAppointment(newStaff(), { appointmentId, revision: roomed.rows[0].revision, status: "ready" });
    const encounter = await startEncounter(provider(), { appointmentId });
    expect(encounter.patientId).toBe(patientId);
  });
  it("grants nothing twice however many times the workflow repeats", async () => {
    const before = await owner.query("SELECT count(*)::int AS count FROM care_relationships WHERE actor_id = $1 AND patient_id = $2", [freshProvider, patientId]);
    const slots = await listProviderAvailability(patient(), { providerId: freshProvider, days: 2 });
    if (slots.length) await bookAppointment(patient(), { providerId: freshProvider, slotId: slots[0].id, reason: "Second visit with the same clinician" });
    const after = await owner.query("SELECT count(*)::int AS count FROM care_relationships WHERE actor_id = $1 AND patient_id = $2", [freshProvider, patientId]);
    expect(after.rows[0].count).toBe(before.rows[0].count);
    // The index is what guarantees it, not the service that happens to use ON CONFLICT.
    await expect(owner.query("INSERT INTO care_relationships (clinic_id, actor_id, patient_id, purpose, created_by) VALUES ($1, $2, $3, 'scheduling', $4)",
      [seedIds.clinic, freshProvider, patientId, seedIds.system])).rejects.toThrow();
  });
  it("still refuses a patient who never booked with this clinician", async () => {
    // A seeded patient with no appointment at all: one on the seeded clinic day would hand the
    // front desk scheduling authority through the visit, which is a different rule.
    const stranger = seedId(120);
    await expect(assertCanAccessPatient(provider(), stranger, "clinical.read")).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(assertCanAccessPatient(newStaff(), stranger, "scheduling")).rejects.toBeInstanceOf(AccessDeniedError);
  });
  it("refuses the front desk a patient with no visit either side of now", async () => {
    const quiet = await registerPatient(newStaff(), { givenName: "Sessiz", surname: "Hasta", birthDate: "1975-06-06", sex: "male" });
    await expect(assertCanAccessPatient(newStaff(), quiet.id, "scheduling")).rejects.toBeInstanceOf(AccessDeniedError);
  });
});

describe("the administrator's access registry", () => {
  it("lists live grants without resolving a patient name, and withdraws one", async () => {
    const grants = await listAccessGrants(admin());
    const mine = grants.find((grant) => grant.actorId === freshProvider && grant.purpose === "clinical.read");
    expect(mine).toMatchObject({ actorName: "Dr Fresh Provider", actorRole: "clinician", emergency: false });
    expect(Object.keys(mine ?? {})).not.toContain("givenName");
    await revokeAccessGrant(admin(), { relationshipId: mine!.id });
    await expect(assertCanAccessPatient(provider(), mine!.patientId, "clinical.read")).rejects.toBeInstanceOf(AccessDeniedError);
    // Withdrawn access is gone from the list but remains in the log.
    expect((await listAccessGrants(admin())).some((grant) => grant.id === mine!.id)).toBe(false);
    const audit = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'access.revoked' AND resource_id = $1", [freshProvider]);
    expect(audit.rows[0].count).toBe(1);
    await expect(revokeAccessGrant(admin(), { relationshipId: mine!.id })).rejects.toBeInstanceOf(PersonAdminError);
  });
  it("can be re-granted by the next arrival, because withdrawal is not a block", async () => {
    const appointment = await owner.query(`SELECT a.id, a.revision FROM appointments a JOIN availability_slots s ON s.id = a.slot_id
      WHERE s.provider_id = $1 AND a.status = 'booked' ORDER BY s.starts_at LIMIT 1`, [freshProvider]);
    if (appointment.rowCount) {
      await advanceAppointment(newStaff(), { appointmentId: appointment.rows[0].id, revision: appointment.rows[0].revision, status: "checked_in" });
      await expect(assertCanAccessPatient(provider(), seedId(100), "clinical.read")).resolves.toBeUndefined();
    }
  });
  it("is closed to everyone but a verified administrator", async () => {
    await expect(listAccessGrants(provider())).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(listAccessGrants(newStaff())).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(revokeAccessGrant(provider(), { relationshipId: seedId(1) })).rejects.toBeInstanceOf(AccessDeniedError);
  });
});
