import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "@/platform/db";
import { headObject, objectStoreConfigured, presignDownload, presignUpload } from "@/platform/objects";
import { auditedPatientOperation, getClinicSettings, hasFreshTotp, recordScopedEvent, type Actor } from "@/modules/identity";
import { addVisitCharge, getPriceList, getVisitInvoice, removeVisitCharge } from "@/modules/billing";
import { getAppointmentForCare, getPatientIdentity } from "@/modules/scheduling";
import { allergySchema, amendNoteSchema, chargeLineReferenceSchema, documentIdSchema, documentRequestSchema, completeEncounterSchema, draftRequestSchema, EncounterStateError, issuePrescriptionSchema, medicationSearchSchema, noteDraftSchema, openEncounterSchema, prescriptionIdSchema, prescriptionSchema, problemSchema, problemStatusSchema, signNoteSchema, vitalsSchema } from "./validators";
import { draftVisitNote } from "./assist";
import { checkPrescribingSafety, safetyProviderIsFixture, safetyProviderName, FIXTURE_SOURCE } from "./safety";
import { observationSeverity, patientAge, vitalByKey } from "./policy";
import { amendNoteVersion, cancelPrescriptionRow, completeEncounter, findChargeSummary, findCurrentNote, findEncounter, findMedication, findPrescription, insertAllergy, insertObservations, insertPrescription, insertProblem, issuePrescriptionRow, confirmDocument, discardDocument, findDocument, findPublishedSummaryState, insertDocument, listChartVisits, listDocuments, listEncounterPrescriptions, listNoteHistory, listPatientEncounters, listPatientPrescriptions, openEncounter, readChart, readPublishedSummary, recordSafetyCheck, saveNoteVersion, searchMedications, setProblemStatus, signNoteVersion } from "./repository";

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
  const { appointmentId, revision } = openEncounterSchema.parse(input);
  const appointment = await getAppointmentForCare(actor, appointmentId);
  if (appointment.status === "cancelled" || appointment.status === "no_show") throw new EncounterStateError("This appointment is no longer active.");
  return openEncounter(actor, { appointmentId, patientId: appointment.patientId, revision });
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
  const [invoice, priceList] = await Promise.all([getVisitInvoice(actor.clinicId, encounter.id), getPriceList(actor)]);
  return { encounter, patient: { ...patient, age: patientAge(patient.birthDate) }, chart, note, history, charge: charge ?? null, invoice: invoice ?? null, priceList };
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
export async function findMedications(actor: Actor, input: unknown) {
  requireClinician(actor);
  const { term } = medicationSearchSchema.parse(input);
  return searchMedications(term);
}
export async function getPrescribingWorkspace(actor: Actor, encounterId: string) {
  requireClinician(actor);
  const encounter = await requireEncounter(actor, encounterId);
  const [chart, prescriptions] = await Promise.all([readChart(actor, encounter.patientId), listEncounterPrescriptions(actor.clinicId, encounter.id)]);
  return { encounter, chart, prescriptions, provider: { name: safetyProviderName(), fixture: safetyProviderIsFixture() } };
}
export async function draftPrescription(actor: Actor, input: unknown) {
  const { encounterId, medicationId, dose, unit, route, frequency, durationDays } = prescriptionSchema.parse(input);
  const encounter = await requireOpenEncounter(actor, encounterId);
  if (!await findMedication(medicationId)) throw new EncounterStateError("That medication is not in the catalogue.");
  return insertPrescription(actor, { patientId: encounter.patientId, encounterId: encounter.id, medicationId, dose: String(dose), unit, route, frequency, durationDays });
}
/** Runs the configured provider and stores its verdict, its name and what it said. */
export async function checkPrescription(actor: Actor, input: unknown) {
  const { prescriptionId } = prescriptionIdSchema.parse(input);
  requireClinician(actor);
  const prescription = await requirePrescription(actor, prescriptionId);
  if (prescription.status !== "draft") throw new EncounterStateError("This prescription is no longer a draft.");
  const checkedAt = new Date();
  const chart = await readChart(actor, prescription.patientId);
  const current = await listEncounterPrescriptions(actor.clinicId, prescription.encounterId);
  const verdict = await checkPrescribingSafety({
    ingredient: prescription.ingredient, name: prescription.name, dose: Number(prescription.dose), unit: prescription.unit,
    route: prescription.route, frequency: prescription.frequency, durationDays: prescription.durationDays,
    allergies: chart.allergies.map((allergy) => ({ substance: allergy.substance, severity: allergy.severity })),
    current: current.filter((row) => row.id !== prescription.id && row.status !== "cancelled").map((row) => ({ ingredient: row.ingredient, name: row.name })),
  });
  const checked = await recordSafetyCheck(actor, { prescriptionId, patientId: prescription.patientId, status: verdict.status, source: verdict.source, findings: verdict.findings, checkedAt });
  if (!checked) throw new EncounterStateError("This prescription is no longer a draft.");
  return verdict;
}
/**
 * Issuing is the point of no return, so the rules are explicit here and the database holds the
 * same line: a hard stop can never be overridden, a warning needs a fresh authenticator check
 * and a written justification, and a fixture-backed check cannot stand behind an issued row.
 */
