"use server";

import { revalidatePath } from "next/cache";
import { assertSameOrigin, invitePerson, resendPersonInvitation, resetPersonMfa, revokePersonInvitation, revokePersonSessions, setPersonActive } from "@/modules/identity";
import { addAvailabilityTemplate, addScheduleBlackout, extendProviderSchedule, removeAvailabilityTemplate, removeScheduleBlackout } from "@/modules/scheduling";
import { requireActor } from "@/app/session";
import { toActionState } from "@/app/action-errors";
import type { ActionState } from "@/lib/action-state";

const PEOPLE = "/admin/people";
const SCHEDULE = "/admin/schedule";

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
const field = (form: FormData, name: string) => String(form.get(name) ?? "");
export async function addTemplateAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const values = { providerId: field(form, "providerId"), weekday: field(form, "weekday"), start: field(form, "start"), end: field(form, "end"), slotMinutes: field(form, "slotMinutes") };
  try {
    await assertSameOrigin();
    const actor = await requireActor(["admin"]);
    await addAvailabilityTemplate(actor, values);
  } catch (error) { return toActionState(error, values); }
  revalidatePath(SCHEDULE);
  return { ok: true };
}
export async function removeTemplateAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertSameOrigin();
    const actor = await requireActor(["admin"]);
    await removeAvailabilityTemplate(actor, { templateId: field(form, "templateId") });
  } catch (error) { return toActionState(error); }
  revalidatePath(SCHEDULE);
  return { ok: true };
}
export async function extendScheduleAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertSameOrigin();
    const actor = await requireActor(["admin"]);
    const result = await extendProviderSchedule(actor, { providerId: field(form, "providerId"), weeks: field(form, "weeks") || 4 });
    revalidatePath(SCHEDULE);
    return { ok: true, notice: result.created
      ? `Opened ${result.created} appointment ${result.created === 1 ? "time" : "times"} through ${result.through}${result.existing ? `, leaving ${result.existing} already in place` : ""}${result.blackedOut ? `, skipping ${result.blackedOut} in a blackout` : ""}.`
      : `Nothing to add through ${result.through}: ${result.existing} times are already open${result.blackedOut ? ` and ${result.blackedOut} fall in a blackout` : ""}.` };
  } catch (error) { return toActionState(error); }
}
export async function addBlackoutAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const values = { providerId: field(form, "providerId"), day: field(form, "day"), endDay: field(form, "endDay"), reason: field(form, "reason") };
  try {
    await assertSameOrigin();
    const actor = await requireActor(["admin"]);
    const result = await addScheduleBlackout(actor, { ...values, endDay: values.endDay || undefined });
    revalidatePath(SCHEDULE);
    return { ok: true, notice: `Closed that time${result.withdrawn ? `, withdrawing ${result.withdrawn} open ${result.withdrawn === 1 ? "slot" : "slots"}` : ""}.${result.booked ? ` ${result.booked} booked ${result.booked === 1 ? "appointment is" : "appointments are"} still inside it and must be moved.` : ""}` };
  } catch (error) { return toActionState(error, values); }
}
export async function removeBlackoutAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertSameOrigin();
    const actor = await requireActor(["admin"]);
    await removeScheduleBlackout(actor, { blackoutId: field(form, "blackoutId") });
  } catch (error) { return toActionState(error); }
  revalidatePath(SCHEDULE);
  return { ok: true };
}
