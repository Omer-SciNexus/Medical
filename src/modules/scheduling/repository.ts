import "server-only";
import { and, asc, eq, gt, gte, isNull, lt, ne, notExists, sql } from "drizzle-orm";
import { getDb, type Transaction } from "@/platform/db";
import { auditedPatientOperation, grantWorkflowAccess, type Actor } from "@/modules/identity";
import { isExclusionViolation, isUniqueViolation } from "@/platform/errors";
import { enqueueOutbox } from "@/platform/outbox";
import { appointments, availabilitySlots, availabilityTemplates, patients, scheduleBlackouts } from "./schema";
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
      // Booking is what gives the provider scheduling authority over this patient. Without it
      // the patient would appear in a queue whose owner is then denied every read.
      await grantWorkflowAccess(tx, { clinicId: actor.clinicId, actorId: input.providerId, patientId, purposes: ["scheduling"], grantedBy: actor.id, reason: "Appointment booked with this provider" });
      // Reminders are scheduled by a worker reading this row, not inside the booking request.
      await enqueueOutbox(tx, { clinicId: actor.clinicId, topic: "appointment.booked", resourceId: appointment.id });
      return appointment;
    }));
  } catch (error) {
    // The partial unique index is the real guarantee; the row lock only reduces contention.
    if (isUniqueViolation(error)) throw new SlotUnavailableError();
    throw error;
  }
}
/**
 * Moves an appointment onto another slot in one statement: the row stops referencing the old
 * slot, which releases it, and active_slot_booking is what guarantees the new one was free.
 * No second lock is needed, and a lost race surfaces as the slot simply being taken.
 */
