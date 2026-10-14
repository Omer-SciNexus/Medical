import "server-only";
import { z } from "zod";
import type { Transaction } from "@/platform/db";
import type { Actor } from "@/modules/identity";
import { findChargeForEncounter, recordCharge, type ChargeInput } from "./repository";

const chargeSchema = z.object({
  patientId: z.uuid(), encounterId: z.uuid(),
  amountMinor: z.number().int().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/),
  description: z.string().trim().min(3).max(200),
});
/** Called by the clinical completion transaction, never directly from a Server Action. */
export async function chargeEncounter(tx: Transaction, actor: Actor, input: ChargeInput) {
  return recordCharge(tx, actor, chargeSchema.parse(input));
}
export async function getEncounterCharge(tx: Transaction, clinicId: string, encounterId: string) {
  return findChargeForEncounter(tx, z.uuid().parse(clinicId), z.uuid().parse(encounterId));
}
