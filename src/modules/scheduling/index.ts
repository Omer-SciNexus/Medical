export { resolvePatientScope, listProviderAvailability, bookAppointment, listMyAppointments, getClinicianQueue, advanceAppointment, completeAppointmentInTransaction, getAppointmentForCare, getPatientIdentity, AccessScopeError } from "./service";
export { SlotUnavailableError, StaleAppointmentError, appointmentStatusSchema, bookingSchema, transitionSchema } from "./validators";
export { waitingMinutes, canTransition } from "./policy";
export type { AppointmentStatus } from "./validators";
