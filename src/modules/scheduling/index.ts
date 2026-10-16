export { resolvePatientScope, listProviderAvailability, bookAppointment, listMyAppointments, getClinicianQueue, advanceAppointment, completeAppointmentInTransaction, getAppointmentForCare, getPatientIdentity, AccessScopeError } from "./service";
export { getScheduleAuthoring, addAvailabilityTemplate, removeAvailabilityTemplate, addScheduleBlackout, removeScheduleBlackout, extendProviderSchedule, getProviderSlotCount } from "./service";
export { registerPatient, searchPatients } from "./service";
export { SlotUnavailableError, StaleAppointmentError, ScheduleAuthoringError, PatientRegistrationError, appointmentStatusSchema, bookingSchema, transitionSchema } from "./validators";
export { waitingMinutes, canTransition } from "./policy";
export type { AppointmentStatus } from "./validators";
