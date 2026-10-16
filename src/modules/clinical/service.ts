import "server-only";
import { z } from "zod";
import { getClinicSettings, recordScopedEvent, type Actor } from "@/modules/identity";
import { getAppointmentForCare, getPatientIdentity } from "@/modules/scheduling";
import { allergySchema, amendNoteSchema, completeEncounterSchema, draftRequestSchema, EncounterStateError, noteDraftSchema, openEncounterSchema, problemSchema, problemStatusSchema, signNoteSchema, vitalsSchema } from "./validators";
import { draftVisitNote } from "./assist";
import { observationSeverity, patientAge, vitalByKey } from "./policy";
import { amendNoteVersion, completeEncounter, findChargeSummary, findCurrentNote, findEncounter, insertAllergy, insertObservations, insertProblem, listNoteHistory, listPatientEncounters, openEncounter, readChart, readPublishedSummary, saveNoteVersion, setProblemStatus, signNoteVersion } from "./repository";

function requireClinician(actor: Actor) {
  if (actor.role !== "clinician" || !actor.mfaVerified) throw new EncounterStateError("Only a verified clinician may change a visit record.");
}
async function requireEncounter(actor: Actor, encounterId: string) {
  const encounter = await findEncounter(actor.clinicId, z.uuid().parse(encounterId));
  if (!encounter) throw new EncounterStateError("This visit could not be found.");
  return encounter;
}
export async function startEncounter(actor: Actor, input: unknown) {
  requireClinician(actor);
  const { appointmentId } = openEncounterSchema.parse(input);
  const appointment = await getAppointmentForCare(actor, appointmentId);
  if (appointment.status === "cancelled" || appointment.status === "no_show") throw new EncounterStateError("This appointment is no longer active.");
  return openEncounter(actor, { appointmentId, patientId: appointment.patientId });
}
export async function getEncounterWorkspace(actor: Actor, encounterId: string) {
  requireClinician(actor);
  const encounter = await requireEncounter(actor, encounterId);
  // Authorization and audit happen inside each of these reads, not here.
  const [patient, chart, note, history, charge] = await Promise.all([
    getPatientIdentity(actor, encounter.patientId),
    readChart(actor, encounter.patientId),
    findCurrentNote(actor.clinicId, encounter.id),
    listNoteHistory(actor.clinicId, encounter.id),
    findChargeSummary(actor.clinicId, encounter.id),
  ]);
  if (!note) throw new EncounterStateError("This visit has no note yet.");
  return { encounter, patient: { ...patient, age: patientAge(patient.birthDate) }, chart, note, history, charge: charge ?? null };
}
export async function saveNote(actor: Actor, input: unknown) {
  requireClinician(actor);
  const draft = noteDraftSchema.parse(input);
  const encounter = await requireEncounter(actor, draft.encounterId);
  return saveNoteVersion(actor, { ...draft, patientId: encounter.patientId });
}
export async function signNote(actor: Actor, input: unknown) {
  requireClinician(actor);
  const request = signNoteSchema.parse(input);
  const encounter = await requireEncounter(actor, request.encounterId);
  return signNoteVersion(actor, { ...request, patientId: encounter.patientId });
}
export async function amendNote(actor: Actor, input: unknown) {
  requireClinician(actor);
  const request = amendNoteSchema.parse(input);
  const encounter = await requireEncounter(actor, request.encounterId);
  return amendNoteVersion(actor, { ...request, patientId: encounter.patientId });
}
async function requireOpenEncounter(actor: Actor, encounterId: string) {
  requireClinician(actor);
  const encounter = await requireEncounter(actor, encounterId);
  if (encounter.status !== "in_progress") throw new EncounterStateError("This visit is closed, so its chart can no longer be added to here.");
  return encounter;
}
/**
 * Records what was measured at the bedside. Each reading is stored with the reference range it
 * was read against and the flag that range produces, so a later reader sees the same judgment
 * the clinician saw rather than one recomputed against a range that has since changed.
 */
