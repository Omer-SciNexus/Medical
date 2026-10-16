"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertSameOrigin, requestBreakGlass } from "@/modules/identity";
import { advanceAppointment, getAppointmentForCare } from "@/modules/scheduling";
import { addEncounterCharge, addProblem, amendNote, AssistUnavailableError, cancelPrescription, changeProblemStatus, checkPrescription, draftNoteText, draftPrescription, findMedications, finishEncounter, getPatientChart, issuePrescription, recordAllergy, recordVitals, removeEncounterCharge, saveNote, signNote, startEncounter } from "@/modules/clinical";
import { requireActor } from "@/app/session";
import { toActionState } from "@/app/action-errors";
import type { ActionState } from "@/lib/action-state";

export type ChartResult = { ok: true; chart: Awaited<ReturnType<typeof getPatientChart>> } | { ok: false; error: string };
// Selecting a patient in the queue is an explicit chart read, so it is authorized and
// audited here rather than prefetched for every row the clinician never opened.
export async function loadChartAction(patientId: string): Promise<ChartResult> {
  try {
    await assertSameOrigin();
    const actor = await requireActor(["clinician"]);
    return { ok: true, chart: await getPatientChart(actor, patientId) };
  } catch (error) {
    const state = toActionState(error);
    return { ok: false, error: state.error ?? "This chart could not be loaded." };
  }
}
export async function startVisitAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  let encounterId: string;
  try {
    await assertSameOrigin();
    const actor = await requireActor(["clinician"]);
    const encounter = await startEncounter(actor, { appointmentId: String(form.get("appointmentId") ?? "") });
    // openEncounter is idempotent, so a resubmission that lands after the appointment already
    // advanced is harmless. Any other failure (a genuinely stale revision, a concurrent change)
    // must not be swallowed: that is what used to leave the appointment stuck on "ready" while
    // the visit went on to bill.
    await advanceAppointment(actor, { appointmentId: encounter.appointmentId, revision: Number(form.get("revision") ?? 0), status: "in_progress" }).catch(async (error) => {
      const current = await getAppointmentForCare(actor, encounter.appointmentId);
      if (current.status !== "in_progress") throw error;
    });
    encounterId = encounter.id;
  } catch (error) { return toActionState(error); }
  redirect(`/clinical/encounters/${encounterId}`);
}
export async function advanceAppointmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertSameOrigin();
    const actor = await requireActor(["clinician", "staff"]);
    await advanceAppointment(actor, { appointmentId: String(form.get("appointmentId") ?? ""), revision: Number(form.get("revision") ?? 0), status: String(form.get("status") ?? "") });
  } catch (error) { return toActionState(error); }
  revalidatePath("/clinical/today");
  return { ok: true };
}
// Autosave returns the new revision so the editor stays in step without a page reload.
export async function saveNoteAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertSameOrigin();
    const actor = await requireActor(["clinician"]);
    const saved = await saveNote(actor, { encounterId: String(form.get("encounterId") ?? ""), versionId: String(form.get("versionId") ?? ""), revision: Number(form.get("revision") ?? 0), content: String(form.get("content") ?? "") });
    return { ok: true, revision: saved.revision, savedAt: Date.now() };
  } catch (error) { return toActionState(error); }
}
export async function signNoteAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const encounterId = String(form.get("encounterId") ?? "");
  try {
    await assertSameOrigin();
    const actor = await requireActor(["clinician"]);
    // Save the visible text first so signing can never freeze a version the clinician has not seen.
    const content = String(form.get("content") ?? "");
    let revision = Number(form.get("revision") ?? 0);
    const versionId = String(form.get("versionId") ?? "");
    if (form.get("dirty") === "true") revision = (await saveNote(actor, { encounterId, versionId, revision, content })).revision;
    await signNote(actor, { encounterId, versionId, revision });
  } catch (error) { return toActionState(error); }
  revalidatePath(`/clinical/encounters/${encounterId}`);
  return { ok: true };
}
export async function amendNoteAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const encounterId = String(form.get("encounterId") ?? "");
  try {
    await assertSameOrigin();
    const actor = await requireActor(["clinician"]);
    await amendNote(actor, { encounterId, versionId: String(form.get("versionId") ?? ""), revision: Number(form.get("revision") ?? 0), content: String(form.get("content") ?? ""), reason: String(form.get("reason") ?? "") });
  } catch (error) { return toActionState(error, { reason: String(form.get("reason") ?? "") }); }
  revalidatePath(`/clinical/encounters/${encounterId}`);
  return { ok: true };
}
// Returns a draft for the clinician to edit. It is never saved or signed on their behalf.
export async function draftNoteAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertSameOrigin();
    const actor = await requireActor(["clinician"]);
    const draft = await draftNoteText(actor, { encounterId: String(form.get("encounterId") ?? ""), observations: String(form.get("observations") ?? "") });
    return { ok: true, draft };
  } catch (error) {
    if (error instanceof AssistUnavailableError) return { ok: false, code: "unavailable", error: error.message };
    return toActionState(error);
  }
}
export async function recordVitalsAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const encounterId = String(form.get("encounterId") ?? "");
  try {
    await assertSameOrigin();
    const actor = await requireActor(["clinician"]);
    // Only the measurement fields are forwarded; the catalogue decides what each one means.
    const readings = Object.fromEntries([...form.entries()]
      .filter(([key, value]) => key.startsWith("vital.") && typeof value === "string")
      .map(([key, value]) => [key.slice("vital.".length), String(value)]));
    const written = await recordVitals(actor, { encounterId, readings });
    revalidatePath(`/clinical/encounters/${encounterId}`);
    const flagged = written.filter((row) => row.flag !== "normal");
    return { ok: true, notice: `Recorded ${written.length} ${written.length === 1 ? "measurement" : "measurements"}${flagged.length ? `, ${flagged.length} outside the reference range` : ""}.` };
  } catch (error) { return toActionState(error); }
}
export async function addProblemAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const encounterId = String(form.get("encounterId") ?? "");
  const values = { description: String(form.get("description") ?? "") };
  try {
    await assertSameOrigin();
    const actor = await requireActor(["clinician"]);
    await addProblem(actor, { encounterId, ...values });
  } catch (error) { return toActionState(error, values); }
  revalidatePath(`/clinical/encounters/${encounterId}`);
  return { ok: true };
}
export async function changeProblemStatusAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const encounterId = String(form.get("encounterId") ?? "");
  try {
    await assertSameOrigin();
    const actor = await requireActor(["clinician"]);
    await changeProblemStatus(actor, { encounterId, problemId: String(form.get("problemId") ?? ""), status: String(form.get("status") ?? "") });
  } catch (error) { return toActionState(error); }
  revalidatePath(`/clinical/encounters/${encounterId}`);
  return { ok: true };
}
export async function recordAllergyAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const encounterId = String(form.get("encounterId") ?? "");
  const values = { substance: String(form.get("substance") ?? ""), reaction: String(form.get("reaction") ?? ""), severity: String(form.get("severity") ?? "") };
  try {
    await assertSameOrigin();
    const actor = await requireActor(["clinician"]);
    await recordAllergy(actor, { encounterId, ...values });
  } catch (error) { return toActionState(error, values); }
  revalidatePath(`/clinical/encounters/${encounterId}`);
  return { ok: true };
}
export type MedicationResult = { ok: true; medications: Awaited<ReturnType<typeof findMedications>> } | { ok: false; error: string };
export async function searchMedicationsAction(term: string): Promise<MedicationResult> {
  try {
    await assertSameOrigin();
    const actor = await requireActor(["clinician"]);
    return { ok: true, medications: await findMedications(actor, { term }) };
  } catch (error) {
    const state = toActionState(error);
    return { ok: false, error: state.error ?? "The catalogue could not be searched." };
  }
}
export async function draftPrescriptionAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const encounterId = String(form.get("encounterId") ?? "");
  const values = { medicationId: String(form.get("medicationId") ?? ""), dose: String(form.get("dose") ?? ""), unit: String(form.get("unit") ?? ""),
    route: String(form.get("route") ?? ""), frequency: String(form.get("frequency") ?? ""), durationDays: String(form.get("durationDays") ?? "") };
  try {
    await assertSameOrigin();
    const actor = await requireActor(["clinician"]);
    await draftPrescription(actor, { encounterId, ...values });
  } catch (error) { return toActionState(error, values); }
  revalidatePath(`/clinical/encounters/${encounterId}/prescribe`);
  return { ok: true };
}
export async function checkPrescriptionAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const encounterId = String(form.get("encounterId") ?? "");
  try {
    await assertSameOrigin();
    const actor = await requireActor(["clinician"]);
    const verdict = await checkPrescription(actor, { prescriptionId: String(form.get("prescriptionId") ?? "") });
    revalidatePath(`/clinical/encounters/${encounterId}/prescribe`);
    return { ok: true, notice: `${verdict.source} returned ${verdict.status}.` };
  } catch (error) { return toActionState(error); }
}
export async function issuePrescriptionAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const encounterId = String(form.get("encounterId") ?? "");
  const values = { overrideReason: String(form.get("overrideReason") ?? "") };
  try {
    await assertSameOrigin();
    const actor = await requireActor(["clinician"]);
    await issuePrescription(actor, { prescriptionId: String(form.get("prescriptionId") ?? ""), overrideReason: values.overrideReason });
  } catch (error) { return toActionState(error, values); }
  revalidatePath(`/clinical/encounters/${encounterId}/prescribe`);
  return { ok: true };
}
export async function cancelPrescriptionAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const encounterId = String(form.get("encounterId") ?? "");
  try {
    await assertSameOrigin();
    const actor = await requireActor(["clinician"]);
    await cancelPrescription(actor, { prescriptionId: String(form.get("prescriptionId") ?? "") });
  } catch (error) { return toActionState(error); }
  revalidatePath(`/clinical/encounters/${encounterId}/prescribe`);
  return { ok: true };
}
/**
 * The only way into requestBreakGlass. The service does the real gatekeeping: clinician role, a
 * fresh authenticator check that a recovery code does not satisfy, and a reason worth reading.
 */
