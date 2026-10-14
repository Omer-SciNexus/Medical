import "server-only";
import { z } from "zod";
import { recordScopedEvent, type Actor } from "@/modules/identity";
import { auditedPatientOperation } from "@/modules/identity";
import { getDb, type Transaction } from "@/platform/db";
import { clinicDayRange, clinicTimezone, todayInZone } from "@/lib/clinic-day";
import { availabilityQuerySchema, bookingSchema, queryDaySchema, transitionSchema, SlotUnavailableError } from "./validators";
import { canTransition, roleMayTransition, waitingMinutes } from "./policy";
import { claimSlot, completeAppointment, findAppointment, findPatientIdentity, findSlot, listOpenSlots, listPatientAppointments, listProviderQueue, patientIsInClinic, transitionAppointment } from "./repository";

// Access-control handshake, not a patient-data endpoint. Calling assertCanAccessPatient
// here would recurse. It returns only scope membership and is not a Server Action.
export async function resolvePatientScope(actor: Actor, patientId: string, tx?: Transaction) {
  return patientIsInClinic(z.uuid().parse(actor.clinicId), z.uuid().parse(patientId), tx);
}
function ownPatientId(actor: Actor) {
  if (actor.role !== "patient" || !actor.patientId) throw new AccessScopeError();
  return actor.patientId;
}
export class AccessScopeError extends Error {
  constructor() { super("This action is not available for your account."); this.name = "AccessScopeError"; }
}
export async function listProviderAvailability(actor: Actor, input: unknown) {
  const { providerId, from, days } = availabilityQuerySchema.parse(input);
  // Availability is clinic property, not patient data: scope it, but do not audit a read of it.
  const start = new Date(Math.max(Date.now(), (from ?? new Date()).getTime()));
  return listOpenSlots(actor.clinicId, providerId, start, new Date(start.getTime() + days * 86_400_000));
}
export async function bookAppointment(actor: Actor, input: unknown) {
  const booking = bookingSchema.parse(input);
  const patientId = ownPatientId(actor);
  if (!await findSlot(actor.clinicId, booking.slotId, booking.providerId)) throw new SlotUnavailableError();
  return claimSlot(actor, patientId, booking);
}
export async function listMyAppointments(actor: Actor) {
  return listPatientAppointments(actor, ownPatientId(actor));
}
export async function getClinicianQueue(actor: Actor, input: unknown) {
  const { day } = queryDaySchema.parse(input ?? {});
  if (actor.role !== "clinician" || !actor.mfaVerified) throw new AccessScopeError();
  const timeZone = clinicTimezone();
  const clinicDay = day ?? todayInZone(timeZone);
  const { from, to } = clinicDayRange(clinicDay, timeZone);
  const rows = await listProviderQueue(actor.clinicId, actor.id, from, to);
  // The list is scoped to this clinician's own sessions and its read is recorded. Opening
  // any chart from it still goes through per-patient authorization.
  await recordScopedEvent(actor, { action: "scheduling.queue_read", purpose: "scheduling", reason: `${clinicDay}:${rows.length}` });
  return { day: clinicDay, timeZone, entries: rows.map((row) => ({ ...row, waitingMinutes: waitingMinutes(row.checkedInAt) })) };
}
export async function advanceAppointment(actor: Actor, input: unknown) {
  const { appointmentId, revision, status } = transitionSchema.parse(input);
  const appointment = await findAppointment(actor.clinicId, appointmentId);
  if (!appointment) throw new AccessScopeError();
  if (!roleMayTransition(actor.role, status) || !canTransition(appointment.status, status)) throw new AccessScopeError();
  return transitionAppointment(actor, { appointmentId, patientId: appointment.patientId, revision, status });
}
/** Called by the clinical completion transaction, never directly from a Server Action. */
export async function completeAppointmentInTransaction(tx: Transaction, actor: Actor, input: { appointmentId: string; patientId: string }) {
  await completeAppointment(tx, actor, { appointmentId: z.uuid().parse(input.appointmentId), patientId: z.uuid().parse(input.patientId) });
}
/** Consumed by the clinical domain to open an encounter against a booked visit. */
export async function getAppointmentForCare(actor: Actor, appointmentId: string) {
  const appointment = await findAppointment(actor.clinicId, z.uuid().parse(appointmentId));
  if (!appointment) throw new AccessScopeError();
  return appointment;
}
export async function getPatientIdentity(actor: Actor, patientId: string) {
  const id = z.uuid().parse(patientId);
  return getDb().transaction((tx) => auditedPatientOperation(tx, actor, id, actor.role === "patient" ? "patient.view" : "clinical.read", "scheduling.patient_identity_read", async () => {
    const patient = await findPatientIdentity(actor.clinicId, id, tx);
    if (!patient) throw new AccessScopeError();
    return patient;
  }));
}
