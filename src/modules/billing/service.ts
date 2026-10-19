import "server-only";
import { z } from "zod";
import { getDb, type Transaction } from "@/platform/db";
import { assertClinicRole, auditedBillingOperation, recordScopedEvent, auditedPatientOperation, type Actor } from "@/modules/identity";
import { isUniqueViolation } from "@/platform/errors";
import {
  findChargeById, findChargeForEncounter, findChargeOutsideTransaction, findDefaultService, findService, insertChargeLine, insertService,
  listChargeLines, listClinicCharges, listServices, makeServiceDefault, openChargeForEncounter, recordCharge, removeChargeLine,
  setServiceState, settleCharge, voidChargeRow, type ChargeInput,
} from "./repository";
import { BillingError, chargeLineSchema, lineIdSchema, paymentSchema, serviceIdSchema, serviceSchema, serviceStateSchema, voidSchema } from "./validators";

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
export async function findChargeForNotification(clinicId: string, encounterId: string) {
  return findChargeOutsideTransaction(z.uuid().parse(clinicId), z.uuid().parse(encounterId));
}

const MINOR_UNITS = 100;
const toMinor = (major: number) => Math.round(major * MINOR_UNITS);
function requireAdmin(actor: Actor) {
  if (actor.role !== "admin" || !actor.mfaVerified) throw new BillingError("Only a verified administrator may change the price list.");
}
function requireFrontDesk(actor: Actor) {
  if ((actor.role !== "staff" && actor.role !== "admin") || !actor.mfaVerified) throw new BillingError("Only the front desk or an administrator may settle an invoice.");
}
export async function getPriceList(actor: Actor, includeInactive = false) {
  if (!actor.mfaVerified) throw new BillingError("The price list is not available to this session.");
  return listServices(actor.clinicId, includeInactive);
}
export async function addService(actor: Actor, input: unknown, currency: string) {
  requireAdmin(actor);
  const { code, name, amountMajor, isDefault } = serviceSchema.parse(input);
  try {
    return await insertService(actor, { code, name, amountMinor: toMinor(amountMajor), currency, isDefault });
  } catch (error) {
    if (isUniqueViolation(error)) throw new BillingError("A service with that code already exists in this clinic.");
    throw error;
  }
}
export async function changeServiceState(actor: Actor, input: unknown) {
  requireAdmin(actor);
  const { serviceId, active } = serviceStateSchema.parse(input);
  if (!await setServiceState(actor, serviceId, active)) throw new BillingError("That service could not be found.");
}
export async function setDefaultService(actor: Actor, input: unknown) {
  requireAdmin(actor);
  const { serviceId } = serviceIdSchema.parse(input);
  if (!await makeServiceDefault(actor, serviceId)) throw new BillingError("That service could not be found.");
}
/** Called while a visit is open, so its invoice is built before the visit closes. */
export async function addVisitCharge(actor: Actor, input: unknown, context: { patientId: string; currency: string }) {
  const { encounterId, serviceId, quantity } = chargeLineSchema.parse(input);
  return getDb().transaction((tx) => auditedPatientOperation(tx, actor, context.patientId, "clinical.write", "billing.charge_line_added", async () => {
    const service = await findService(actor.clinicId, serviceId, tx);
    if (!service || !service.active) throw new BillingError("That service is not on this clinic's price list.");
    const charge = await openChargeForEncounter(tx, actor, { patientId: context.patientId, encounterId, currency: context.currency });
    if (!charge) throw new BillingError("This visit has no invoice to add to.");
    if (charge.status !== "pending") throw new BillingError("This invoice is settled, so nothing further can be added to it.");
    // The invoice total is maintained by the database from its lines, never written here.
    return insertChargeLine(tx, actor, { chargeId: charge.id, serviceId: service.id, description: `${service.code} · ${service.name}`, quantity, unitAmountMinor: service.amountMinor });
  }));
}
export async function removeVisitCharge(actor: Actor, input: unknown, context: { patientId: string; encounterId: string }) {
  const { lineId } = lineIdSchema.parse({ ...(input as object), encounterId: context.encounterId });
  return getDb().transaction((tx) => auditedPatientOperation(tx, actor, context.patientId, "clinical.write", "billing.charge_line_removed", async () => {
    const charge = await findChargeForEncounter(tx, actor.clinicId, context.encounterId);
    if (!charge || charge.status !== "pending") throw new BillingError("This invoice can no longer be changed.");
    if (!await removeChargeLine(tx, actor, charge.id, lineId)) throw new BillingError("That line has already been removed.");
  }));
}
export async function getVisitInvoice(clinicId: string, encounterId: string) {
  const charge = await getDb().transaction((tx) => findChargeForEncounter(tx, z.uuid().parse(clinicId), z.uuid().parse(encounterId)));
  if (!charge) return undefined;
  return { ...charge, lines: await listChargeLines(clinicId, charge.id) };
}
/** Settling and voiding are front-desk work, recorded against the patient like any other write. */
export async function settleInvoice(actor: Actor, input: unknown) {
  requireFrontDesk(actor);
  const { chargeId, method } = paymentSchema.parse(input);
  const existing = await findChargeById(actor.clinicId, chargeId);
  if (!existing) throw new BillingError("That invoice could not be found.");
  if (existing.status !== "pending") throw new BillingError(`This invoice is already ${existing.status}.`);
  return getDb().transaction((tx) => auditedBillingOperation(tx, actor, existing.patientId, "billing.charge_paid", async () => {
    const settled = await settleCharge(tx, actor, chargeId, method);
    if (!settled) throw new BillingError("This invoice changed while you were looking at it. Reload to see its current state.");
    return settled;
  }));
}
export async function voidInvoice(actor: Actor, input: unknown) {
  requireFrontDesk(actor);
  const { chargeId, reason } = voidSchema.parse(input);
  const existing = await findChargeById(actor.clinicId, chargeId);
  if (!existing) throw new BillingError("That invoice could not be found.");
  if (existing.status !== "pending") throw new BillingError(`This invoice is already ${existing.status}.`);
  return getDb().transaction((tx) => auditedBillingOperation(tx, actor, existing.patientId, "billing.charge_voided", async () => {
    const voided = await voidChargeRow(tx, actor, chargeId, reason);
    if (!voided) throw new BillingError("This invoice changed while you were looking at it. Reload to see its current state.");
    return voided;
  }));
}
export async function listInvoices(actor: Actor, status?: string) {
  requireFrontDesk(actor);
  return getDb().transaction(async (tx) => {
    await assertClinicRole(actor, ["staff", "admin"], tx);
    const invoices = await listClinicCharges(actor.clinicId, status, tx);
    await recordScopedEvent(actor, { action: "billing.invoices_read", purpose: "billing" }, tx);
    return invoices;
  });
}
/**
 * Falls back to the clinic's default service when a visit closes with nothing on its invoice,
 * which is what replaced the hardcoded consultation fee. Runs inside the completion transaction.
 */