export async function moveAppointmentToSlot(actor: Actor, input: { appointmentId: string; patientId: string; revision: number; slotId: string; providerId: string }) {
  try {
    return await getDb().transaction((tx) => auditedPatientOperation(tx, actor, input.patientId, "scheduling", "scheduling.appointment_rescheduled", async () => {
      const [slot] = await tx.select({ id: availabilitySlots.id, startsAt: availabilitySlots.startsAt }).from(availabilitySlots)
        .where(and(eq(availabilitySlots.id, input.slotId), eq(availabilitySlots.clinicId, actor.clinicId), eq(availabilitySlots.providerId, input.providerId), isNull(availabilitySlots.deletedAt)))
        .for("update").limit(1);
      if (!slot || slot.startsAt.getTime() <= Date.now()) throw new SlotUnavailableError();
      const [moved] = await tx.update(appointments).set({ slotId: input.slotId, revision: input.revision + 1, updatedBy: actor.id })
        .where(and(eq(appointments.id, input.appointmentId), eq(appointments.clinicId, actor.clinicId), eq(appointments.patientId, input.patientId),
          eq(appointments.revision, input.revision), eq(appointments.status, "booked"), isNull(appointments.deletedAt)))
        .returning({ id: appointments.id, revision: appointments.revision, slotId: appointments.slotId });
      if (!moved) throw new StaleAppointmentError();
      await enqueueOutbox(tx, { clinicId: actor.clinicId, topic: "appointment.rescheduled", resourceId: input.appointmentId, uniqueBy: `appointment.rescheduled:${input.appointmentId}:${moved.revision}` });
      return moved;
    }));
  } catch (error) {
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
/**
 * Whether this patient is actually coming in. The front desk's authority comes from the
 * appointment rather than from a standing grant per patient, so a colleague who joins after a
 * booking can still run the waiting room, and their authority lapses with the visit.
 */
export async function hasImminentAppointment(clinicId: string, patientId: string, tx?: Transaction) {
  const now = Date.now();
  const [appointment] = await (tx ?? getDb()).select({ id: appointments.id }).from(appointments)
    .innerJoin(availabilitySlots, and(eq(appointments.slotId, availabilitySlots.id), eq(appointments.clinicId, availabilitySlots.clinicId)))
    .where(and(eq(appointments.clinicId, clinicId), eq(appointments.patientId, patientId), isNull(appointments.deletedAt), ne(appointments.status, "cancelled"),
      gte(availabilitySlots.startsAt, new Date(now - 86_400_000)), lt(availabilitySlots.startsAt, new Date(now + 86_400_000)))).limit(1);
  return Boolean(appointment);
}
/**
 * The waiting-room board. Deliberately selects no patient column: this screen faces a room, so
 * it can show times and states and nothing that identifies who is waiting.
 */
export async function listWaitingRoom(clinicId: string, from: Date, to: Date) {
  return getDb().select({ id: appointments.id, status: appointments.status, revision: appointments.revision, checkedInAt: appointments.checkedInAt,
    startsAt: availabilitySlots.startsAt, endsAt: availabilitySlots.endsAt, providerId: availabilitySlots.providerId })
    .from(appointments)
    .innerJoin(availabilitySlots, and(eq(appointments.slotId, availabilitySlots.id), eq(appointments.clinicId, availabilitySlots.clinicId)))
    .where(and(eq(appointments.clinicId, clinicId), isNull(appointments.deletedAt), gte(availabilitySlots.startsAt, from), lt(availabilitySlots.startsAt, to)))
    .orderBy(asc(availabilitySlots.startsAt)).limit(200);
}
/**
 * System-level read for the worker: no actor, and nothing clinical. A reminder needs the time,
 * the state and what to bring, and the worker has no person on whose behalf to be authorized.
 */
/**
 * The operating picture for a date range, derived from the appointment table and the slots it
 * references: no-shows, how long people waited, and how much of each session was taken up.
 * Counts and minutes only, so nothing here identifies a patient.
 */
export async function summariseClinicDays(clinicId: string, from: Date, to: Date) {
  const [totals] = await getDb().select({
    booked: sql<number>`count(*)::int`,
    seen: sql<number>`count(*) FILTER (WHERE ${appointments.status} = 'done')::int`,
    noShows: sql<number>`count(*) FILTER (WHERE ${appointments.status} = 'no_show')::int`,
    cancelled: sql<number>`count(*) FILTER (WHERE ${appointments.status} = 'cancelled')::int`,
    arrived: sql<number>`count(${appointments.checkedInAt})::int`,
    medianWait: sql<number | null>`(percentile_disc(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (${availabilitySlots.startsAt} - ${appointments.checkedInAt})) / 60))::float8`,
    longestWait: sql<number | null>`(max(EXTRACT(EPOCH FROM (${availabilitySlots.startsAt} - ${appointments.checkedInAt})) / 60))::float8`,
  }).from(appointments)
    .innerJoin(availabilitySlots, and(eq(appointments.slotId, availabilitySlots.id), eq(appointments.clinicId, availabilitySlots.clinicId)))
    .where(and(eq(appointments.clinicId, clinicId), isNull(appointments.deletedAt), gte(availabilitySlots.startsAt, from), lt(availabilitySlots.startsAt, to)));
  return totals;
}
export async function summariseProviderUtilisation(clinicId: string, from: Date, to: Date) {
  return getDb().select({
    providerId: availabilitySlots.providerId,
    slots: sql<number>`count(*)::int`,
    offeredMinutes: sql<number>`coalesce(sum(EXTRACT(EPOCH FROM (${availabilitySlots.endsAt} - ${availabilitySlots.startsAt})) / 60), 0)::int`,
    booked: sql<number>`count(${appointments.id})::int`,
    seen: sql<number>`count(*) FILTER (WHERE ${appointments.status} = 'done')::int`,
    noShows: sql<number>`count(*) FILTER (WHERE ${appointments.status} = 'no_show')::int`,
  }).from(availabilitySlots)
    .leftJoin(appointments, and(eq(appointments.slotId, availabilitySlots.id), eq(appointments.clinicId, availabilitySlots.clinicId),
      isNull(appointments.deletedAt), ne(appointments.status, "cancelled")))
    .where(and(eq(availabilitySlots.clinicId, clinicId), isNull(availabilitySlots.deletedAt), gte(availabilitySlots.startsAt, from), lt(availabilitySlots.startsAt, to)))
    .groupBy(availabilitySlots.providerId).limit(100);
}
/** Waits grouped into bands, which is more honest about the distribution than an average. */
export async function waitDistribution(clinicId: string, from: Date, to: Date) {
  const rows = await getDb().select({
    band: sql<string>`CASE
      WHEN EXTRACT(EPOCH FROM (${availabilitySlots.startsAt} - ${appointments.checkedInAt})) / 60 < 0 THEN 'late'
      WHEN EXTRACT(EPOCH FROM (${availabilitySlots.startsAt} - ${appointments.checkedInAt})) / 60 < 5 THEN 'under 5'
      WHEN EXTRACT(EPOCH FROM (${availabilitySlots.startsAt} - ${appointments.checkedInAt})) / 60 < 15 THEN '5 to 15'
      WHEN EXTRACT(EPOCH FROM (${availabilitySlots.startsAt} - ${appointments.checkedInAt})) / 60 < 30 THEN '15 to 30'
      ELSE 'over 30' END`,
    arrivals: sql<number>`count(*)::int`,
  }).from(appointments)
    .innerJoin(availabilitySlots, and(eq(appointments.slotId, availabilitySlots.id), eq(appointments.clinicId, availabilitySlots.clinicId)))
    .where(and(eq(appointments.clinicId, clinicId), isNull(appointments.deletedAt), sql`${appointments.checkedInAt} IS NOT NULL`,
      gte(availabilitySlots.startsAt, from), lt(availabilitySlots.startsAt, to)))
    .groupBy(sql`1`);
  return rows;
}
export async function findReminderTarget(appointmentId: string) {
  const [appointment] = await getDb().select({ id: appointments.id, clinicId: appointments.clinicId, patientId: appointments.patientId,
    status: appointments.status, preparation: appointments.preparation, startsAt: availabilitySlots.startsAt })
    .from(appointments).innerJoin(availabilitySlots, and(eq(appointments.slotId, availabilitySlots.id), eq(appointments.clinicId, availabilitySlots.clinicId)))
    .where(and(eq(appointments.id, appointmentId), isNull(appointments.deletedAt))).limit(1);
  return appointment;
}
export async function listReminderWindow(hoursAhead: number) {
  const now = new Date();
  return getDb().select({ id: appointments.id })
    .from(appointments).innerJoin(availabilitySlots, and(eq(appointments.slotId, availabilitySlots.id), eq(appointments.clinicId, availabilitySlots.clinicId)))
    .where(and(isNull(appointments.deletedAt), eq(appointments.status, "booked"),
      gte(availabilitySlots.startsAt, now), lt(availabilitySlots.startsAt, new Date(now.getTime() + hoursAhead * 3_600_000))))
    .orderBy(asc(availabilitySlots.startsAt)).limit(500);
}
export async function findAppointment(clinicId: string, appointmentId: string) {
  const [appointment] = await getDb().select({ id: appointments.id, patientId: appointments.patientId, reason: appointments.reason, status: appointments.status, revision: appointments.revision,
    startsAt: availabilitySlots.startsAt, providerId: availabilitySlots.providerId })
    .from(appointments).innerJoin(availabilitySlots, and(eq(appointments.slotId, availabilitySlots.id), eq(appointments.clinicId, availabilitySlots.clinicId)))
    .where(and(eq(appointments.id, appointmentId), eq(appointments.clinicId, clinicId), isNull(appointments.deletedAt))).limit(1);
  return appointment;
}
export async function transitionAppointment(actor: Actor, input: { appointmentId: string; patientId: string; providerId: string; revision: number; status: AppointmentStatus }) {
  return getDb().transaction((tx) => auditedPatientOperation(tx, actor, input.patientId, "scheduling", `scheduling.appointment_${input.status}`, async () => {
    const [updated] = await tx.update(appointments)
      .set({ status: input.status, revision: input.revision + 1, updatedBy: actor.id, ...(input.status === "checked_in" ? { checkedInAt: new Date() } : {}) })
      .where(and(eq(appointments.id, input.appointmentId), eq(appointments.clinicId, actor.clinicId), eq(appointments.patientId, input.patientId),
        eq(appointments.revision, input.revision), isNull(appointments.deletedAt)))
      .returning({ id: appointments.id, revision: appointments.revision });
    if (!updated) throw new StaleAppointmentError();
    if (input.status === "cancelled" || input.status === "no_show") {
      await enqueueOutbox(tx, { clinicId: actor.clinicId, topic: "appointment.cancelled", resourceId: input.appointmentId });
    }
    // Arrival is when the chart opens. Authority to read, document and prescribe begins with
    // the patient physically here, commits with the check-in itself, and stays revocable.
    if (input.status === "checked_in") {
      await grantWorkflowAccess(tx, { clinicId: actor.clinicId, actorId: input.providerId, patientId: input.patientId,
        purposes: ["clinical.read", "clinical.write", "prescribe"], grantedBy: actor.id, reason: "Patient arrived for a booked appointment" });
    }
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
export async function insertPatient(actor: Actor, input: { givenName: string; surname: string; birthDate: string; sex: string; mrn: string }) {
  const [patient] = await getDb().insert(patients).values({ ...input, clinicId: actor.clinicId, createdBy: actor.id, updatedBy: actor.id })
    .returning({ id: patients.id, mrn: patients.mrn });
  return patient;
}
/** Highest numeric MRN in this clinic. The unique index, not this read, is the guarantee. */
export async function highestMrnNumber(clinicId: string, prefix: string) {
  const [row] = await getDb().select({ highest: sql<number | null>`max(nullif(regexp_replace(${patients.mrn}, '^' || ${prefix} || '(\\d+)$', '\\1'), ${patients.mrn})::bigint)` })
    .from(patients).where(eq(patients.clinicId, clinicId));
  return Number(row?.highest ?? 0);
}
export async function searchPatientsByTerm(clinicId: string, term: string) {
  const like = `%${term.toLowerCase()}%`;
  return getDb().select({ id: patients.id, givenName: patients.givenName, surname: patients.surname, birthDate: patients.birthDate, sex: patients.sex, mrn: patients.mrn })
    .from(patients).where(and(eq(patients.clinicId, clinicId), isNull(patients.deletedAt),
      sql`(lower(${patients.surname}) LIKE ${like} OR lower(${patients.givenName}) LIKE ${like} OR lower(${patients.mrn}) LIKE ${like})`))
    .orderBy(asc(patients.surname), asc(patients.givenName)).limit(25);
}
export async function listTemplates(clinicId: string) {
  return getDb().select({ id: availabilityTemplates.id, providerId: availabilityTemplates.providerId, weekday: availabilityTemplates.weekday,
    startMinute: availabilityTemplates.startMinute, endMinute: availabilityTemplates.endMinute, slotMinutes: availabilityTemplates.slotMinutes })
    .from(availabilityTemplates).where(and(eq(availabilityTemplates.clinicId, clinicId), isNull(availabilityTemplates.deletedAt)))
    .orderBy(asc(availabilityTemplates.weekday), asc(availabilityTemplates.startMinute)).limit(500);
}
export async function createTemplate(actor: Actor, input: { providerId: string; weekday: number; startMinute: number; endMinute: number; slotMinutes: number }) {
  const [template] = await getDb().insert(availabilityTemplates)
    .values({ ...input, clinicId: actor.clinicId, createdBy: actor.id, updatedBy: actor.id }).returning({ id: availabilityTemplates.id });
  return template;
}
export async function deleteTemplate(actor: Actor, templateId: string) {
  const [template] = await getDb().update(availabilityTemplates).set({ deletedAt: new Date(), updatedBy: actor.id })
    .where(and(eq(availabilityTemplates.id, templateId), eq(availabilityTemplates.clinicId, actor.clinicId), isNull(availabilityTemplates.deletedAt)))
    .returning({ id: availabilityTemplates.id });
  return template;
}
export async function listBlackouts(clinicId: string, from: Date) {
  return getDb().select({ id: scheduleBlackouts.id, providerId: scheduleBlackouts.providerId, startsAt: scheduleBlackouts.startsAt, endsAt: scheduleBlackouts.endsAt, reason: scheduleBlackouts.reason })
    .from(scheduleBlackouts).where(and(eq(scheduleBlackouts.clinicId, clinicId), isNull(scheduleBlackouts.deletedAt), gte(scheduleBlackouts.endsAt, from)))
    .orderBy(asc(scheduleBlackouts.startsAt)).limit(200);
}
export async function deleteBlackout(actor: Actor, blackoutId: string) {
  const [blackout] = await getDb().update(scheduleBlackouts).set({ deletedAt: new Date(), updatedBy: actor.id })
    .where(and(eq(scheduleBlackouts.id, blackoutId), eq(scheduleBlackouts.clinicId, actor.clinicId), isNull(scheduleBlackouts.deletedAt)))
    .returning({ id: scheduleBlackouts.id });
  return blackout;
}
/**
 * Adds a blackout and withdraws the free slots it covers. A slot with a live appointment is
 * left alone and counted instead: the patient has to be moved before the time can be closed.
 */
export async function createBlackout(actor: Actor, input: { providerId: string | null; startsAt: Date; endsAt: Date; reason: string }) {
  return getDb().transaction(async (tx) => {
    const [blackout] = await tx.insert(scheduleBlackouts)
      .values({ ...input, clinicId: actor.clinicId, createdBy: actor.id, updatedBy: actor.id }).returning({ id: scheduleBlackouts.id });
    const covered = and(eq(availabilitySlots.clinicId, actor.clinicId), isNull(availabilitySlots.deletedAt),
      lt(availabilitySlots.startsAt, input.endsAt), gt(availabilitySlots.endsAt, input.startsAt),
      input.providerId ? eq(availabilitySlots.providerId, input.providerId) : undefined);
    const booked = await tx.select({ id: availabilitySlots.id }).from(availabilitySlots)
      .where(and(covered, sql`EXISTS (SELECT 1 FROM ${appointments} WHERE ${appointments.slotId} = ${availabilitySlots.id} AND ${appointments.deletedAt} IS NULL AND ${appointments.status} <> 'cancelled')`));
    const withdrawn = await tx.update(availabilitySlots).set({ deletedAt: new Date(), updatedBy: actor.id })
      .where(and(covered, notExists(tx.select({ one: sql`1` }).from(appointments).where(and(eq(appointments.slotId, availabilitySlots.id), isNull(appointments.deletedAt), ne(appointments.status, "cancelled"))))))
      .returning({ id: availabilitySlots.id });
    return { id: blackout.id, withdrawn: withdrawn.length, booked: booked.length };
  });
}
export async function listProviderSlots(clinicId: string, providerId: string, from: Date, to: Date) {
  return getDb().select({ id: availabilitySlots.id, startsAt: availabilitySlots.startsAt, endsAt: availabilitySlots.endsAt })
    .from(availabilitySlots).where(and(eq(availabilitySlots.clinicId, clinicId), eq(availabilitySlots.providerId, providerId), isNull(availabilitySlots.deletedAt),
      gte(availabilitySlots.startsAt, from), lt(availabilitySlots.startsAt, to))).orderBy(asc(availabilitySlots.startsAt)).limit(2000);
}
/**
 * Inserts each candidate in its own savepoint so no_provider_slot_overlap can refuse the ones
 * that clash — with an existing slot or with another candidate — without losing the rest.
 * Re-running an extension is therefore safe and simply reports what was already there.
 */
export async function insertGeneratedSlots(actor: Actor, providerId: string, candidates: { startsAt: Date; endsAt: Date }[]) {
  return getDb().transaction(async (tx) => {
    let created = 0;
    let overlapping = 0;
    for (const candidate of candidates) {
      try {
        await tx.transaction(async (savepoint) => {
          await savepoint.insert(availabilitySlots).values({ ...candidate, clinicId: actor.clinicId, providerId, createdBy: actor.id, updatedBy: actor.id });
        });
        created += 1;
      } catch (error) {
        if (!isExclusionViolation(error)) throw error;
        overlapping += 1;
      }
    }
    return { created, overlapping };
  });
}
export async function findPatientIdentity(clinicId: string, patientId: string, tx?: Transaction) {
  const [patient] = await (tx ?? getDb()).select({ id: patients.id, givenName: patients.givenName, surname: patients.surname, birthDate: patients.birthDate, sex: patients.sex, mrn: patients.mrn })
    .from(patients).where(and(eq(patients.id, patientId), eq(patients.clinicId, clinicId), isNull(patients.deletedAt))).limit(1);
  return patient;
}