export async function issuePrescription(actor: Actor, input: unknown) {
  const { prescriptionId, overrideReason } = issuePrescriptionSchema.parse(input);
  requireClinician(actor);
  const prescription = await requirePrescription(actor, prescriptionId);
  if (prescription.status !== "draft") throw new EncounterStateError("This prescription has already been issued or cancelled.");
  if (prescription.safetyStatus === "unchecked") throw new EncounterStateError("Run the safety check before issuing.");
  if (prescription.safetyStatus === "blocked") throw new EncounterStateError("This is a hard stop and cannot be issued. Cancel it and choose another medicine.");
  if (prescription.safetyStatus === "unavailable") throw new EncounterStateError("The safety service could not be reached, so this cannot be issued. Run the check again.");
  if (prescription.safetySource === FIXTURE_SOURCE) {
    throw new EncounterStateError("This build's safety check is a synthetic fixture, so nothing it clears may be issued. Configure a real safety service first.");
  }
  if (!prescription.safetyCheckedAt || Date.now() - prescription.safetyCheckedAt.getTime() > 15 * 60_000 || prescription.safetyCheckedAt.getTime() > Date.now()) {
    throw new EncounterStateError("This safety check has expired. Run it again before issuing.");
  }
  if (prescription.safetyStatus === "warning") {
    if (!hasFreshTotp(actor)) throw new EncounterStateError("Overriding a warning needs a fresh authenticator check. Sign in again, then issue.");
    if (!overrideReason || overrideReason.length < 20) throw new EncounterStateError("Record at least 20 characters explaining why this warning is being overridden.");
  }
  const issued = await issuePrescriptionRow(actor, { prescriptionId, patientId: prescription.patientId,
    overrideReason: prescription.safetyStatus === "warning" ? overrideReason ?? null : null, expectedSafety: prescription.safetyStatus, expectedSource: prescription.safetySource!, checkedAt: prescription.safetyCheckedAt });
  if (!issued) throw new EncounterStateError("This prescription changed while you were reviewing it. Reload and check it again.");
  return issued;
}
export async function cancelPrescription(actor: Actor, input: unknown) {
  const { prescriptionId } = prescriptionIdSchema.parse(input);
  requireClinician(actor);
  const prescription = await requirePrescription(actor, prescriptionId);
  const cancelled = await cancelPrescriptionRow(actor, { prescriptionId, patientId: prescription.patientId });
  if (!cancelled) throw new EncounterStateError("This prescription is already cancelled.");
}
async function requirePrescription(actor: Actor, prescriptionId: string) {
  const prescription = await findPrescription(actor.clinicId, prescriptionId);
  if (!prescription) throw new EncounterStateError("This prescription could not be found.");
  return prescription;
}
/**
 * The whole chart for one patient. Each section is read through its own audited operation, so
 * opening this screen records a chart read exactly as the queue's side panel does.
 */
