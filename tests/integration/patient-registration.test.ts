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
import { AccessDeniedError, PersonAdminError, invitePatientPortal, listPortalLinks } from "../../src/modules/identity/service";
import { acceptInvitation } from "../../src/modules/identity/auth";
import { resolveSession } from "../../src/modules/identity/sessions";
import { registerPatient, searchPatients, getPatientDetails, correctPatient, listRecentRegistrations, AccessScopeError } from "../../src/modules/scheduling/service";
import { PatientRegistrationError, PossibleDuplicateError } from "../../src/modules/scheduling/validators";
import { listMyAppointments } from "../../src/modules/scheduling/service";
import type { Actor } from "../../src/modules/identity/validators";

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
let owner: Client;
const origin = "http://127.0.0.1:4000";
const portalPassword = "a memorable portal passphrase";
const tokenOf = (link: string) => new URL(link).searchParams.get("token") ?? "";
const staff = (overrides: Partial<Actor> = {}): Actor => ({ id: seedIds.staff, clinicId: seedIds.clinic, role: "staff", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now(), ...overrides });
const admin = (): Actor => ({ id: seedIds.admin, clinicId: seedIds.clinic, role: "admin", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now() });
const clinician = (): Actor => ({ id: seedIds.clinician, clinicId: seedIds.clinic, role: "clinician", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now() });
const newPatient = (surname: string) => ({ givenName: "Yeni", surname, birthDate: "1991-04-17", sex: "female" as const });

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

describe("registering a patient", () => {
  it("is open to the front desk and an administrator, and nobody else", async () => {
    await expect(registerPatient(clinician(), newPatient("Reddedilen"))).rejects.toBeInstanceOf(AccessScopeError);
    await expect(registerPatient(staff({ mfaVerified: false }), newPatient("Reddedilen"))).rejects.toBeInstanceOf(AccessScopeError);
    await expect(searchPatients(clinician(), { term: "Yilmaz" })).rejects.toBeInstanceOf(AccessScopeError);
  });
  it("assigns the clinic's next record number and records the registration against the new patient", async () => {
    const created = await registerPatient(staff(), newPatient("Yenikayit"));
    // The seed's highest number is MR-2520 for its 40 patients, so the next one follows it.
    expect(created.mrn).toBe("MR-2521");
    const row = await owner.query("SELECT clinic_id, given_name, surname, birth_date, sex, created_by FROM patients WHERE id = $1", [created.id]);
    expect(row.rows[0]).toMatchObject({ clinic_id: seedIds.clinic, given_name: "Yeni", surname: "Yenikayit", sex: "female", created_by: seedIds.staff });
    const audit = await owner.query("SELECT actor_id, purpose FROM audit_log WHERE action = 'scheduling.patient_registered' AND patient_id = $1", [created.id]);
    expect(audit.rows[0]).toMatchObject({ actor_id: seedIds.staff, purpose: "scheduling" });
  });
  it("keeps numbering after an explicitly chosen number and refuses to reuse one", async () => {
    const chosen = await registerPatient(staff(), { ...newPatient("Secilen"), mrn: "MR-9100" });
    expect(chosen.mrn).toBe("MR-9100");
    await expect(registerPatient(staff(), { ...newPatient("Cakisan"), mrn: "MR-9100" })).rejects.toBeInstanceOf(PatientRegistrationError);
    const next = await registerPatient(staff(), newPatient("Sonraki"));
    expect(next.mrn).toBe("MR-9101");
  });
  it("gives the slot of one number to exactly one of two simultaneous registrations", async () => {
    const results = await Promise.allSettled([
      registerPatient(staff(), newPatient("Esanlia")),
      registerPatient(staff(), newPatient("Esanlib")),
    ]);
    const assigned = results.filter((result) => result.status === "fulfilled").map((result) => (result as PromiseFulfilledResult<{ mrn: string }>).value.mrn);
    expect(assigned).toHaveLength(2);
    expect(new Set(assigned).size).toBe(2);
  });
  it("rejects a date of birth in the future and an unknown way of recording sex", async () => {
    await expect(registerPatient(staff(), { ...newPatient("Gelecek"), birthDate: "2099-01-01" })).rejects.toBeInstanceOf(PatientRegistrationError);
    await expect(registerPatient(staff(), { ...newPatient("Gecersiz"), sex: "other" })).rejects.toThrow();
  });
  it("finds a patient by surname or record number, and records the search", async () => {
    const byName = await searchPatients(staff(), { term: "yenikayit" });
    expect(byName.map((match) => match.surname)).toContain("Yenikayit");
    const byMrn = await searchPatients(staff(), { term: "MR-9100" });
    expect(byMrn).toHaveLength(1);
    await expect(searchPatients(staff(), { term: "x" })).rejects.toThrow();
    const audit = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'scheduling.patient_search' AND actor_id = $1", [seedIds.staff]);
    expect(audit.rows[0].count).toBeGreaterThanOrEqual(2);
    // A search never reaches outside the clinic.
    const other = await owner.query("INSERT INTO clinics (name) VALUES ('Another Clinic') RETURNING id");
    await owner.query("INSERT INTO patients (clinic_id, created_by, updated_by, given_name, surname, birth_date, sex, mrn) VALUES ($1, $2, $2, 'Baska', 'Yenikayit', '1980-01-01', 'male', 'MR-1')",
      [other.rows[0].id, seedIds.system]).catch(() => undefined);
    const again = await searchPatients(staff(), { term: "yenikayit" });
    expect(again.every((match) => match.surname === "Yenikayit")).toBe(true);
    expect(again).toHaveLength(byName.length);
  });
});

