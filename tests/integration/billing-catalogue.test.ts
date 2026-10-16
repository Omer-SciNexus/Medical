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
import { addService, changeServiceState, getPriceList, getVisitInvoice, listInvoices, setDefaultService, settleInvoice, voidInvoice } from "../../src/modules/billing/service";
import { BillingError } from "../../src/modules/billing/validators";
import { addEncounterCharge, finishEncounter, removeEncounterCharge, signNote, startEncounter } from "../../src/modules/clinical/service";
import { EncounterStateError } from "../../src/modules/clinical/validators";
import type { Actor } from "../../src/modules/identity/validators";

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
let owner: Client;
const clinicDay = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const admin = (overrides: Partial<Actor> = {}): Actor => ({ id: seedIds.admin, clinicId: seedIds.clinic, role: "admin", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now(), ...overrides });
const staff = (): Actor => ({ id: seedIds.staff, clinicId: seedIds.clinic, role: "staff", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now() });
const clinician = (): Actor => ({ id: seedIds.clinician, clinicId: seedIds.clinic, role: "clinician", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now() });
const serviceId = async (code: string) => (await owner.query("SELECT id FROM services WHERE code = $1 AND clinic_id = $2", [code, seedIds.clinic])).rows[0].id as string;
const chargeRow = async (encounterId: string) => (await owner.query("SELECT id, amount_minor, status, paid_method, void_reason FROM charges WHERE encounter_id = $1", [encounterId])).rows[0];
const signAndFinish = async (encounterId: string, summary: string) => {
  const note = await owner.query("SELECT id, revision FROM note_versions WHERE encounter_id = $1 ORDER BY version DESC LIMIT 1", [encounterId]);
  await owner.query("UPDATE note_versions SET content = $1 WHERE id = $2", ["Subjective: recorded for the billing suite.", note.rows[0].id]);
  const fresh = await owner.query("SELECT revision FROM note_versions WHERE id = $1", [note.rows[0].id]);
  await signNote(clinician(), { encounterId, versionId: note.rows[0].id, revision: fresh.rows[0].revision });
  return finishEncounter(clinician(), { encounterId, summary });
};

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

describe("the price list", () => {
  it("is an administrator's to change, and nobody else's", async () => {
    await expect(addService(clinician(), { code: "NOPE", name: "Not allowed", amountMajor: 10, isDefault: false }, "TRY")).rejects.toBeInstanceOf(BillingError);
    await expect(addService(admin({ mfaVerified: false }), { code: "NOPE", name: "Not allowed", amountMajor: 10, isDefault: false }, "TRY")).rejects.toBeInstanceOf(BillingError);
    const added = await addService(admin(), { code: "HOME-VISIT", name: "Home visit", amountMajor: 1_800.5, isDefault: false }, "TRY");
    // Entered in major units, stored in minor ones, with no rounding left to chance.
    const row = await owner.query("SELECT amount_minor, currency, is_default FROM services WHERE id = $1", [added.id]);
    expect(row.rows[0]).toMatchObject({ amount_minor: 180_050, currency: "TRY", is_default: false });
  });
  it("refuses a duplicate code and a malformed one", async () => {
    await expect(addService(admin(), { code: "HOME-VISIT", name: "Duplicate", amountMajor: 10, isDefault: false }, "TRY")).rejects.toBeInstanceOf(BillingError);
    await expect(addService(admin(), { code: "lower case", name: "Bad code", amountMajor: 10, isDefault: false }, "TRY")).rejects.toThrow();
    await expect(addService(admin(), { code: "NEGATIVE", name: "Negative", amountMajor: -5, isDefault: false }, "TRY")).rejects.toThrow();
  });
  it("keeps exactly one default, moving it rather than adding a second", async () => {
    const extended = await serviceId("CONSULT-LONG");
    await setDefaultService(admin(), { serviceId: extended });
    const defaults = await owner.query("SELECT code FROM services WHERE clinic_id = $1 AND is_default AND deleted_at IS NULL", [seedIds.clinic]);
    expect(defaults.rows.map((row) => row.code)).toEqual(["CONSULT-LONG"]);
    // The index is the guarantee, not the service that happens to step the old one down.
    await expect(owner.query("UPDATE services SET is_default = true WHERE code = 'CONSULT' AND clinic_id = $1", [seedIds.clinic])).rejects.toThrow(/service_clinic_default/);
    await setDefaultService(admin(), { serviceId: await serviceId("CONSULT") });
  });
  it("withdraws a service without touching invoices that already used it", async () => {
    const dressing = await serviceId("DRESSING");
    await changeServiceState(admin(), { serviceId: dressing, active: false });
    expect((await getPriceList(admin())).some((service) => service.code === "DRESSING")).toBe(false);
    expect((await getPriceList(admin(), true)).some((service) => service.code === "DRESSING")).toBe(true);
    await changeServiceState(admin(), { serviceId: dressing, active: true });
  });
});

