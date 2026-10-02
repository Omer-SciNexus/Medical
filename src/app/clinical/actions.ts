"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertSameOrigin } from "@/modules/identity";
import { advanceAppointment } from "@/modules/scheduling";
import { amendNote, AssistUnavailableError, draftNoteText, finishEncounter, getPatientChart, saveNote, signNote, startEncounter } from "@/modules/clinical";
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
    await advanceAppointment(actor, { appointmentId: encounter.appointmentId, revision: Number(form.get("revision") ?? 0), status: "in_progress" }).catch(() => undefined);
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