export async function getPatientChartView(actor: Actor, patientId: string) {
  requireClinician(actor);
  const id = z.uuid().parse(patientId);
  const [patient, chart, visits, prescriptions] = await Promise.all([
    getPatientIdentity(actor, id), readChart(actor, id), listChartVisits(actor, id), listPatientPrescriptions(actor.clinicId, id),
  ]);
  return { patient: { ...patient, age: patientAge(patient.birthDate) }, chart, visits, prescriptions };
}
/** Read by the worker, which has no actor: it reports only that a summary exists to read. */
export async function readSummaryForNotification(clinicId: string, encounterId: string) {
  return findPublishedSummaryState(z.uuid().parse(clinicId), z.uuid().parse(encounterId));
}
/** Charge lines are patient writes on an open visit, so they run through the same guard. */
export async function addEncounterCharge(actor: Actor, input: unknown) {
  const { encounterId } = chargeLineReferenceSchema.parse(input);
  const encounter = await requireOpenEncounter(actor, encounterId);
  const clinic = await getClinicSettings(actor);
  if (!clinic) throw new EncounterStateError("This clinic could not be loaded.");
  return addVisitCharge(actor, input, { patientId: encounter.patientId, currency: clinic.currency });
}
export async function removeEncounterCharge(actor: Actor, input: unknown) {
  const { encounterId } = chargeLineReferenceSchema.parse(input);
  const encounter = await requireOpenEncounter(actor, encounterId);
  return removeVisitCharge(actor, input, { patientId: encounter.patientId, encounterId });
}
/**
 * Registers an attachment and hands back a short-lived upload URL with the content type signed
 * into it. The row is not visible until the stored object has been checked against it, so a
 * failed or mismatched upload leaves nothing on the chart.
 */
export async function requestDocumentUpload(actor: Actor, input: unknown) {
  requireClinician(actor);
  if (!objectStoreConfigured()) throw new EncounterStateError("Document storage is not configured for this deployment.");
  const request = documentRequestSchema.parse(input);
  if (request.encounterId) await requireOpenEncounter(actor, request.encounterId);
  const objectKey = `${actor.clinicId}/${request.patientId}/${randomUUID()}`;
  const document = await insertDocument(actor, { ...request, encounterId: request.encounterId ?? null, objectKey });
  const upload = presignUpload(objectKey, request.contentType);
  return { documentId: document.id, uploadUrl: upload.url, expiresAt: upload.expiresAt, contentType: request.contentType };
}
/**
 * The server's own check of what actually landed, before the document joins the chart. The
 * probe is a parameter so this rule can be exercised without an object store standing by.
 */
export async function confirmDocumentUpload(actor: Actor, input: unknown, probe: typeof headObject = headObject) {
  requireClinician(actor);
  const { documentId } = documentIdSchema.parse(input);
  const document = await findDocument(actor.clinicId, documentId);
  if (!document) throw new EncounterStateError("That document could not be found.");
  const stored = await probe(document.objectKey);
  if (!stored) throw new EncounterStateError("That upload did not arrive. Try attaching the file again.");
  if (stored.contentType !== document.contentType || stored.byteSize !== document.byteSize) {
    await discardDocument(actor, documentId);
    throw new EncounterStateError("What was stored does not match what was attached, so it has been discarded.");
  }
  const confirmed = await confirmDocument(actor, documentId, document.patientId);
  if (!confirmed) throw new EncounterStateError("That document has already been stored.");
  return { id: confirmed.id, filename: document.filename };
}
export async function listPatientDocuments(actor: Actor, patientId: string) {
  requireClinician(actor);
  return listDocuments(actor, z.uuid().parse(patientId));
}
/** Opening an attachment is a chart read: authorized, recorded, and good for two minutes. */
export async function requestDocumentDownload(actor: Actor, input: unknown) {
  requireClinician(actor);
  const { documentId } = documentIdSchema.parse(input);
  const document = await findDocument(actor.clinicId, documentId);
  if (!document?.confirmedAt) throw new EncounterStateError("That document could not be found.");
  return getDb().transaction((tx) => auditedPatientOperation(tx, actor, document.patientId, "clinical.read", "clinical.document_opened", async () => {
    const link = presignDownload(document.objectKey);
    return { url: link.url, expiresAt: link.expiresAt, filename: document.filename, contentType: document.contentType };
  }));
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
    allergies: chart.allergies, problems: chart.problems, observations: chart.observations.filter((reading) => reading.encounterId === encounter.id), clinicianNotes: observations });
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
  // The invoice is part of what a patient is owed an account of, so it travels with the summary.
  const invoice = summary.published ? await getVisitInvoice(actor.clinicId, encounter.id) : undefined;
  return { summary, patient, appointmentId: encounter.appointmentId, invoice: invoice ?? null };
}
