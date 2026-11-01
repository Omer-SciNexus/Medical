"use server";

import { AuthenticationError, assertSameOrigin, clientAddress } from "@/modules/identity";
import { submitAppointmentRequest } from "@/modules/scheduling";
import { toActionState } from "@/app/action-errors";
import type { ActionState } from "@/lib/action-state";

const fields = ["clinicId", "givenName", "surname", "birthDate", "contactEmail", "contactPhone", "reason", "preferredTimes"] as const;

export async function submitAppointmentRequestAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const values = Object.fromEntries(fields.map((name) => [name, String(form.get(name) ?? "")]));
  try {
    const origin = await assertSameOrigin();
    await submitAppointmentRequest(values, await clientAddress(), origin);
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthenticationError) return { ok: false, code: "denied", error: error.message, values };
    return toActionState(error, values);
  }
}
