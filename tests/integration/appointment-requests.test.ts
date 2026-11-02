import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { Client } from "pg";
import type { Pool } from "pg";
import type Redis from "ioredis";
import { readFile } from "node:fs/promises";
import { migrateDatabase } from "../../scripts/migrate";
import { seedDatabase, seedIds } from "../../scripts/seed";
import { encryptSecret } from "../../src/modules/identity/crypto";
import { findRequestClinic, submitAppointmentRequest, confirmAppointmentRequest, listAppointmentRequests, findRequestMatches, linkAppointmentRequestToPatient, registerAndInviteFromRequest, declineAppointmentRequest, registerPatient, AccessScopeError } from "../../src/modules/scheduling/service";
import { AppointmentRequestError } from "../../src/modules/scheduling/validators";
import type { Actor } from "../../src/modules/identity/validators";

const mail = vi.hoisted(() => ({ sent: [] as { to: string; text: string }[] }));
vi.mock("@/platform/mailer", () => ({
  sendMail: async (message: { to: string; text: string }) => { mail.sent.push(message); return { delivered: true, configured: true }; },
  mailConfigured: () => true,
}));

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
let owner: Client;
const origin = "http://127.0.0.1:4000";
let address = 0;
// A fresh client address per test keeps the per-address limit out of the way of everything but its own test.
const nextAddress = () => `203.0.113.${++address}`;
const staff = (overrides: Partial<Actor> = {}): Actor => ({ id: seedIds.staff, clinicId: seedIds.clinic, role: "staff", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now(), ...overrides });
const clinician = (): Actor => ({ id: seedIds.clinician, clinicId: seedIds.clinic, role: "clinician", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now() });
const request = (surname: string, overrides: Record<string, string> = {}) => ({ clinicId: seedIds.clinic, givenName: "Talep", surname, birthDate: "1988-03-09",
  contactEmail: `${surname.toLowerCase()}@example.test`, reason: "Recurring headaches", preferredTimes: "Weekday mornings", ...overrides });
