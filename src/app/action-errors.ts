import "server-only";
import { z } from "zod";
import { AccessDeniedError, PersonAdminError } from "@/modules/identity";
import { SlotUnavailableError, StaleAppointmentError, AccessScopeError } from "@/modules/scheduling";
import { EncounterStateError, NoteConflictError } from "@/modules/clinical";
import { logOperational } from "@/platform/log";
import type { ActionCode, ActionState } from "@/lib/action-state";

const unavailable = "Something went wrong on our side. Nothing was saved. Please try again.";
// Only these domain errors carry a message safe to show, each with a code the UI can branch
// on. Anything else is redacted so no internal detail or patient data leaves in a string.
// Built on call, not at module load: these classes reach here across a circular domain
// import, and this function must never be the thing that throws.
const speakable = (): [new (...args: never[]) => Error, ActionCode][] => [
  [NoteConflictError, "conflict"], [StaleAppointmentError, "conflict"], [SlotUnavailableError, "slot_taken"],
  [EncounterStateError, "state"], [AccessScopeError, "state"], [PersonAdminError, "state"],
];
export function toActionState(error: unknown, values?: Record<string, string>): ActionState {
  if (error instanceof z.ZodError) return { ok: false, code: "invalid", errors: z.flattenError(error).fieldErrors, values };
  if (error instanceof AccessDeniedError) return { ok: false, code: "denied", error: "You do not have permission to do that.", values };
  const match = speakable().find(([candidate]) => error instanceof candidate);
  if (match) return { ok: false, code: match[1], error: (error as Error).message, values };
  logOperational("request.failed", { code: "ACTION_FAILED" });
  return { ok: false, code: "unavailable", error: unavailable, values };
}
