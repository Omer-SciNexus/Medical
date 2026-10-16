import "server-only";
import { z } from "zod";
import { recordScopedEvent, type Actor } from "@/modules/identity";
import { auditedPatientOperation } from "@/modules/identity";
import { getDb, type Transaction } from "@/platform/db";
import { isExclusionViolation, isUniqueViolation } from "@/platform/errors";
import { addClinicDays, clinicDayRange, clinicTimezone, todayInZone, weekdayOf, zonedInstant, zonedStartOfDay } from "@/lib/clinic-day";
import { availabilityQuerySchema, blackoutIdSchema, blackoutSchema, bookingSchema, extendScheduleSchema, patientRegistrationSchema, patientSearchSchema, queryDaySchema, reportRangeSchema, rescheduleSchema, templateIdSchema, templateSchema, transitionSchema, PatientRegistrationError, ScheduleAuthoringError, SlotUnavailableError } from "./validators";
import { canTransition, roleMayTransition, waitingMinutes } from "./policy";
import { claimSlot, completeAppointment, createBlackout, createTemplate, deleteBlackout, deleteTemplate, findAppointment, findPatientIdentity, findSlot, hasImminentAppointment, highestMrnNumber, insertGeneratedSlots, moveAppointmentToSlot, insertPatient, listBlackouts, listOpenSlots, listPatientAppointments, listProviderQueue, listProviderSlots, listTemplates, listWaitingRoom, summariseClinicDays, summariseProviderUtilisation, waitDistribution, patientIsInClinic, searchPatientsByTerm, transitionAppointment } from "./repository";

// Access-control handshake, not a patient-data endpoint. Calling assertCanAccessPatient
// here would recurse. It returns only scope membership and is not a Server Action.
export async function resolvePatientScope(actor: Actor, patientId: string, tx?: Transaction) {
  return patientIsInClinic(z.uuid().parse(actor.clinicId), z.uuid().parse(patientId), tx);
}
/**
 * The other half of that handshake, for the front desk alone: whether this patient has a visit
 * either side of now. Authorization reads it as scheduling authority for staff, so a receptionist
 * can run the waiting room without a standing grant on every patient in the clinic.
 */
