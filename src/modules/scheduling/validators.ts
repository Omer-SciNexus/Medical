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
export const rescheduleSchema = z.object({ appointmentId: z.uuid(), revision: z.coerce.number().int().positive(), slotId: z.uuid() });
export const queryDaySchema = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

const clinicDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in YYYY-MM-DD form.");
// Times arrive as HH:MM from a time input and are stored as minutes from local midnight.
export const reportRangeSchema = z.object({
  from: clinicDay.optional(),
  days: z.coerce.number().int().min(1).max(92).default(28),
});
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Use a time in HH:MM form.")
  .transform((value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)));
export const templateSchema = z.object({
  providerId: z.uuid("Choose a provider."),
  weekday: z.coerce.number().int().min(0).max(6),
  start: timeOfDay, end: timeOfDay,
  slotMinutes: z.coerce.number().int().min(5).max(240),
}).refine((value) => value.end > value.start, { path: ["end"], message: "The end time must be after the start time." })
  .refine((value) => (value.end - value.start) % value.slotMinutes === 0, { path: ["slotMinutes"], message: "Appointment length must divide the session exactly." });
export const templateIdSchema = z.object({ templateId: z.uuid() });
export const extendScheduleSchema = z.object({ providerId: z.uuid("Choose a provider."), weeks: z.coerce.number().int().min(1).max(12).default(4) });
export const blackoutSchema = z.object({
  // An empty selection and an explicit null both mean the whole clinic.
  providerId: z.union([z.uuid(), z.literal(""), z.null()]).transform((value) => value || null),
  day: clinicDay, endDay: clinicDay.optional(),
  reason: z.string().trim().min(3, "Give a short reason.").max(200),
});
export const blackoutIdSchema = z.object({ blackoutId: z.uuid() });

const patientDetailsSchema = z.object({
  givenName: z.string().trim().min(1, "Enter their given name.").max(80),
  surname: z.string().trim().min(1, "Enter their surname.").max(80),
  birthDate: clinicDay,
  sex: z.enum(["female", "male", "intersex", "unknown"], { error: "Choose how to record sex." }),
});
export const patientRegistrationSchema = patientDetailsSchema.extend({
  // Left empty, the clinic's next number is assigned; the unique index is the authority.
  mrn: z.string().trim().max(32).optional().transform((value) => value || undefined),
  // Set only after the front desk has seen the possible matches and said this is someone else.
  confirmDistinct: z.union([z.boolean(), z.string()]).optional().transform((value) => value === true || value === "yes"),
});
// The version is the record's updated_at in microseconds, so a stale form cannot overwrite a newer correction.
export const patientCorrectionSchema = patientDetailsSchema.extend({ patientId: z.uuid(), version: z.string().regex(/^\d{1,20}$/) });
export const patientIdSchema = z.object({ patientId: z.uuid() });
export const patientSearchSchema = z.object({ term: z.string().trim().min(2, "Enter at least two characters.").max(80) });
export const patientListSchema = z.object({ page: z.coerce.number().int().min(1).max(10_000).default(1) });

const optionalText = (max: number, message?: string) => z.string().trim().max(max, message).optional().transform((value) => value || undefined);
export const appointmentRequestSchema = patientDetailsSchema.pick({ givenName: true, surname: true, birthDate: true }).extend({
  clinicId: z.uuid("This request link is not valid."),
  contactEmail: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address.")),
  contactPhone: optionalText(32, "Use no more than 32 characters."),
  reason: bookingSchema.shape.reason,
  preferredTimes: optionalText(300, "Use no more than 300 characters."),
});
export type AppointmentRequestInput = z.infer<typeof appointmentRequestSchema>;
export const requestTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
// Typed by hand, so case, spaces and the hyphen in the printed form (K7M4-QX9P) are forgiven.
// The alphabet matches new_request_code() in migration 0016.
export const requestCodeSchema = z.string().transform((value) => value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
  .pipe(z.string().regex(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/));
export const formatRequestCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;
export const appointmentRequestIdSchema = z.object({ requestId: z.uuid() });
export const linkAppointmentRequestSchema = appointmentRequestIdSchema.extend({ patientId: z.uuid("Choose a patient.") });
export const declineAppointmentRequestSchema = appointmentRequestIdSchema.extend({ note: optionalText(200, "Use no more than 200 characters.") });

// Offered to the clinician when they complete a visit. Choosing nothing plans nothing.
export const FOLLOW_UP_INTERVALS = [
  { days: 7, label: "In 1 week" }, { days: 14, label: "In 2 weeks" }, { days: 30, label: "In 1 month" },
  { days: 90, label: "In 3 months" }, { days: 180, label: "In 6 months" }, { days: 365, label: "In 1 year" },
] as const;
export const followUpPlanSchema = z.object({
  followUpDays: z.union([z.literal(""), z.coerce.number().refine((days) => FOLLOW_UP_INTERVALS.some((interval) => interval.days === days), "Choose when to see them again.")]).optional(),
  followUpNote: optionalText(140, "Use no more than 140 characters."),
}).refine((plan) => Boolean(plan.followUpDays) || !plan.followUpNote, { path: ["followUpDays"], message: "Choose when to see them again, or remove the note." });
export const followUpIdSchema = z.object({ followUpId: z.uuid() });
export const FOLLOW_UP_CLOSE_REASONS = ["Seen elsewhere", "Patient declined", "No longer needed"] as const;
export const closeFollowUpSchema = followUpIdSchema.extend({ reason: z.enum(FOLLOW_UP_CLOSE_REASONS, { error: "Choose why this follow-up is closing." }) });

export class PatientRegistrationError extends Error {
  constructor(message: string) { super(message); this.name = "PatientRegistrationError"; }
}
export type PossibleDuplicate = { id: string; givenName: string; surname: string; birthDate: string; sex: string; mrn: string };
/** Not a failure: the registration waits until the front desk confirms this is someone else. */
export class PossibleDuplicateError extends Error {
  constructor(readonly matches: PossibleDuplicate[]) { super("A patient with this name and date of birth is already registered."); this.name = "PossibleDuplicateError"; }
}
export class AppointmentRequestError extends Error {
  constructor(message: string) { super(message); this.name = "AppointmentRequestError"; }
}
export class ScheduleAuthoringError extends Error {
  constructor(message: string) { super(message); this.name = "ScheduleAuthoringError"; }
}
export class SlotUnavailableError extends Error {
  constructor() { super("That appointment time was just taken. Choose another time to continue."); this.name = "SlotUnavailableError"; }
}
export class StaleAppointmentError extends Error {
  constructor() { super("This appointment changed while you were viewing it. Reload to see its current state."); this.name = "StaleAppointmentError"; }
}