describe("a likely duplicate", () => {
  it("stops a second record with the same names and date of birth until the front desk confirms", async () => {
    const first = await registerPatient(staff(), { givenName: "Elif", surname: "Ikizler", birthDate: "1990-06-01", sex: "female" });
    const attempt = registerPatient(staff(), { givenName: "ELIF ", surname: "ikizler", birthDate: "1990-06-01", sex: "female" });
    await expect(attempt).rejects.toBeInstanceOf(PossibleDuplicateError);
    const error = await attempt.then(() => null, (caught: unknown) => caught);
    if (!(error instanceof PossibleDuplicateError)) throw new Error("Expected the likely duplicate to be shown.");
    expect(error.matches.map((match) => match.id)).toEqual([first.id]);
    // Names typed into the wrong boxes are the same person too.
    await expect(registerPatient(staff(), { givenName: "Ikizler", surname: "Elif", birthDate: "1990-06-01", sex: "female" })).rejects.toBeInstanceOf(PossibleDuplicateError);
    const count = await owner.query("SELECT count(*)::int AS count FROM patients WHERE lower(surname) IN ('ikizler', 'elif')");
    expect(count.rows[0].count).toBe(1);
    // Showing the matches is a patient read, so it is recorded.
    const shown = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'scheduling.duplicate_check' AND actor_id = $1", [seedIds.staff]);
    expect(shown.rows[0].count).toBeGreaterThanOrEqual(2);
  });
  it("registers a different person with the same details once confirmed, and records that it was", async () => {
    const twin = await registerPatient(staff(), { givenName: "Elif", surname: "Ikizler", birthDate: "1990-06-01", sex: "female", confirmDistinct: "yes" });
    const audit = await owner.query("SELECT reason FROM audit_log WHERE action = 'scheduling.patient_registered' AND patient_id = $1", [twin.id]);
    expect(audit.rows[0].reason).toBe("confirmed_distinct");
  });
  it("lets a different date of birth through without asking", async () => {
    await expect(registerPatient(staff(), { givenName: "Elif", surname: "Ikizler", birthDate: "1990-06-02", sex: "female" })).resolves.toMatchObject({ mrn: expect.stringMatching(/^MR-/) });
  });
});

