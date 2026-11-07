"use server";

import { revalidatePath } from "next/cache";
import { assertSameOrigin, invitePatientPortal, resendPatientPortalInvitation, listPortalLinks, type Actor } from "@/modules/identity";
import { advanceAppointment, correctPatient, getPatientDetails, PossibleDuplicateError, listPatients, registerPatient, searchPatients } from "@/modules/scheduling";
import { sendFollowUpReminderNow, declineAppointmentRequest, findRequestMatches, linkAppointmentRequestToPatient, registerAndInviteFromRequest } from "@/modules/scheduling";
import { patientAge } from "@/modules/clinical";
import { publishChange } from "@/platform/realtime";
import { requireActor } from "@/app/session";
import { toActionState } from "@/app/action-errors";
import type { ActionState } from "@/lib/action-state";

const PATIENTS = "/staff/patients";
const field = (form: FormData, name: string) => String(form.get(name) ?? "");

/** An age, never a date of birth: a search result reaches the browser the same way a queue does. */
export type PatientMatch = { id: string; givenName: string; surname: string; age: number; sex: string; mrn: string; portal: "none" | "invited" | "active" | "deactivated"; invitationId?: string };
export type SearchResult = { ok: true; matches: PatientMatch[] } | { ok: false; error: string };

export type PatientPage = { ok: true; patients: PatientMatch[]; page: number; pageSize: number; total: number } | { ok: false; error: string };

type PatientRow = { id: string; givenName: string; surname: string; birthDate: string; sex: string; mrn: string };
async function withPortal(actor: Actor, rows: PatientRow[]): Promise<PatientMatch[]> {
  const links = await listPortalLinks(actor, rows.map((row) => row.id));
  return rows.map((row) => {
    const account = links.accounts.find((candidate) => candidate.patientId === row.id);
    const pending = links.pending.find((candidate) => candidate.patientId === row.id);
    return { id: row.id, givenName: row.givenName, surname: row.surname, age: patientAge(row.birthDate), sex: row.sex, mrn: row.mrn,
      portal: account ? (account.active ? "active" : "deactivated") : pending ? "invited" : "none", invitationId: pending?.id };
  });
}
export async function searchPatientsAction(term: string): Promise<SearchResult> {
  try {
    await assertSameOrigin();
    const actor = await requireActor(["staff", "admin"]);
    return { ok: true, matches: await withPortal(actor, await searchPatients(actor, { term })) };
  } catch (error) {
    const state = toActionState(error);
    return { ok: false, error: state.error ?? "That search could not be run." };
  }
}
export async function listPatientsAction(page: number): Promise<PatientPage> {
  try {
    await assertSameOrigin();
    const actor = await requireActor(["staff", "admin"]);
    const result = await listPatients(actor, { page });
    return { ok: true, patients: await withPortal(actor, result.patients), page: result.page, pageSize: result.pageSize, total: result.total };
  } catch (error) {
    const state = toActionState(error);
    return { ok: false, error: state.error ?? "The patient list could not be read." };
  }
}
/** Possible matches carry an age like a search result does; the date of birth is the one just typed. */
export type DuplicateMatch = { id: string; givenName: string; surname: string; age: number; sex: string; mrn: string };
export type RegisterState = ActionState & { duplicates?: DuplicateMatch[] };
export async function registerPatientAction(_previous: RegisterState, form: FormData): Promise<RegisterState> {
  const values = { givenName: field(form, "givenName"), surname: field(form, "surname"), birthDate: field(form, "birthDate"), sex: field(form, "sex"), mrn: field(form, "mrn") };
  try {
    await assertSameOrigin();
    const actor = await requireActor(["staff", "admin"]);
    const patient = await registerPatient(actor, { ...values, confirmDistinct: field(form, "confirmDistinct") });
    revalidatePath(PATIENTS);
    return { ok: true, notice: `Registered with record number ${patient.mrn}.` };
  } catch (error) {
    if (error instanceof PossibleDuplicateError) return { ok: false, code: "conflict", values, error: error.message,
      duplicates: error.matches.map((match) => ({ id: match.id, givenName: match.givenName, surname: match.surname, age: patientAge(match.birthDate), sex: match.sex, mrn: match.mrn })) };
    return toActionState(error, values);
  }
}
export type PatientDetails = { id: string; givenName: string; surname: string; birthDate: string; sex: string; mrn: string; version: string };
export type DetailsResult = { ok: true; patient: PatientDetails } | { ok: false; error: string };
export async function getPatientDetailsAction(patientId: string): Promise<DetailsResult> {
  try {
    await assertSameOrigin();
    const actor = await requireActor(["staff", "admin"]);
    return { ok: true, patient: await getPatientDetails(actor, { patientId }) };
  } catch (error) {
    const state = toActionState(error);
    return { ok: false, error: state.error ?? "That record could not be opened." };
  }
}
const fieldLabels = { givenName: "given name", surname: "surname", birthDate: "date of birth", sex: "sex" } as const;
export async function correctPatientAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const values = { patientId: field(form, "patientId"), version: field(form, "version"), givenName: field(form, "givenName"), surname: field(form, "surname"), birthDate: field(form, "birthDate"), sex: field(form, "sex") };
  try {
    await assertSameOrigin();
    const actor = await requireActor(["staff", "admin"]);
    const { mrn, changed } = await correctPatient(actor, values);
    revalidatePath(PATIENTS);
    return { ok: true, notice: changed.length ? `Updated ${mrn}: ${changed.map((key) => fieldLabels[key]).join(", ")}.` : `Nothing changed on ${mrn}.` };
  } catch (error) { return toActionState(error, values); }
}
export async function invitePatientPortalAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const values = { patientId: field(form, "patientId"), email: field(form, "email"), displayName: field(form, "displayName") };
  try {
    const origin = await assertSameOrigin();
    const actor = await requireActor(["staff", "admin"]);
    const invitation = await invitePatientPortal(actor, values, origin);
    revalidatePath(PATIENTS);
    return { ok: true, link: invitation.link, delivered: invitation.delivered };
  } catch (error) { return toActionState(error, values); }
}
export async function resendPatientPortalInvitationAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const origin = await assertSameOrigin();
    const actor = await requireActor(["staff", "admin"]);
    const { link, delivered } = await resendPatientPortalInvitation(actor, { invitationId: field(form, "invitationId") }, origin);
    revalidatePath(PATIENTS);
    return { ok: true, link, delivered };
  } catch (error) { return toActionState(error); }
}