describe("what a visit is charged", () => {
  it("builds an invoice from the lines a clinician adds, with the total kept by the database", async () => {
    const encounter = await startEncounter(clinician(), { appointmentId: seedId(400) });
    await addEncounterCharge(clinician(), { encounterId: encounter.id, serviceId: await serviceId("CONSULT"), quantity: 1 });
    await addEncounterCharge(clinician(), { encounterId: encounter.id, serviceId: await serviceId("ECG"), quantity: 2 });
    const invoice = await getVisitInvoice(seedIds.clinic, encounter.id);
    expect(invoice?.lines).toHaveLength(2);
    // 150000 + 2 * 90000, summed by the trigger rather than by the service.
    expect(invoice?.amountMinor).toBe(330_000);
    expect((await chargeRow(encounter.id)).amount_minor).toBe(330_000);
    // A line's amount is quantity times unit, by constraint.
    await expect(owner.query("UPDATE charge_lines SET amount_minor = 1 WHERE charge_id = $1", [invoice!.id])).rejects.toThrow(/line_amount_is_quantity_times_unit/);
  });
  it("drops a line and the total follows it down", async () => {
    const encounter = await owner.query("SELECT id FROM encounters WHERE appointment_id = $1", [seedId(400)]);
    const invoice = await getVisitInvoice(seedIds.clinic, encounter.rows[0].id);
    const ecg = invoice!.lines.find((line) => line.description.includes("ECG"))!;
    await removeEncounterCharge(clinician(), { encounterId: encounter.rows[0].id, lineId: ecg.id });
    expect((await getVisitInvoice(seedIds.clinic, encounter.rows[0].id))?.amountMinor).toBe(150_000);
    await expect(removeEncounterCharge(clinician(), { encounterId: encounter.rows[0].id, lineId: ecg.id })).rejects.toBeInstanceOf(BillingError);
  });
  it("charges the clinic's default service when a visit closes with nothing on it", async () => {
    const encounter = await startEncounter(clinician(), { appointmentId: seedId(402) });
    const finished = await signAndFinish(encounter.id, "We talked through your results and agreed on what to watch for over the next month.");
    expect(finished.charge?.amountMinor).toBe(150_000);
    const lines = await owner.query("SELECT description FROM charge_lines WHERE charge_id = $1", [(await chargeRow(encounter.id)).id]);
    expect(lines.rows).toHaveLength(1);
    expect(lines.rows[0].description).toBe("Consultation");
  });
  it("keeps the lines a clinician added rather than replacing them at completion", async () => {
    const encounter = await startEncounter(clinician(), { appointmentId: seedId(404) });
    await addEncounterCharge(clinician(), { encounterId: encounter.id, serviceId: await serviceId("CONSULT-LONG"), quantity: 1 });
    const finished = await signAndFinish(encounter.id, "A longer appointment to go through everything properly, as we discussed.");
    expect(finished.charge?.amountMinor).toBe(240_000);
  });
  it("refuses a line on a visit that is already complete, and from the front desk", async () => {
    const encounter = await owner.query("SELECT id FROM encounters WHERE appointment_id = $1", [seedId(404)]);
    await expect(addEncounterCharge(clinician(), { encounterId: encounter.rows[0].id, serviceId: await serviceId("ECG"), quantity: 1 })).rejects.toBeInstanceOf(EncounterStateError);
    const open = await startEncounter(clinician(), { appointmentId: seedId(408) });
    await expect(addEncounterCharge(staff(), { encounterId: open.id, serviceId: await serviceId("ECG"), quantity: 1 })).rejects.toBeInstanceOf(EncounterStateError);
    await expect(addEncounterCharge(clinician(), { encounterId: open.id, serviceId: seedId(9999), quantity: 1 })).rejects.toBeInstanceOf(BillingError);
  });
});

describe("settling an invoice", () => {
  it("records how it was paid, and will not take payment twice", async () => {
    const invoice = (await listInvoices(staff(), "pending"))[0];
    const settled = await settleInvoice(staff(), { chargeId: invoice.id, method: "card" });
    expect(settled.status).toBe("paid");
    const row = await owner.query("SELECT status, paid_at, paid_method FROM charges WHERE id = $1", [invoice.id]);
    expect(row.rows[0]).toMatchObject({ status: "paid", paid_method: "card" });
    expect(row.rows[0].paid_at).not.toBeNull();
    await expect(settleInvoice(staff(), { chargeId: invoice.id, method: "cash" })).rejects.toBeInstanceOf(BillingError);
    await expect(voidInvoice(staff(), { chargeId: invoice.id, reason: "Trying to void a settled invoice." })).rejects.toBeInstanceOf(BillingError);
    const audit = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'billing.charge_paid'");
    expect(audit.rows[0].count).toBeGreaterThan(0);
  });
  it("voids with a reason, and the database insists on one", async () => {
    const invoice = (await listInvoices(staff(), "pending"))[0];
    await expect(voidInvoice(staff(), { chargeId: invoice.id, reason: "x" })).rejects.toThrow();
    await voidInvoice(staff(), { chargeId: invoice.id, reason: "Billed in error; the visit did not take place." });
    expect((await owner.query("SELECT status, void_reason FROM charges WHERE id = $1", [invoice.id])).rows[0]).toMatchObject({ status: "void" });
    await expect(owner.query("UPDATE charges SET status = 'void', void_reason = NULL WHERE id = $1", [invoice.id])).rejects.toThrow(/charge_void_detail/);
    await expect(owner.query("UPDATE charges SET status = 'paid', paid_at = now(), paid_method = 'cheque' WHERE id = $1", [invoice.id])).rejects.toThrow();
  });
  it("is front-desk work, not a clinician's", async () => {
    const invoice = (await listInvoices(staff()))[0];
    await expect(settleInvoice(clinician(), { chargeId: invoice.id, method: "cash" })).rejects.toBeInstanceOf(BillingError);
    await expect(listInvoices(clinician())).rejects.toBeInstanceOf(BillingError);
  });
});
