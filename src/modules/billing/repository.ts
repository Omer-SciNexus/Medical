import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb, type Transaction } from "@/platform/db";
import { auditedPatientOperation, type Actor } from "@/modules/identity";
import { chargeLines, charges, services } from "./schema";

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
export async function listServices(clinicId: string, includeInactive = false) {
  return getDb().select({ id: services.id, code: services.code, name: services.name, amountMinor: services.amountMinor,
    currency: services.currency, isDefault: services.isDefault, active: services.active })
    .from(services).where(and(eq(services.clinicId, clinicId), isNull(services.deletedAt), includeInactive ? undefined : eq(services.active, true)))
    .orderBy(asc(services.code)).limit(200);
}
export async function findService(clinicId: string, serviceId: string, tx?: Transaction) {
  const [service] = await (tx ?? getDb()).select({ id: services.id, code: services.code, name: services.name, amountMinor: services.amountMinor, currency: services.currency, active: services.active })
    .from(services).where(and(eq(services.id, serviceId), eq(services.clinicId, clinicId), isNull(services.deletedAt))).limit(1);
  return service;
}
export async function findDefaultService(clinicId: string, tx?: Transaction) {
  const [service] = await (tx ?? getDb()).select({ id: services.id, name: services.name, amountMinor: services.amountMinor, currency: services.currency })
    .from(services).where(and(eq(services.clinicId, clinicId), eq(services.isDefault, true), eq(services.active, true), isNull(services.deletedAt))).limit(1);
  return service;
}
export async function insertService(actor: Actor, input: { code: string; name: string; amountMinor: number; currency: string; isDefault: boolean }) {
  return getDb().transaction(async (tx) => {
    // One default per clinic is a partial unique index, so the previous one steps down first.
    if (input.isDefault) await tx.update(services).set({ isDefault: false, updatedBy: actor.id }).where(and(eq(services.clinicId, actor.clinicId), eq(services.isDefault, true)));
    const [service] = await tx.insert(services).values({ ...input, clinicId: actor.clinicId, createdBy: actor.id, updatedBy: actor.id })
      .returning({ id: services.id, code: services.code });
    return service;
  });
}
export async function setServiceState(actor: Actor, serviceId: string, active: boolean) {
  const [service] = await getDb().update(services).set({ active, updatedBy: actor.id })
    .where(and(eq(services.id, serviceId), eq(services.clinicId, actor.clinicId), isNull(services.deletedAt)))
    .returning({ id: services.id, active: services.active });
  return service;
}
export async function makeServiceDefault(actor: Actor, serviceId: string) {
  return getDb().transaction(async (tx) => {
    await tx.update(services).set({ isDefault: false, updatedBy: actor.id }).where(and(eq(services.clinicId, actor.clinicId), eq(services.isDefault, true)));
    const [service] = await tx.update(services).set({ isDefault: true, active: true, updatedBy: actor.id })
      .where(and(eq(services.id, serviceId), eq(services.clinicId, actor.clinicId), isNull(services.deletedAt)))
      .returning({ id: services.id });
    return service;
  });
}
/** Opens the invoice for a visit if it has none yet, so lines can be added before completion. */
export async function openChargeForEncounter(tx: Transaction, actor: Actor, input: { patientId: string; encounterId: string; currency: string }) {
  await tx.insert(charges).values({ clinicId: actor.clinicId, createdBy: actor.id, updatedBy: actor.id, patientId: input.patientId,
    encounterId: input.encounterId, amountMinor: 0, currency: input.currency, description: "Visit" }).onConflictDoNothing({ target: charges.encounterId });
  return findChargeForEncounter(tx, actor.clinicId, input.encounterId);
}
export async function listChargeLines(clinicId: string, chargeId: string, tx?: Transaction) {
  return (tx ?? getDb()).select({ id: chargeLines.id, description: chargeLines.description, quantity: chargeLines.quantity,
    unitAmountMinor: chargeLines.unitAmountMinor, amountMinor: chargeLines.amountMinor, serviceId: chargeLines.serviceId })
    .from(chargeLines).where(and(eq(chargeLines.clinicId, clinicId), eq(chargeLines.chargeId, chargeId), isNull(chargeLines.deletedAt)))
    .orderBy(asc(chargeLines.createdAt)).limit(100);
}
export async function insertChargeLine(tx: Transaction, actor: Actor, input: { chargeId: string; serviceId: string | null; description: string; quantity: number; unitAmountMinor: number }) {
  const [line] = await tx.insert(chargeLines).values({ clinicId: actor.clinicId, createdBy: actor.id, updatedBy: actor.id,
    chargeId: input.chargeId, serviceId: input.serviceId, description: input.description, quantity: input.quantity,
    unitAmountMinor: input.unitAmountMinor, amountMinor: input.quantity * input.unitAmountMinor })
    .returning({ id: chargeLines.id, amountMinor: chargeLines.amountMinor });
  return line;
}
export async function removeChargeLine(tx: Transaction, actor: Actor, chargeId: string, lineId: string) {
  const [line] = await tx.update(chargeLines).set({ deletedAt: new Date(), updatedBy: actor.id })
    .where(and(eq(chargeLines.id, lineId), eq(chargeLines.clinicId, actor.clinicId), eq(chargeLines.chargeId, chargeId), isNull(chargeLines.deletedAt)))
    .returning({ id: chargeLines.id });
  return line;
}
export async function settleCharge(tx: Transaction, actor: Actor, chargeId: string, method: string) {
  const [charge] = await tx.update(charges).set({ status: "paid", paidAt: new Date(), paidMethod: method, updatedBy: actor.id })
    .where(and(eq(charges.id, chargeId), eq(charges.clinicId, actor.clinicId), eq(charges.status, "pending"), isNull(charges.deletedAt)))
    .returning({ id: charges.id, amountMinor: charges.amountMinor, patientId: charges.patientId, status: charges.status });
  return charge;
}
export async function voidChargeRow(tx: Transaction, actor: Actor, chargeId: string, reason: string) {
  const [charge] = await tx.update(charges).set({ status: "void", voidReason: reason, updatedBy: actor.id })
    .where(and(eq(charges.id, chargeId), eq(charges.clinicId, actor.clinicId), eq(charges.status, "pending"), isNull(charges.deletedAt)))
    .returning({ id: charges.id, patientId: charges.patientId, status: charges.status });
  return charge;
}
export async function findChargeById(clinicId: string, chargeId: string) {
  const [charge] = await getDb().select({ id: charges.id, patientId: charges.patientId, encounterId: charges.encounterId, amountMinor: charges.amountMinor,
    currency: charges.currency, status: charges.status, paidAt: charges.paidAt, paidMethod: charges.paidMethod, voidReason: charges.voidReason })
    .from(charges).where(and(eq(charges.id, chargeId), eq(charges.clinicId, clinicId), isNull(charges.deletedAt))).limit(1);
  return charge;
}
export async function listClinicCharges(clinicId: string, status?: string, tx?: Transaction) {
  return (tx ?? getDb()).select({ id: charges.id, encounterId: charges.encounterId, patientId: charges.patientId, amountMinor: charges.amountMinor,
    currency: charges.currency, status: charges.status, paidAt: charges.paidAt, createdAt: charges.createdAt })
    .from(charges).where(and(eq(charges.clinicId, clinicId), isNull(charges.deletedAt), status ? eq(charges.status, status) : undefined))
    .orderBy(sql`${charges.createdAt} DESC`).limit(200);
}
export async function findChargeForEncounter(tx: Transaction, clinicId: string, encounterId: string) {
  const [charge] = await tx.select({ id: charges.id, amountMinor: charges.amountMinor, currency: charges.currency, status: charges.status, description: charges.description })
    .from(charges).where(and(eq(charges.encounterId, encounterId), eq(charges.clinicId, clinicId))).for("update").limit(1);
  return charge;
}
/** System-level read for the notification worker, which has no actor and no transaction. */
export async function findChargeOutsideTransaction(clinicId: string, encounterId: string) {
  const [charge] = await getDb().select({ id: charges.id, amountMinor: charges.amountMinor, currency: charges.currency, status: charges.status })
    .from(charges).where(and(eq(charges.encounterId, encounterId), eq(charges.clinicId, clinicId))).limit(1);
  return charge;
}
