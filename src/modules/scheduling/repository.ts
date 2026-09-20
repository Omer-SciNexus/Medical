import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, type Transaction } from "@/platform/db";
import { patients } from "./schema";

// Authorization metadata only. Never return clinical or demographic fields here.
export async function patientIsInClinic(clinicId: string, patientId: string, tx?: Transaction) {
  const [patient] = await (tx ?? getDb()).select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.clinicId, clinicId), isNull(patients.deletedAt))).limit(1);
  return Boolean(patient);
}