const tokenFromMail = () => new URL(mail.sent.at(-1)!.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token") ?? "";
async function submitAndConfirm(surname: string, overrides: Record<string, string> = {}) {
  await submitAppointmentRequest(request(surname, overrides), nextAddress(), origin);
  expect(await confirmAppointmentRequest(tokenFromMail())).toBe(true);
  const pending = await listAppointmentRequests(staff());
  return pending.find((row) => row.contactEmail === request(surname, overrides).contactEmail)!;
}

beforeAll(async () => {
  postgres = await new PostgreSqlContainer("postgres:17-alpine").withDatabase("meridian").withUsername("meridian_owner").withPassword("test-owner-password").start();
  redis = await new RedisContainer("redis:7-alpine").start();
  owner = new Client({ connectionString: postgres.getConnectionUri() }); await owner.connect();
  await owner.query(await readFile("scripts/init-db.sql", "utf8"));
  await migrateDatabase(postgres.getConnectionUri());
  await seedDatabase(postgres.getConnectionUri(), "integration-test-password-only");
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
beforeEach(() => { mail.sent.length = 0; });

describe("submitting a request", () => {
  it("writes nothing until the address is confirmed, then exactly one pending row, and the link works once", async () => {
    await submitAppointmentRequest(request("Bekleme"), nextAddress(), origin);
    const before = await owner.query("SELECT count(*)::int AS count FROM appointment_requests WHERE surname = 'Bekleme'");
    expect(before.rows[0].count).toBe(0);
    expect(mail.sent.at(-1)!.to).toBe("bekleme@example.test");
    // The reason for the visit is clinical; it stays out of the mail.
    expect(mail.sent.at(-1)!.text).not.toContain("Recurring headaches");
    const token = tokenFromMail();
    expect(await confirmAppointmentRequest(token)).toBe(true);
    expect(await confirmAppointmentRequest(token)).toBe(false);
    const after = await owner.query("SELECT status, clinic_id FROM appointment_requests WHERE surname = 'Bekleme'");
    expect(after.rows).toEqual([{ status: "pending", clinic_id: seedIds.clinic }]);
  });
  it("refuses an unknown clinic and a malformed token", async () => {
    await expect(submitAppointmentRequest(request("Bilinmeyen", { clinicId: "00000000-0000-4000-8000-0000000fffff" }), nextAddress(), origin)).rejects.toBeInstanceOf(AppointmentRequestError);
    expect(mail.sent).toHaveLength(0);
    expect(await confirmAppointmentRequest("not-a-token")).toBe(false);
  });
  it("limits how often one email address can ask, whatever network it comes from", async () => {
    const from = nextAddress();
    for (let i = 0; i < 3; i++) await submitAppointmentRequest(request("Sinir"), from, origin);
    await expect(submitAppointmentRequest(request("Sinir"), nextAddress(), origin)).rejects.toBeInstanceOf(AppointmentRequestError);
  });
});

describe("finding a clinic by its code", () => {
  const seededCode = async () => (await owner.query("SELECT request_code FROM clinics WHERE id = $1", [seedIds.clinic])).rows[0].request_code as string;
  it("gives every clinic its own eight-character code, including clinics that existed before the column", async () => {
    await owner.query("INSERT INTO clinics (name) VALUES ('Second clinic'), ('Third clinic')");
    const codes = (await owner.query("SELECT request_code FROM clinics")).rows.map((row) => row.request_code as string);
    for (const code of codes) expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    expect(new Set(codes).size).toBe(codes.length);
  });
  it("forgives case, spaces and the printed hyphen, and returns the name and nothing else", async () => {
    const code = await seededCode();
    const typed = ` ${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `;
    const found = await findRequestClinic(typed, nextAddress());
    expect(found).toEqual({ status: "found", clinic: { id: seedIds.clinic, name: expect.any(String) } });
  });
  it("counts only misses, and once over the limit refuses even the right code", async () => {
    const code = await seededCode();
    const from = nextAddress();
    for (let i = 0; i < 25; i++) expect((await findRequestClinic(code, from)).status).toBe("found");
    for (let i = 0; i < 20; i++) expect((await findRequestClinic(i % 2 ? "ZZZZZZZZ" : "not a code", from)).status).toBe("not_found");
    expect((await findRequestClinic(code, from)).status).toBe("limited");
    expect((await findRequestClinic(code, nextAddress())).status).toBe("found");
  });
});

describe("working the queue", () => {
  it("is closed to a clinician and to an unverified session", async () => {
    await expect(listAppointmentRequests(clinician())).rejects.toBeInstanceOf(AccessScopeError);
    await expect(listAppointmentRequests(staff({ mfaVerified: false }))).rejects.toBeInstanceOf(AccessScopeError);
  });
  it("finds an existing patient with the same name and birth date, in either order", async () => {
    const existing = await registerPatient(staff(), { givenName: "Talep", surname: "Eslesen", birthDate: "1988-03-09", sex: "female" });
    const pending = await submitAndConfirm("Eslesen", { givenName: "eslesen", surname: "Talep" });
    const matches = await findRequestMatches(staff(), { requestId: pending.id });
    expect(matches.map((match) => match.id)).toEqual([existing.id]);
  });
  it("registers a new patient, invites them and resolves the request, once", async () => {
    const pending = await submitAndConfirm("Yeniden");
    const result = await registerAndInviteFromRequest(staff(), { requestId: pending.id }, origin);
    expect("link" in result && result.link).toContain("/accept-invite?token=");
    const row = await owner.query("SELECT r.status, r.resolution, r.resolved_by, p.surname, p.sex, i.email FROM appointment_requests r JOIN patients p ON p.id = r.linked_patient_id JOIN invitations i ON i.patient_id = p.id WHERE r.id = $1", [pending.id]);
    expect(row.rows[0]).toMatchObject({ status: "resolved", resolution: "registered_invited", resolved_by: seedIds.staff, surname: "Yeniden", sex: "unknown", email: "yeniden@example.test" });
    await expect(registerAndInviteFromRequest(staff(), { requestId: pending.id }, origin)).rejects.toBeInstanceOf(AppointmentRequestError);
    expect((await listAppointmentRequests(staff())).some((request) => request.id === pending.id)).toBe(false);
  });
  it("links to a patient who already has an account without sending another invitation", async () => {
    const pending = await submitAndConfirm("Hesapli");
    const invitations = await owner.query("SELECT count(*)::int AS count FROM invitations");
    const result = await linkAppointmentRequestToPatient(staff(), { requestId: pending.id, patientId: seedIds.firstPatient }, origin);
    expect(result.outcome).toBe("existing_account");
    expect((await owner.query("SELECT count(*)::int AS count FROM invitations")).rows[0].count).toBe(invitations.rows[0].count);
    const row = await owner.query("SELECT status, linked_patient_id FROM appointment_requests WHERE id = $1", [pending.id]);
    expect(row.rows[0]).toEqual({ status: "resolved", linked_patient_id: seedIds.firstPatient });
  });
  it("declines with a note, and a declined request cannot then be linked", async () => {
    const pending = await submitAndConfirm("Reddedilen");
    await declineAppointmentRequest(staff(), { requestId: pending.id, note: "Already registered as MR-2490" });
    const row = await owner.query("SELECT status, resolution FROM appointment_requests WHERE id = $1", [pending.id]);
    expect(row.rows[0]).toEqual({ status: "declined", resolution: "Already registered as MR-2490" });
    await expect(linkAppointmentRequestToPatient(staff(), { requestId: pending.id, patientId: seedIds.firstPatient }, origin)).rejects.toBeInstanceOf(AppointmentRequestError);
  });
  it("records every staff action against the request", async () => {
    const audit = await owner.query("SELECT action FROM audit_log WHERE action LIKE 'scheduling.request%' GROUP BY action ORDER BY action");
    expect(audit.rows.map((row) => row.action)).toEqual(["scheduling.request_declined", "scheduling.request_received", "scheduling.request_resolved", "scheduling.requests_read"]);
  });
});
