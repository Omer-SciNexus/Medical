"use server";

import { revalidatePath } from "next/cache";
import { assertSameOrigin, invitePatientPortal, listPortalLinks } from "@/modules/identity";
import { registerPatient, searchPatients } from "@/modules/scheduling";
import { patientAge } from "@/modules/clinical";
import { requireActor } from "@/app/session";
import { toActionState } from "@/app/action-errors";
import type { ActionState } from "@/lib/action-state";

const PATIENTS = "/staff/patients";
const field = (form: FormData, name: string) => String(form.get(name) ?? "");

/** An age, never a date of birth: a search result reaches the browser the same way a queue does. */
export type PatientMatch = { id: string; givenName: string; surname: string; age: number; sex: string; mrn: string; portal: "none" | "invited" | "active" | "deactivated" };
export type SearchResult = { ok: true; matches: PatientMatch[] } | { ok: false; error: string };

export async function searchPatientsAction(term: string): Promise<SearchResult> {
  try {
    await assertSameOrigin();
    const actor = await requireActor(["staff", "admin"]);
    const matches = await searchPatients(actor, { term });
    const links = await listPortalLinks(actor, matches.map((match) => match.id));
    return { ok: true, matches: matches.map((match) => {
      const account = links.accounts.find((candidate) => candidate.patientId === match.id);
      const invited = links.pending.some((candidate) => candidate.patientId === match.id);
      return { id: match.id, givenName: match.givenName, surname: match.surname, age: patientAge(match.birthDate), sex: match.sex, mrn: match.mrn,
        portal: account ? (account.active ? "active" : "deactivated") : invited ? "invited" : "none" };
    }) };
  } catch (error) {
    const state = toActionState(error);
    return { ok: false, error: state.error ?? "That search could not be run." };
  }
}
export async function registerPatientAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const values = { givenName: field(form, "givenName"), surname: field(form, "surname"), birthDate: field(form, "birthDate"), sex: field(form, "sex"), mrn: field(form, "mrn") };
  try {
    await assertSameOrigin();
    const actor = await requireActor(["staff", "admin"]);
    const patient = await registerPatient(actor, values);
    revalidatePath(PATIENTS);
    return { ok: true, notice: `Registered with record number ${patient.mrn}.` };
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