const REQUESTS = "/staff/requests";
export type MatchesResult = { ok: true; matches: DuplicateMatch[] } | { ok: false; error: string };
export async function findRequestMatchesAction(requestId: string): Promise<MatchesResult> {
  try {
    await assertSameOrigin();
    const actor = await requireActor(["staff", "admin"]);
    const matches = await findRequestMatches(actor, { requestId });
    return { ok: true, matches: matches.map((match) => ({ id: match.id, givenName: match.givenName, surname: match.surname, age: patientAge(match.birthDate), sex: match.sex, mrn: match.mrn })) };
  } catch (error) {
    const state = toActionState(error);
    return { ok: false, error: state.error ?? "Possible matches could not be read." };
  }
}
export async function linkRequestAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const origin = await assertSameOrigin();
    const actor = await requireActor(["staff", "admin"]);
    const result = await linkAppointmentRequestToPatient(actor, { requestId: field(form, "requestId"), patientId: field(form, "patientId") }, origin);
    revalidatePath(REQUESTS);
    if (result.outcome === "invited") return { ok: true, link: result.link, delivered: result.delivered };
    return { ok: true, notice: result.outcome === "existing_account"
      ? "Linked. This patient already has a portal account, so no invitation was sent: let them know they can sign in and book."
      : "Linked. This patient already has a portal invitation waiting; use Send a new link on the Patients page if they need it again." };
  } catch (error) { return toActionState(error); }
}
export async function registerFromRequestAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const origin = await assertSameOrigin();
    const actor = await requireActor(["staff", "admin"]);
    const result = await registerAndInviteFromRequest(actor, { requestId: field(form, "requestId") }, origin);
    revalidatePath(REQUESTS);
    revalidatePath(PATIENTS);
    if ("inviteError" in result) return { ok: true, notice: `Registered with record number ${result.mrn}, but no invitation was sent: ${result.inviteError}` };
    return { ok: true, notice: `Registered with record number ${result.mrn}.`, link: result.link, delivered: result.delivered };
  } catch (error) { return toActionState(error); }
}
export async function declineRequestAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const values = { note: field(form, "note") };
  try {
    await assertSameOrigin();
    const actor = await requireActor(["staff", "admin"]);
    await declineAppointmentRequest(actor, { requestId: field(form, "requestId"), ...values });
  } catch (error) { return toActionState(error, values); }
  revalidatePath(REQUESTS);
  return { ok: true, notice: "Request declined." };
}

/** The board's only write. Which transitions staff may make is roleMayTransition's business. */
export async function advanceFromBoardAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertSameOrigin();
    const actor = await requireActor(["staff", "admin"]);
    await advanceAppointment(actor, { appointmentId: field(form, "appointmentId"), revision: Number(form.get("revision") ?? 0), status: field(form, "status") });
    // Published after the change has committed, so nobody is nudged towards a rolled-back write.
    await publishChange(actor.clinicId, "clinic:board");
    await publishChange(actor.clinicId, "clinic:queue");
  } catch (error) { return toActionState(error); }
  revalidatePath("/staff/board");
  return { ok: true };
}
const FOLLOW_UPS = "/staff/follow-ups";
export async function remindFollowUpAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertSameOrigin();
    const actor = await requireActor(["staff", "admin"]);
    await sendFollowUpReminderNow(actor, { followUpId: field(form, "followUpId") });
  } catch (error) { return toActionState(error); }
  revalidatePath(FOLLOW_UPS);
  return { ok: true, notice: "Reminder queued. It goes out as soon as the worker picks it up." };
}