export async function breakGlassAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const patientId = String(form.get("patientId") ?? "");
  const values = { reason: String(form.get("reason") ?? "") };
  try {
    await assertSameOrigin();
    const actor = await requireActor(["clinician"]);
    await requestBreakGlass(actor, { patientId, reason: values.reason });
  } catch (error) { return toActionState(error, values); }
  revalidatePath(`/clinical/patients/${patientId}`);
  return { ok: true };
}
export async function addChargeLineAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const encounterId = String(form.get("encounterId") ?? "");
  const values = { serviceId: String(form.get("serviceId") ?? ""), quantity: String(form.get("quantity") ?? "1") };
  try {
    await assertSameOrigin();
    const actor = await requireActor(["clinician"]);
    await addEncounterCharge(actor, { encounterId, ...values });
  } catch (error) { return toActionState(error, values); }
  revalidatePath(`/clinical/encounters/${encounterId}`);
  return { ok: true };
}
export async function removeChargeLineAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const encounterId = String(form.get("encounterId") ?? "");
  try {
    await assertSameOrigin();
    const actor = await requireActor(["clinician"]);
    await removeEncounterCharge(actor, { encounterId, lineId: String(form.get("lineId") ?? "") });
  } catch (error) { return toActionState(error); }
  revalidatePath(`/clinical/encounters/${encounterId}`);
  return { ok: true };
}
export async function completeVisitAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const encounterId = String(form.get("encounterId") ?? "");
  const summary = String(form.get("summary") ?? "");
  try {
    await assertSameOrigin();
    const actor = await requireActor(["clinician"]);
    await finishEncounter(actor, { encounterId, summary });
  } catch (error) { return toActionState(error, { summary }); }
  revalidatePath(`/clinical/encounters/${encounterId}`);
  return { ok: true };
}
