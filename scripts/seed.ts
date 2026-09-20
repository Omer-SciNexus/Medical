import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hashPassword } from "../src/modules/identity/crypto";
import { clinics, users, careRelationships, auditLog } from "../src/modules/identity/schema";
import { patients, availabilitySlots, appointments } from "../src/modules/scheduling/schema";
import { allergies, problems, observations, medications, encounters, noteVersions } from "../src/modules/clinical/schema";

export const seedId = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
export const seedIds = { clinic: seedId(1), system: seedId(2), clinician: seedId(3), staff: seedId(4), admin: seedId(5), secondClinician: seedId(6), firstPatient: seedId(100), firstPatientUser: seedId(200) };

const names = [
  ["Aylin", "Yılmaz", "female"], ["Emre", "Demir", "male"], ["Sofia", "Moretti", "female"], ["Deniz", "Kaya", "male"], ["Nadia", "Rahman", "female"],
  ["Zeynep", "Çelik", "female"], ["Kerem", "Aydın", "male"], ["Elif", "Şahin", "female"], ["Lucas", "Martin", "male"], ["Derya", "Arslan", "female"],
  ["Mert", "Koç", "male"], ["Leyla", "Öztürk", "female"], ["Omar", "Haddad", "male"], ["Selma", "Aksoy", "female"], ["Arda", "Yıldız", "male"],
  ["Mina", "Park", "female"], ["Ece", "Güneş", "female"], ["Can", "Kurt", "male"], ["Anna", "Kowalska", "female"], ["Bora", "Tekin", "male"],
  ["İrem", "Polat", "female"], ["Mateo", "Silva", "male"], ["Aslı", "Erdoğan", "female"], ["Yusuf", "Sezer", "male"], ["Lina", "Mansour", "female"],
  ["Seda", "Taş", "female"], ["Ali", "Karaca", "male"], ["Clara", "Schmidt", "female"], ["Onur", "Eren", "male"], ["Pelin", "Kaplan", "female"],
  ["Ravi", "Patel", "male"], ["İpek", "Bulut", "female"], ["Tolga", "Uçar", "male"], ["Amira", "Nasser", "female"], ["Sibel", "Doğan", "female"],
  ["Jonas", "Lind", "male"], ["Melis", "Güler", "female"], ["Eren", "Bozkurt", "male"], ["Nora", "Jensen", "female"], ["Burak", "Özdemir", "male"],
] as const;

