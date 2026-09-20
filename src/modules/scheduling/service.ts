import "server-only";
import { z } from "zod";
import type { Actor } from "@/modules/identity";
import type { Transaction } from "@/platform/db";
import { patientIsInClinic } from "./repository";

// Access-control handshake, not a patient-data endpoint. Calling assertCanAccessPatient
// here would recurse. It returns only scope membership and is not a Server Action.
export async function resolvePatientScope(actor: Actor, patientId: string, tx?: Transaction) {
  return patientIsInClinic(z.uuid().parse(actor.clinicId), z.uuid().parse(patientId), tx);
}
