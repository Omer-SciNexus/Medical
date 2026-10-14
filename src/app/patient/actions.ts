"use server";

import { redirect } from "next/navigation";
import { assertSameOrigin } from "@/modules/identity";
import { bookAppointment } from "@/modules/scheduling";
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