export async function seedDatabase(connectionString: string, password: string) {
  if (process.env.NODE_ENV === "production") throw new Error("Development seeding is disabled in production.");
  if (password.length < 15 || password.length > 256) throw new Error("SEED_PASSWORD must be 15–256 characters.");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const db = drizzle(client);
    const passwordHash = await hashPassword(password);
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(71422002)`);
      if ((await tx.select({ id: clinics.id }).from(clinics).where(eq(clinics.id, seedIds.clinic))).length) return "Synthetic clinic already exists; no records changed.";
      await tx.insert(clinics).values({ id: seedIds.clinic, name: "Meridian Development Clinic", timezone: "Europe/Istanbul", currency: "TRY" });
      await tx.insert(users).values([
        { id: seedIds.system, clinicId: seedIds.clinic, email: "system@example.test", displayName: "Development seed", role: "admin", passwordHash, active: false },
        { id: seedIds.clinician, clinicId: seedIds.clinic, email: "clinician@example.test", displayName: "Dr. Selin Arslan", role: "clinician", passwordHash },
        { id: seedIds.secondClinician, clinicId: seedIds.clinic, email: "clinician2@example.test", displayName: "Dr. Levent Erdem", role: "clinician", passwordHash },
        { id: seedIds.staff, clinicId: seedIds.clinic, email: "staff@example.test", displayName: "Defne Özkan", role: "staff", passwordHash },
        { id: seedIds.admin, clinicId: seedIds.clinic, email: "admin@example.test", displayName: "Deniz Altan", role: "admin", passwordHash },
      ]);
      const record = { clinicId: seedIds.clinic, createdBy: seedIds.system, updatedBy: seedIds.system };
      for (const [i, [givenName, surname, sex]] of names.entries()) {
        const patientId = seedId(100 + i);
        await tx.insert(patients).values({ ...record, id: patientId, givenName, surname, sex, birthDate: `${1984 - (i * 7 % 32)}-${String(1 + i % 12).padStart(2, "0")}-${String(3 + i % 24).padStart(2, "0")}`, mrn: `MR-${2481 + i}` });
        await tx.insert(users).values({ id: seedId(200 + i), clinicId: seedIds.clinic, email: i === 0 ? "patient@example.test" : `portal.${2481 + i}@example.test`, displayName: `${givenName} ${surname}`, role: "patient", patientId, passwordHash });
        // Only the assigned care team gains access; the admin gains no chart access.
        const providerId = i % 2 === 0 ? seedIds.clinician : seedIds.secondClinician;
        await tx.insert(careRelationships).values([
          ...(["clinical.read", "clinical.write", "prescribe", "scheduling"] as const).map((purpose) => ({ clinicId: seedIds.clinic, actorId: providerId, patientId, purpose, createdBy: seedIds.system })),
          { clinicId: seedIds.clinic, actorId: seedIds.staff, patientId, purpose: "scheduling", createdBy: seedIds.system },
        ]);
        if (i % 5 === 0) await tx.insert(allergies).values({ ...record, patientId, substance: "Penicillin", reaction: "Urticaria", severity: "moderate" });
        if (i % 4 === 0) await tx.insert(problems).values({ ...record, patientId, description: "Essential hypertension", status: "active" });
        if (i % 7 === 0 && i !== 0) await tx.insert(problems).values({ ...record, patientId, description: "Type 2 diabetes mellitus", status: "active" });
        const observedAt = new Date("2026-09-21T05:45:00Z");
        await tx.insert(observations).values([
          { ...record, patientId, label: "Systolic blood pressure", value: i % 4 === 0 ? "142" : "118", unit: "mmHg", referenceLow: "90", referenceHigh: "139", flag: i % 4 === 0 ? "high" : "normal", observedAt },
          { ...record, patientId, label: "Heart rate", value: String(68 + i % 17), unit: "bpm", referenceLow: "60", referenceHigh: "100", flag: "normal", observedAt },
          ...(i % 7 === 0 && i !== 0 ? [{ ...record, patientId, label: "HbA1c", value: "7.8", unit: "%", referenceLow: "4.0", referenceHigh: "5.6", flag: "high", observedAt }] : []),
        ]);
      }
      await tx.insert(medications).values([
        { name: "Amlodipine", ingredient: "amlodipine", strength: "5 mg", form: "tablet" },
        { name: "Metformin", ingredient: "metformin", strength: "500 mg", form: "tablet" },
        { name: "Levothyroxine", ingredient: "levothyroxine", strength: "50 micrograms", form: "tablet" },
        { name: "Amoxicillin", ingredient: "amoxicillin", strength: "500 mg", form: "capsule" },
        { name: "Paracetamol", ingredient: "paracetamol", strength: "500 mg", form: "tablet" },
        { name: "Ramipril", ingredient: "ramipril", strength: "5 mg", form: "capsule" },
      ]);
      for (let i = 0; i < 36; i++) {
        const providerId = i % 2 === 0 ? seedIds.clinician : seedIds.secondClinician;
        const startsAt = new Date(new Date("2026-09-21T06:00:00Z").getTime() + Math.floor(i / 2) * 20 * 60_000);
        await tx.insert(availabilitySlots).values({ ...record, id: seedId(300 + i), providerId, startsAt, endsAt: new Date(startsAt.getTime() + 20 * 60_000) });
        if (i < 12) await tx.insert(appointments).values({ ...record, id: seedId(400 + i), patientId: seedId(100 + i), slotId: seedId(300 + i), reason: i % 4 === 0 ? "Blood pressure review" : i % 7 === 0 ? "Diabetes follow-up" : "Annual health review", preparation: "Bring your current medication list and any recent test results.", status: i === 0 ? "in_progress" : i < 3 ? "ready" : i < 5 ? "checked_in" : "booked", checkedInAt: i < 5 ? new Date("2026-09-21T05:50:00Z") : null });
      }
      await tx.insert(encounters).values({ ...record, id: seedId(500), patientId: seedIds.firstPatient, appointmentId: seedId(400), clinicianId: seedIds.clinician });
      await tx.insert(noteVersions).values({ ...record, patientId: seedIds.firstPatient, encounterId: seedId(500), version: 1, content: "Subjective: Attending scheduled blood pressure review. No new symptoms reported.\nObjective: Blood pressure 142/88 mmHg. Pulse 76 bpm.\nAssessment: Hypertension follow-up; assessment in progress.\nPlan: Clinician to review home readings and current medicines. Synthetic draft, not a treatment recommendation." });
      await tx.insert(auditLog).values({ clinicId: seedIds.clinic, actorId: seedIds.system, action: "development.synthetic_seed", purpose: "development", outcome: "allowed" });
      return "Seeded 40 synthetic patients, 36 slots, 12 appointments and one draft encounter. No prescriptions issued.";
    });
  } finally { await client.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("Set MIGRATION_DATABASE_URL for the development seed.");
  seedDatabase(url, process.env.SEED_PASSWORD ?? "").then(console.log).catch(() => { console.error("Seed failed. Check migrations, owner connection and SEED_PASSWORD. Production seeding is prohibited."); process.exitCode = 1; });
}
