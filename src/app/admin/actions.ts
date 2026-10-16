"use server";

import { revalidatePath } from "next/cache";
import { assertSameOrigin, invitePerson, resendPersonInvitation, resetPersonMfa, revokePersonInvitation, revokePersonSessions, setPersonActive } from "@/modules/identity";
import { requireActor } from "@/app/session";
import { toActionState } from "@/app/action-errors";
import type { ActionState } from "@/lib/action-state";

const PEOPLE = "/admin/people";

export async function invitePersonAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const values = { email: String(form.get("email") ?? ""), displayName: String(form.get("displayName") ?? ""), role: String(form.get("role") ?? "") };
  try {
    // The validated request origin is also the only origin an invitation link may point at.
    const origin = await assertSameOrigin();
    const actor = await requireActor(["admin"]);
    const invitation = await invitePerson(actor, values, origin);
    revalidatePath(PEOPLE);
    // The link is returned to the administrator who created it, so an invitation still works
    // when no mail provider is configured. It is shown once and never stored in plain text.
    return { ok: true, link: invitation.link, delivered: invitation.delivered };
  } catch (error) { return toActionState(error, values); }
}
export async function resendInvitationAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const origin = await assertSameOrigin();
    const actor = await requireActor(["admin"]);
    const { link, delivered } = await resendPersonInvitation(actor, { invitationId: String(form.get("invitationId") ?? "") }, origin);
    revalidatePath(PEOPLE);
    return { ok: true, link, delivered };
  } catch (error) { return toActionState(error); }
}
export async function revokeInvitationAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertSameOrigin();
    const actor = await requireActor(["admin"]);
    await revokePersonInvitation(actor, { invitationId: String(form.get("invitationId") ?? "") });
  } catch (error) { return toActionState(error); }
  revalidatePath(PEOPLE);
  return { ok: true };
}
export async function setPersonActiveAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertSameOrigin();
    const actor = await requireActor(["admin"]);
    await setPersonActive(actor, { userId: String(form.get("userId") ?? "") }, form.get("active") === "true");
  } catch (error) { return toActionState(error); }
  revalidatePath(PEOPLE);
  return { ok: true };
}
export async function resetPersonMfaAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertSameOrigin();
    const actor = await requireActor(["admin"]);
    await resetPersonMfa(actor, { userId: String(form.get("userId") ?? "") });
  } catch (error) { return toActionState(error); }
  revalidatePath(PEOPLE);
  return { ok: true };
}
export async function revokePersonSessionsAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertSameOrigin();
    const actor = await requireActor(["admin"]);
    await revokePersonSessions(actor, { userId: String(form.get("userId") ?? "") });
  } catch (error) { return toActionState(error); }
  revalidatePath(PEOPLE);
  return { ok: true };
}
