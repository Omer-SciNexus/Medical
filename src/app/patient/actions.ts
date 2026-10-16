"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertSameOrigin } from "@/modules/identity";
import { advanceAppointment, bookAppointment, reschedulePatientAppointment } from "@/modules/scheduling";
import { requireActor } from "@/app/session";
import { toActionState } from "@/app/action-errors";
import type { ActionState } from "@/lib/action-state";

export async function bookAppointmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const values = { providerId: String(form.get("providerId") ?? ""), slotId: String(form.get("slotId") ?? ""), reason: String(form.get("reason") ?? "") };
  let appointmentId: string;
  try {
    await assertSameOrigin();
    const actor = await requireActor(["patient"]);
    const appointment = await bookAppointment(actor, values);
    appointmentId = appointment.id;
  } catch (error) {
    // The chosen provider and reason survive a conflict so the patient re-picks only a time.
    return toActionState(error, values);
  }
  redirect(`/patient/book?confirmed=${appointmentId}`);
}

const APPOINTMENTS = "/patient/appointments";
export async function cancelAppointmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertSameOrigin();
    const actor = await requireActor(["patient"]);
    // The ordinary transition path: a patient may only ever move an appointment to cancelled.
    await advanceAppointment(actor, { appointmentId: String(form.get("appointmentId") ?? ""), revision: Number(form.get("revision") ?? 0), status: "cancelled" });
  } catch (error) { return toActionState(error); }
  revalidatePath(APPOINTMENTS);
  return { ok: true };
}
export async function rescheduleAppointmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertSameOrigin();
    const actor = await requireActor(["patient"]);
    await reschedulePatientAppointment(actor, { appointmentId: String(form.get("appointmentId") ?? ""), revision: Number(form.get("revision") ?? 0), slotId: String(form.get("slotId") ?? "") });
  } catch (error) { return toActionState(error); }
  revalidatePath(APPOINTMENTS);
  redirect(APPOINTMENTS);
}
