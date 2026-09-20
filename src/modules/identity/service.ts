import "server-only";
import { z } from "zod";
import { getDb, type Transaction } from "@/platform/db";
import { resolvePatientScope } from "@/modules/scheduling";
import { actorSchema, emergencySchema, purposeSchema, type Actor, type AccessPurpose } from "./validators";
import { roleAllowsPurpose, hasFreshTotp } from "./policy";
import { appendAudit, createEmergencyRelationship, findUserById, hasCareRelationship } from "./repository";

export class AccessDeniedError extends Error {
  constructor() { super("You do not have permission to access this record."); this.name = "AccessDeniedError"; }
}
async function currentActorIsValid(actor: Actor, tx?: Transaction) {
  const user = await findUserById(actor.id, tx);
  return Boolean(user?.active && user.clinicId === actor.clinicId && user.role === actor.role && user.patientId === actor.patientId && (user.role === "patient" || (user.mfaSecret && actor.mfaVerified)));
}
async function deny(actor: Actor, patientId: string, purpose: string): Promise<never> {
  // Separate transaction: a denied operation must not roll back its denial evidence.
  await appendAudit({ clinicId: actor.clinicId, actorId: actor.id, patientId, action: "access.denied", purpose, outcome: "denied" });
  throw new AccessDeniedError();
}
export async function assertCanAccessPatient(inputActor: Actor, inputPatientId: string, inputPurpose: AccessPurpose, tx?: Transaction) {
  const actor = actorSchema.parse(inputActor);
  const patientId = z.uuid().parse(inputPatientId);
  const purpose = purposeSchema.parse(inputPurpose);
  if (!await currentActorIsValid(actor, tx) || !roleAllowsPurpose(actor, purpose) || !await resolvePatientScope(actor, patientId, tx)) return deny(actor, patientId, purpose);
  if (actor.role === "patient") {
    if (actor.patientId !== patientId) return deny(actor, patientId, purpose);
    return;
  }
  if (!await hasCareRelationship(actor, patientId, purpose, tx)) return deny(actor, patientId, purpose);
}
export async function requestBreakGlass(inputActor: Actor, input: unknown) {
  const actor = actorSchema.parse(inputActor);
  const { patientId, reason } = emergencySchema.parse(input);
  if (actor.role !== "clinician" || !hasFreshTotp(actor) || !await currentActorIsValid(actor) || !await resolvePatientScope(actor, patientId)) return deny(actor, patientId, "break_glass");
  await getDb().transaction((tx) => createEmergencyRelationship(actor, patientId, reason, tx));
}
// Called by patient-data repositories inside their existing transaction.
// This function intentionally couples access checks and durable read/write audit.
export async function auditedPatientOperation<T>(tx: Transaction, actor: Actor, patientId: string, purpose: AccessPurpose, action: string, operation: () => Promise<T>): Promise<T> {
  await assertCanAccessPatient(actor, patientId, purpose, tx);
  const result = await operation();
  await appendAudit({ clinicId: actor.clinicId, actorId: actor.id, patientId, action, purpose, outcome: "allowed" }, tx);
  return result;
}
