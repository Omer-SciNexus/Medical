import { z } from "zod";

export const appointmentStatusSchema = z.enum(["booked", "checked_in", "rooming", "ready", "in_progress", "done", "cancelled", "no_show"]);
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;

export const availabilityQuerySchema = z.object({ providerId: z.uuid(), from: z.coerce.date().optional(), days: z.coerce.number().int().min(1).max(60).default(21) });
export const bookingSchema = z.object({
  providerId: z.uuid(),
  slotId: z.uuid(),
  reason: z.string().trim().min(3, "Describe the reason for your visit.").max(200, "Use no more than 200 characters."),
});
// Revision accompanies every transition so a stale screen cannot overwrite a newer state.
export const transitionSchema = z.object({ appointmentId: z.uuid(), revision: z.coerce.number().int().positive(), status: appointmentStatusSchema });
export const queryDaySchema = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

export class SlotUnavailableError extends Error {
  constructor() { super("That appointment time was just taken. Choose another time to continue."); this.name = "SlotUnavailableError"; }
}
export class StaleAppointmentError extends Error {
  constructor() { super("This appointment changed while you were viewing it. Reload to see its current state."); this.name = "StaleAppointmentError"; }
}