export async function ensureVisitCharged(tx: Transaction, actor: Actor, input: { patientId: string; encounterId: string; currency: string }) {
  const charge = await openChargeForEncounter(tx, actor, input);
  if (!charge) throw new BillingError("This visit has no invoice.");
  const lines = await listChargeLines(actor.clinicId, charge.id, tx);
  if (!lines.length) {
    const fallback = await findDefaultService(actor.clinicId, tx);
    if (!fallback) throw new BillingError("This clinic has no default service on its price list, so this visit cannot be charged.");
    await insertChargeLine(tx, actor, { chargeId: charge.id, serviceId: fallback.id, description: fallback.name, quantity: 1, unitAmountMinor: fallback.amountMinor });
  }
  return findChargeForEncounter(tx, actor.clinicId, input.encounterId);
}
/** Gives a brand-new clinic something to charge, so its first visit can close. */
export async function ensureDefaultService(clinicId: string, createdBy: string, currency: string, amountMinor: number) {
  const existing = await findDefaultService(z.uuid().parse(clinicId));
  if (existing) return existing;
  const actor: Actor = { id: z.uuid().parse(createdBy), clinicId, role: "admin", patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now() };
  await insertService(actor, { code: "CONSULT", name: "Consultation", amountMinor, currency, isDefault: true });
  return findDefaultService(clinicId);
}