describe("correcting a registration", () => {
  it("corrects the details, keeps the record number, and records only which fields changed", async () => {
    const created = await registerPatient(staff(), { givenName: "Mehmett", surname: "Duzeltme", birthDate: "1975-03-04", sex: "male" });
    const opened = await getPatientDetails(staff(), { patientId: created.id });
    expect(opened).toMatchObject({ givenName: "Mehmett", birthDate: "1975-03-04", mrn: created.mrn });
    const result = await correctPatient(staff(), { patientId: created.id, version: opened.version, givenName: "Mehmet", surname: "Duzeltme", birthDate: "1975-04-03", sex: "male" });
    expect(result).toEqual({ mrn: created.mrn, changed: ["givenName", "birthDate"] });
    const row = await owner.query("SELECT given_name, birth_date::text AS birth_date, mrn, created_by, updated_by FROM patients WHERE id = $1", [created.id]);
    expect(row.rows[0]).toMatchObject({ given_name: "Mehmet", birth_date: "1975-04-03", mrn: created.mrn, created_by: seedIds.staff, updated_by: seedIds.staff });
    const audit = await owner.query("SELECT reason FROM audit_log WHERE action = 'scheduling.patient_corrected' AND patient_id = $1", [created.id]);
    expect(audit.rows.map((entry) => entry.reason)).toEqual(["givenName,birthDate"]);
    const read = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'scheduling.patient_details_read' AND patient_id = $1", [created.id]);
    expect(read.rows[0].count).toBe(1);
  });
  it("refuses to overwrite a correction made since the form was opened", async () => {
    const created = await registerPatient(staff(), { givenName: "Ayse", surname: "Eszamanli", birthDate: "1988-08-08", sex: "female" });
    const opened = await getPatientDetails(staff(), { patientId: created.id });
    await correctPatient(admin(), { patientId: created.id, version: opened.version, givenName: "Ayşe", surname: "Eszamanli", birthDate: "1988-08-08", sex: "female" });
    await expect(correctPatient(staff(), { patientId: created.id, version: opened.version, givenName: "Ayse", surname: "Eşzamanlı", birthDate: "1988-08-08", sex: "female" })).rejects.toBeInstanceOf(PatientRegistrationError);
    const row = await owner.query("SELECT given_name, surname FROM patients WHERE id = $1", [created.id]);
    expect(row.rows[0]).toEqual({ given_name: "Ayşe", surname: "Eszamanli" });
  });
  it("changes nothing when nothing differs, and is closed to a clinician", async () => {
    const created = await registerPatient(staff(), { givenName: "Ayni", surname: "Kalan", birthDate: "1966-06-06", sex: "unknown" });
    const opened = await getPatientDetails(staff(), { patientId: created.id });
    await expect(correctPatient(staff(), { patientId: created.id, version: opened.version, givenName: "Ayni", surname: "Kalan", birthDate: "1966-06-06", sex: "unknown" })).resolves.toEqual({ mrn: created.mrn, changed: [] });
    await expect(getPatientDetails(clinician(), { patientId: created.id })).rejects.toBeInstanceOf(AccessScopeError);
    await expect(correctPatient(clinician(), { patientId: created.id, version: opened.version, givenName: "X", surname: "Kalan", birthDate: "1966-06-06", sex: "unknown" })).rejects.toBeInstanceOf(AccessScopeError);
    await expect(correctPatient(staff(), { patientId: created.id, version: opened.version, givenName: "Ayni", surname: "Kalan", birthDate: "2099-01-01", sex: "unknown" })).rejects.toBeInstanceOf(PatientRegistrationError);
  });
});

describe("reviewing recent registrations", () => {
  it("shows an administrator who registered whom and what was corrected, and nobody else", async () => {
    const created = await registerPatient(staff(), { givenName: "Gozden", surname: "Gecirilen", birthDate: "1999-09-09", sex: "female" });
    const review = await listRecentRegistrations(admin());
    const entry = review.registrations.find((row) => row.id === created.id);
    expect(entry).toMatchObject({ mrn: created.mrn, createdBy: seedIds.staff, corrected: false });
    expect(review.registrations.find((row) => row.surname === "Duzeltme")).toMatchObject({ corrected: true, updatedBy: seedIds.staff });
    await expect(listRecentRegistrations(staff())).rejects.toBeInstanceOf(AccessScopeError);
    const audit = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'scheduling.registrations_reviewed' AND actor_id = $1", [seedIds.admin]);
    expect(audit.rows[0].count).toBe(1);
  });
});

