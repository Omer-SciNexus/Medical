import "server-only";
import { and, asc, eq, gte, isNull, lt, ne, notExists, sql } from "drizzle-orm";
import { getDb, type Transaction } from "@/platform/db";
import { auditedPatientOperation, type Actor } from "@/modules/identity";
import { isUniqueViolation } from "@/platform/errors";
import { appointments, availabilitySlots, patients } from "./schema";
import { SlotUnavailableError, StaleAppointmentError, type AppointmentStatus } from "./validators";

// Authorization metadata only. Never return clinical or demographic fields here.
export async function patientIsInClinic(clinicId: string, patientId: string, tx?: Transaction) {
  const [patient] = await (tx ?? getDb()).select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.clinicId, clinicId), isNull(patients.deletedAt))).limit(1);
  return Boolean(patient);
}
const unclaimed = (slotId: typeof availabilitySlots.id) => notExists(getDb().select({ one: sql`1` }).from(appointments).where(and(eq(appointments.slotId, slotId), isNull(appointments.deletedAt), ne(appointments.status, "cancelled"))));

export async function listOpenSlots(clinicId: string, providerId: string, from: Date, to: Date) {
  return getDb().select({ id: availabilitySlots.id, startsAt: availabilitySlots.startsAt, endsAt: availabilitySlots.endsAt }).from(availabilitySlots)
    .where(and(eq(availabilitySlots.clinicId, clinicId), eq(availabilitySlots.providerId, providerId), isNull(availabilitySlots.deletedAt),
      gte(availabilitySlots.startsAt, from), lt(availabilitySlots.startsAt, to), unclaimed(availabilitySlots.id)))
    .orderBy(asc(availabilitySlots.startsAt)).limit(200);
}
export async function findSlot(clinicId: string, slotId: string, providerId: string) {
  const [slot] = await getDb().select({ id: availabilitySlots.id, startsAt: availabilitySlots.startsAt, endsAt: availabilitySlots.endsAt }).from(availabilitySlots)
    .where(and(eq(availabilitySlots.id, slotId), eq(availabilitySlots.clinicId, clinicId), eq(availabilitySlots.providerId, providerId), isNull(availabilitySlots.deletedAt))).limit(1);
  return slot;
}
export async function claimSlot(actor: Actor, patientId: string, input: { slotId: string; providerId: string; reason: string }) {
  try {
    return await getDb().transaction((tx) => auditedPatientOperation(tx, actor, patientId, "scheduling", "scheduling.appointment_booked", async () => {
      // Lock the slot row first so concurrent bookings queue here rather than racing the insert.
      const [slot] = await tx.select({ id: availabilitySlots.id, startsAt: availabilitySlots.startsAt }).from(availabilitySlots)
        .where(and(eq(availabilitySlots.id, input.slotId), eq(availabilitySlots.clinicId, actor.clinicId), eq(availabilitySlots.providerId, input.providerId), isNull(availabilitySlots.deletedAt))).for("update").limit(1);
      if (!slot || slot.startsAt.getTime() <= Date.now()) throw new SlotUnavailableError();
      const [appointment] = await tx.insert(appointments).values({ clinicId: actor.clinicId, createdBy: actor.id, updatedBy: actor.id, patientId, slotId: input.slotId, reason: input.reason,
        preparation: "Bring your current medication list and any recent test results." }).returning({ id: appointments.id });
      return appointment;
    }));
  } catch (error) {
    // The partial unique index is the real guarantee; the row lock only reduces contention.
    if (isUniqueViolation(error)) throw new SlotUnavailableError();
    throw error;
  }
}
export async function listPatientAppointments(actor: Actor, patientId: string) {
  return getDb().transaction((tx) => auditedPatientOperation(tx, actor, patientId, "scheduling", "scheduling.appointments_read", () =>
    tx.select({ id: appointments.id, reason: appointments.reason, preparation: appointments.preparation, status: appointments.status, revision: appointments.revision,
      startsAt: availabilitySlots.startsAt, endsAt: availabilitySlots.endsAt, providerId: availabilitySlots.providerId })
      .from(appointments).innerJoin(availabilitySlots, and(eq(appointments.slotId, availabilitySlots.id), eq(appointments.clinicId, availabilitySlots.clinicId)))
      .where(and(eq(appointments.clinicId, actor.clinicId), eq(appointments.patientId, patientId), isNull(appointments.deletedAt)))
      .orderBy(asc(availabilitySlots.startsAt)).limit(100)));
}
// Scoped to the actor's own session slots. Opening a chart still needs patient authorization.
export async function listProviderQueue(clinicId: string, providerId: string, from: Date, to: Date) {
  return getDb().select({ id: appointments.id, patientId: appointments.patientId, reason: appointments.reason, status: appointments.status, revision: appointments.revision,
    checkedInAt: appointments.checkedInAt, startsAt: availabilitySlots.startsAt, endsAt: availabilitySlots.endsAt,
    givenName: patients.givenName, surname: patients.surname, birthDate: patients.birthDate, sex: patients.sex, mrn: patients.mrn })
    .from(appointments)
    .innerJoin(availabilitySlots, and(eq(appointments.slotId, availabilitySlots.id), eq(appointments.clinicId, availabilitySlots.clinicId)))
    .innerJoin(patients, and(eq(appointments.patientId, patients.id), eq(appointments.clinicId, patients.clinicId)))
    .where(and(eq(appointments.clinicId, clinicId), eq(availabilitySlots.providerId, providerId), isNull(appointments.deletedAt),
      gte(availabilitySlots.startsAt, from), lt(availabilitySlots.startsAt, to)))
    .orderBy(asc(availabilitySlots.startsAt)).limit(200);
}
export async function findAppointment(clinicId: string, appointmentId: string) {
  const [appointment] = await getDb().select({ id: appointments.id, patientId: appointments.patientId, reason: appointments.reason, status: appointments.status, revision: appointments.revision,
    startsAt: availabilitySlots.startsAt, providerId: availabilitySlots.providerId })
    .from(appointments).innerJoin(availabilitySlots, and(eq(appointments.slotId, availabilitySlots.id), eq(appointments.clinicId, availabilitySlots.clinicId)))
    .where(and(eq(appointments.id, appointmentId), eq(appointments.clinicId, clinicId), isNull(appointments.deletedAt))).limit(1);
  return appointment;
}
export async function transitionAppointment(actor: Actor, input: { appointmentId: string; patientId: string; revision: number; status: AppointmentStatus }) {
  return getDb().transaction((tx) => auditedPatientOperation(tx, actor, input.patientId, "scheduling", `scheduling.appointment_${input.status}`, async () => {
    const [updated] = await tx.update(appointments)
      .set({ status: input.status, revision: input.revision + 1, updatedBy: actor.id, ...(input.status === "checked_in" ? { checkedInAt: new Date() } : {}) })
      .where(and(eq(appointments.id, input.appointmentId), eq(appointments.clinicId, actor.clinicId), eq(appointments.patientId, input.patientId),
        eq(appointments.revision, input.revision), isNull(appointments.deletedAt)))
      .returning({ id: appointments.id, revision: appointments.revision });
    if (!updated) throw new StaleAppointmentError();
    return updated;
  }));
}
// Server-driven close-out inside the clinical completion transaction, so a completed visit
// and a finished appointment commit together. Idempotent when already marked done.
export async function completeAppointment(tx: Transaction, actor: Actor, input: { appointmentId: string; patientId: string }) {
  await tx.update(appointments).set({ status: "done", revision: sql`${appointments.revision} + 1`, updatedBy: actor.id })
    .where(and(eq(appointments.id, input.appointmentId), eq(appointments.clinicId, actor.clinicId), eq(appointments.patientId, input.patientId),
      eq(appointments.status, "in_progress"), isNull(appointments.deletedAt)));
}
export async function findPatientIdentity(clinicId: string, patientId: string, tx?: Transaction) {
  const [patient] = await (tx ?? getDb()).select({ id: patients.id, givenName: patients.givenName, surname: patients.surname, birthDate: patients.birthDate, sex: patients.sex, mrn: patients.mrn })
    .from(patients).where(and(eq(patients.id, patientId), eq(patients.clinicId, clinicId), isNull(patients.deletedAt))).limit(1);
  return patient;
}
