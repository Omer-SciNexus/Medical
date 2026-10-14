import "server-only";
import { and, eq } from "drizzle-orm";
import type { Transaction } from "@/platform/db";
import { auditedPatientOperation, type Actor } from "@/modules/identity";
import { charges } from "./schema";

export type ChargeInput = { patientId: string; encounterId: string; amountMinor: number; currency: string; description: string };
// Runs inside the caller's transaction so a charge can never outlive a rolled-back visit.
// charge_encounter_unique is the real guarantee; this returns the existing row on retry.
export async function recordCharge(tx: Transaction, actor: Actor, input: ChargeInput) {
  return auditedPatientOperation(tx, actor, input.patientId, "clinical.write", "billing.charge_recorded", async () => {
    await tx.insert(charges).values({ clinicId: actor.clinicId, createdBy: actor.id, updatedBy: actor.id, patientId: input.patientId, encounterId: input.encounterId,
      amountMinor: input.amountMinor, currency: input.currency, description: input.description }).onConflictDoNothing({ target: charges.encounterId });
    const [charge] = await tx.select({ id: charges.id, amountMinor: charges.amountMinor, currency: charges.currency, status: charges.status, description: charges.description })
      .from(charges).where(and(eq(charges.encounterId, input.encounterId), eq(charges.clinicId, actor.clinicId))).limit(1);
    return charge;
  });
}
export async function findChargeForEncounter(tx: Transaction, clinicId: string, encounterId: string) {
  const [charge] = await tx.select({ id: charges.id, amountMinor: charges.amountMinor, currency: charges.currency, status: charges.status, description: charges.description })
    .from(charges).where(and(eq(charges.encounterId, encounterId), eq(charges.clinicId, clinicId))).limit(1);
  return charge;
}