describe("linking a portal account", () => {
  it("invites the patient and creates an account linked to exactly that record", async () => {
    const patient = await registerPatient(staff(), newPatient("Portalli"));
    const invitation = await invitePatientPortal(staff(), { patientId: patient.id, email: "portalli@example.test", displayName: "Yeni Portalli" }, origin);
    const row = await owner.query("SELECT role, patient_id FROM invitations WHERE id = $1", [invitation.id]);
    expect(row.rows[0]).toMatchObject({ role: "patient", patient_id: patient.id });
    // A patient needs no authenticator, so accepting signs them straight in.
    const result = await acceptInvitation({ token: tokenOf(invitation.link), password: portalPassword, confirmPassword: portalPassword }, "test");
    expect(result.kind).toBe("session");
    if (result.kind !== "session") throw new Error("A portal invitation should produce a session.");
    const actor = await resolveSession(result.token);
    expect(actor).toMatchObject({ role: "patient", patientId: patient.id, clinicId: seedIds.clinic, mfaVerified: false });
    // The new account can immediately read its own appointments, and has none yet.
    await expect(listMyAppointments(actor!)).resolves.toEqual([]);
  });
  it("allows only one account per patient record", async () => {
    const patient = await registerPatient(staff(), newPatient("Tekhesap"));
    const first = await invitePatientPortal(staff(), { patientId: patient.id, email: "tekhesap@example.test", displayName: "Tek Hesap" }, origin);
    // A second pending invitation for the same patient is refused by the partial unique index.
    await expect(invitePatientPortal(staff(), { patientId: patient.id, email: "tekhesap.again@example.test", displayName: "Tek Hesap" }, origin)).rejects.toBeInstanceOf(PersonAdminError);
    await acceptInvitation({ token: tokenOf(first.link), password: portalPassword, confirmPassword: portalPassword }, "test");
    await expect(invitePatientPortal(staff(), { patientId: patient.id, email: "second.account@example.test", displayName: "Tek Hesap" }, origin)).rejects.toBeInstanceOf(PersonAdminError);
    const accounts = await owner.query("SELECT count(*)::int AS count FROM users WHERE patient_id = $1", [patient.id]);
    expect(accounts.rows[0].count).toBe(1);
  });
  it("refuses a patient from another clinic and an address already in use", async () => {
    const other = await owner.query("INSERT INTO clinics (name) VALUES ('Outside Clinic') RETURNING id");
    const outside = await owner.query("INSERT INTO patients (clinic_id, created_by, updated_by, given_name, surname, birth_date, sex, mrn) VALUES ($1, $2, $2, 'Dis', 'Hasta', '1970-02-02', 'male', 'MR-77') RETURNING id",
      [other.rows[0].id, seedIds.system]).catch(() => null);
    if (outside) await expect(invitePatientPortal(staff(), { patientId: outside.rows[0].id, email: "outside@example.test", displayName: "Dis Hasta" }, origin)).rejects.toBeInstanceOf(PersonAdminError);
    const mine = await registerPatient(staff(), newPatient("Adresli"));
    await expect(invitePatientPortal(staff(), { patientId: mine.id, email: "admin@example.test", displayName: "Adresli" }, origin)).rejects.toBeInstanceOf(PersonAdminError);
  });
  it("is closed to a clinician and to an unverified session, and records the refusal", async () => {
    const patient = await registerPatient(staff(), newPatient("Yetkisiz"));
    await expect(invitePatientPortal(clinician(), { patientId: patient.id, email: "yetkisiz@example.test", displayName: "Yetkisiz" }, origin)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(invitePatientPortal(staff({ mfaVerified: false }), { patientId: patient.id, email: "yetkisiz@example.test", displayName: "Yetkisiz" }, origin)).rejects.toBeInstanceOf(AccessDeniedError);
    const audit = await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'administration.denied'");
    expect(audit.rows[0].count).toBeGreaterThanOrEqual(2);
  });
  it("reports which patients hold an account and which have a link waiting", async () => {
    const waiting = await registerPatient(staff(), newPatient("Bekleyen"));
    await invitePatientPortal(staff(), { patientId: waiting.id, email: "bekleyen@example.test", displayName: "Bekleyen" }, origin);
    const links = await listPortalLinks(staff(), [waiting.id, seedIds.firstPatient]);
    expect(links.pending.map((invitation) => invitation.patientId)).toContain(waiting.id);
    expect(links.accounts.map((account) => account.patientId)).toContain(seedIds.firstPatient);
    await expect(listPortalLinks(clinician(), [waiting.id])).rejects.toBeInstanceOf(AccessDeniedError);
  });
  it("keeps a staff invitation free of any patient link", async () => {
    const rows = await owner.query("SELECT count(*)::int AS count FROM invitations WHERE role <> 'patient' AND patient_id IS NOT NULL");
    expect(rows.rows[0].count).toBe(0);
    // The check constraint is what guarantees it, not the service that happens to pass null.
    await expect(owner.query("INSERT INTO invitations (clinic_id, email, display_name, role, patient_id, token_hash, invited_by, expires_at) VALUES ($1, 'bad@example.test', 'Bad', 'staff', $2, 'hash', $3, now() + interval '1 day')",
      [seedIds.clinic, seedId(100), seedIds.admin])).rejects.toThrow();
    await expect(owner.query("INSERT INTO invitations (clinic_id, email, display_name, role, token_hash, invited_by, expires_at) VALUES ($1, 'bad2@example.test', 'Bad', 'patient', 'hash2', $2, now() + interval '1 day')",
      [seedIds.clinic, seedIds.admin])).rejects.toThrow();
  });
});