export async function resolveImminentVisit(actor: Actor, patientId: string, tx?: Transaction) {
  return hasImminentAppointment(z.uuid().parse(actor.clinicId), z.uuid().parse(patientId), tx);
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
/**
 * A patient keeps their clinician when they move a visit: choosing someone else is a new
 * booking, which is also what grants that clinician scheduling authority over them.
 */
export async function reschedulePatientAppointment(actor: Actor, input: unknown) {
  const { appointmentId, revision, slotId } = rescheduleSchema.parse(input);
  const patientId = ownPatientId(actor);
  const appointment = await findAppointment(actor.clinicId, appointmentId);
  if (!appointment || appointment.patientId !== patientId) throw new AccessScopeError();
  if (appointment.status !== "booked") throw new SlotUnavailableError();
  if (!await findSlot(actor.clinicId, slotId, appointment.providerId)) throw new SlotUnavailableError();
  return moveAppointmentToSlot(actor, { appointmentId, patientId, revision, slotId, providerId: appointment.providerId });
}
export async function listMyAppointmentOptions(actor: Actor, providerId: string) {
  ownPatientId(actor);
  return listProviderAvailability(actor, { providerId: z.uuid().parse(providerId), days: 30 });
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
/**
 * Every appointment in the clinic for one day, as times and states only. The front desk moves
 * people through from here; identifying a particular patient is what the patient search is for.
 */
export async function getWaitingRoomBoard(actor: Actor, input: unknown) {
  requireFrontDesk(actor);
  const { day } = queryDaySchema.parse(input ?? {});
  const timeZone = clinicTimezone();
  const clinicDay = day ?? todayInZone(timeZone);
  const { from, to } = clinicDayRange(clinicDay, timeZone);
  const rows = await listWaitingRoom(actor.clinicId, from, to);
  await recordScopedEvent(actor, { action: "scheduling.board_read", purpose: "scheduling", reason: `${clinicDay}:${rows.length}` });
  return { day: clinicDay, timeZone, entries: rows.map((row) => ({ ...row, waitingMinutes: waitingMinutes(row.checkedInAt) })) };
}
/**
 * The clinic's operating picture over a window of days: how many visits were kept, how many
 * were no-shows, how long people waited and how much of each provider's offered time was taken.
 * Counts and minutes only; nothing here names a patient.
 */
export async function getClinicReport(actor: Actor, input: unknown) {
  requireScheduleAdmin(actor);
  const { from, days } = reportRangeSchema.parse(input ?? {});
  const timeZone = clinicTimezone();
  const start = from ?? addClinicDays(todayInZone(timeZone), -days);
  const end = addClinicDays(start, days);
  const window = { from: zonedStartOfDay(start, timeZone), to: zonedStartOfDay(end, timeZone) };
  const [totals, providers, waits] = await Promise.all([
    summariseClinicDays(actor.clinicId, window.from, window.to),
    summariseProviderUtilisation(actor.clinicId, window.from, window.to),
    waitDistribution(actor.clinicId, window.from, window.to),
  ]);
  await recordScopedEvent(actor, { action: "scheduling.report_read", purpose: "administration", reason: `${start}:${days}` });
  return { from: start, to: end, days, timeZone, totals, providers, waits };
}
function requireFrontDesk(actor: Actor) {
  if ((actor.role !== "staff" && actor.role !== "admin") || !actor.mfaVerified) throw new AccessScopeError();
}
const MRN_PREFIX = "MR-";
/**
 * Registering a patient cannot go through patient authorization: no care relationship to this
 * record can exist before the record does. It is recorded against the new patient all the same.
 */
export async function registerPatient(actor: Actor, input: unknown) {
  requireFrontDesk(actor);
  const details = patientRegistrationSchema.parse(input);
  if (details.birthDate > todayInZone(clinicTimezone())) throw new PatientRegistrationError("A date of birth cannot be in the future.");
  if (details.mrn) {
    try {
      return await recordPatient(actor, { ...details, mrn: details.mrn });
    } catch (error) {
      if (isUniqueViolation(error)) throw new PatientRegistrationError("That medical record number is already used in this clinic.");
      throw error;
    }
  }
  // Assigning the next number races with another front desk doing the same, so the unique
  // index decides and this retries with whatever number is now next.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const next = await highestMrnNumber(actor.clinicId, MRN_PREFIX) + 1;
    try {
      return await recordPatient(actor, { ...details, mrn: `${MRN_PREFIX}${next}` });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new PatientRegistrationError("The clinic's record numbers are busy right now. Try again.");
}
async function recordPatient(actor: Actor, input: { givenName: string; surname: string; birthDate: string; sex: string; mrn: string }) {
  const patient = await insertPatient(actor, input);
  await recordScopedEvent(actor, { action: "scheduling.patient_registered", purpose: "scheduling", patientId: patient.id, resourceId: patient.id });
  return patient;
}
/** Searching is a patient read across the clinic, so the search itself is recorded. */
export async function searchPatients(actor: Actor, input: unknown) {
  requireFrontDesk(actor);
  const { term } = patientSearchSchema.parse(input);
  const matches = await searchPatientsByTerm(actor.clinicId, term);
  await recordScopedEvent(actor, { action: "scheduling.patient_search", purpose: "scheduling", reason: `${matches.length}` });
  return matches;
}
// Schedule authoring is an administrative act on clinic property, not on patient data, so it
// is recorded as a clinic-scoped event rather than through patient authorization.
function requireScheduleAdmin(actor: Actor) {
  if (actor.role !== "admin" || !actor.mfaVerified) throw new AccessScopeError();
}
export async function getScheduleAuthoring(actor: Actor) {
  requireScheduleAdmin(actor);
  const timeZone = clinicTimezone();
  const [templates, blackouts] = await Promise.all([listTemplates(actor.clinicId), listBlackouts(actor.clinicId, zonedStartOfDay(todayInZone(timeZone), timeZone))]);
  return { timeZone, templates, blackouts };
}
export async function addAvailabilityTemplate(actor: Actor, input: unknown) {
  requireScheduleAdmin(actor);
  const { providerId, weekday, start, end, slotMinutes } = templateSchema.parse(input);
  try {
    const template = await createTemplate(actor, { providerId, weekday, startMinute: start, endMinute: end, slotMinutes });
    await recordScopedEvent(actor, { action: "scheduling.template_added", purpose: "administration", resourceId: template.id });
    return template;
  } catch (error) {
    // The exclusion constraint is the authority on overlap; nothing searches for it here.
    if (isExclusionViolation(error)) throw new ScheduleAuthoringError("That overlaps a session this provider already has on that day.");
    throw error;
  }
}
export async function removeAvailabilityTemplate(actor: Actor, input: unknown) {
  requireScheduleAdmin(actor);
  const { templateId } = templateIdSchema.parse(input);
  const removed = await deleteTemplate(actor, templateId);
  if (!removed) throw new ScheduleAuthoringError("That weekly session has already been removed.");
  // Slots already generated stay: withdrawing them is what a blackout is for.
  await recordScopedEvent(actor, { action: "scheduling.template_removed", purpose: "administration", resourceId: templateId });
}
export async function addScheduleBlackout(actor: Actor, input: unknown) {
  requireScheduleAdmin(actor);
  const { providerId, day, endDay, reason } = blackoutSchema.parse(input);
  const timeZone = clinicTimezone();
  const last = endDay ?? day;
  if (last < day) throw new ScheduleAuthoringError("The last day cannot be before the first day.");
  const startsAt = zonedStartOfDay(day, timeZone);
  const endsAt = zonedStartOfDay(addClinicDays(last, 1), timeZone);
  const result = await createBlackout(actor, { providerId, startsAt, endsAt, reason });
  await recordScopedEvent(actor, { action: "scheduling.blackout_added", purpose: "administration", resourceId: result.id });
  return result;
}
export async function removeScheduleBlackout(actor: Actor, input: unknown) {
  requireScheduleAdmin(actor);
  const { blackoutId } = blackoutIdSchema.parse(input);
  const removed = await deleteBlackout(actor, blackoutId);
  if (!removed) throw new ScheduleAuthoringError("That blackout has already been removed.");
  await recordScopedEvent(actor, { action: "scheduling.blackout_removed", purpose: "administration", resourceId: blackoutId });
}
/**
 * Expands a provider's weekly pattern into real slots for the next few weeks. Past times and
 * blacked-out windows are skipped here; anything that would overlap an existing slot is left
 * to the database to refuse, so running this twice adds only what is missing.
 */
export async function extendProviderSchedule(actor: Actor, input: unknown) {
  requireScheduleAdmin(actor);
  const { providerId, weeks } = extendScheduleSchema.parse(input);
  const timeZone = clinicTimezone();
  const today = todayInZone(timeZone);
  const [templates, blackouts] = await Promise.all([listTemplates(actor.clinicId), listBlackouts(actor.clinicId, zonedStartOfDay(today, timeZone))]);
  const mine = templates.filter((template) => template.providerId === providerId);
  if (!mine.length) throw new ScheduleAuthoringError("Add a weekly session for this provider first.");
  const relevant = blackouts.filter((blackout) => blackout.providerId === null || blackout.providerId === providerId);
  const now = Date.now();
  const candidates: { startsAt: Date; endsAt: Date }[] = [];
  let blackedOut = 0;
  for (let offset = 0; offset < weeks * 7; offset += 1) {
    const day = addClinicDays(today, offset);
    for (const template of mine.filter((candidate) => candidate.weekday === weekdayOf(day))) {
      for (let minute = template.startMinute; minute + template.slotMinutes <= template.endMinute; minute += template.slotMinutes) {
        const startsAt = zonedInstant(day, minute, timeZone);
        const endsAt = zonedInstant(day, minute + template.slotMinutes, timeZone);
        if (startsAt.getTime() <= now) continue;
        if (relevant.some((blackout) => startsAt < blackout.endsAt && endsAt > blackout.startsAt)) { blackedOut += 1; continue; }
        candidates.push({ startsAt, endsAt });
      }
    }
  }
  const { created, overlapping } = await insertGeneratedSlots(actor, providerId, candidates);
  await recordScopedEvent(actor, { action: "scheduling.slots_generated", purpose: "administration", resourceId: providerId, reason: `${created}:${overlapping}:${blackedOut}` });
  return { created, existing: overlapping, blackedOut, through: addClinicDays(today, weeks * 7 - 1) };
}
export async function getProviderSlotCount(actor: Actor, providerId: string, days = 28) {
  requireScheduleAdmin(actor);
  const timeZone = clinicTimezone();
  const today = todayInZone(timeZone);
  const slots = await listProviderSlots(actor.clinicId, z.uuid().parse(providerId), zonedStartOfDay(today, timeZone), zonedStartOfDay(addClinicDays(today, days), timeZone));
  return slots.length;
}
export async function advanceAppointment(actor: Actor, input: unknown) {
  const { appointmentId, revision, status } = transitionSchema.parse(input);
  const appointment = await findAppointment(actor.clinicId, appointmentId);
  if (!appointment) throw new AccessScopeError();
  if (!roleMayTransition(actor.role, status) || !canTransition(appointment.status, status)) throw new AccessScopeError();
  return transitionAppointment(actor, { appointmentId, patientId: appointment.patientId, providerId: appointment.providerId, revision, status });
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