export async function recordVitals(actor: Actor, input: unknown) {
  const { encounterId, readings } = vitalsSchema.parse(input);
  const encounter = await requireOpenEncounter(actor, encounterId);
  const rows = Object.entries(readings).filter(([, value]) => value !== "").map(([key, raw]) => {
    const vital = vitalByKey(key);
    if (!vital) throw new EncounterStateError("That measurement is not one this clinic records.");
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new EncounterStateError(`Enter a number for ${vital.label.toLowerCase()}.`);
    if (value < vital.min || value > vital.max) throw new EncounterStateError(`${vital.label} of ${raw} ${vital.unit} is outside what can be recorded. Check the value.`);
    return { label: vital.label, value: String(value), unit: vital.unit,
      referenceLow: vital.low === null ? null : String(vital.low), referenceHigh: vital.high === null ? null : String(vital.high),
      flag: observationSeverity(value, vital) };
  });
  if (!rows.length) throw new EncounterStateError("Enter at least one measurement.");
  return insertObservations(actor, { patientId: encounter.patientId, encounterId: encounter.id, rows });
}
export async function addProblem(actor: Actor, input: unknown) {
  const { encounterId, description } = problemSchema.parse(input);
  const encounter = await requireOpenEncounter(actor, encounterId);
  return insertProblem(actor, { patientId: encounter.patientId, description });
}
export async function changeProblemStatus(actor: Actor, input: unknown) {
  const { encounterId, problemId, status } = problemStatusSchema.parse(input);
  const encounter = await requireOpenEncounter(actor, encounterId);
  const updated = await setProblemStatus(actor, { patientId: encounter.patientId, problemId, status });
  if (!updated) throw new EncounterStateError("That problem is no longer on this chart.");
  return updated;
}
export async function recordAllergy(actor: Actor, input: unknown) {
  const { encounterId, substance, reaction, severity } = allergySchema.parse(input);
  const encounter = await requireOpenEncounter(actor, encounterId);
  return insertAllergy(actor, { patientId: encounter.patientId, substance, reaction, severity });
}
export async function finishEncounter(actor: Actor, input: unknown) {
  requireClinician(actor);
  const request = completeEncounterSchema.parse(input);
  const encounter = await requireEncounter(actor, request.encounterId);
  const clinic = await getClinicSettings(actor);
  if (!clinic) throw new EncounterStateError("This clinic could not be loaded.");
  return completeEncounter(actor, { encounterId: encounter.id, patientId: encounter.patientId, summary: request.summary, currency: clinic.currency });
}
// Drafting assistance reads the chart under normal authorization and records that it ran.
// The returned text is a draft only; the clinician edits it and their signature is what counts.
export async function draftNoteText(actor: Actor, input: unknown) {
  requireClinician(actor);
  const { encounterId, observations } = draftRequestSchema.parse(input);
  const encounter = await requireEncounter(actor, encounterId);
  if (encounter.status !== "in_progress") throw new EncounterStateError("This visit is no longer open for editing.");
  const [patient, chart, appointment] = await Promise.all([
    getPatientIdentity(actor, encounter.patientId), readChart(actor, encounter.patientId), getAppointmentForCare(actor, encounter.appointmentId),
  ]);
  await recordScopedEvent(actor, { action: "clinical.draft_assisted", purpose: "clinical.write", resourceId: encounter.id });
  return draftVisitNote({ reason: appointment.reason, age: patientAge(patient.birthDate), sex: patient.sex,
    allergies: chart.allergies, problems: chart.problems, observations: chart.observations, clinicianNotes: observations });
}
export async function getPatientChart(actor: Actor, patientId: string) {
  return readChart(actor, z.uuid().parse(patientId));
}
export async function listMyVisits(actor: Actor) {
  if (actor.role !== "patient" || !actor.patientId) throw new EncounterStateError("This view is only available to a patient account.");
  return listPatientEncounters(actor, actor.patientId);
}
/** The patient-facing view. Returns the designed unpublished state rather than draft text. */
export async function getVisitSummary(actor: Actor, encounterId: string) {
  const encounter = await requireEncounter(actor, encounterId);
  const [summary, patient] = await Promise.all([readPublishedSummary(actor, encounter.id, encounter.patientId), getPatientIdentity(actor, encounter.patientId)]);
  if (!summary) throw new EncounterStateError("This visit could not be found.");
  return { summary, patient, appointmentId: encounter.appointmentId };
}
