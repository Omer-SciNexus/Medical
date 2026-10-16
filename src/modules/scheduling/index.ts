export { resolvePatientScope, resolveImminentVisit, listProviderAvailability, bookAppointment, listMyAppointments, getClinicianQueue, advanceAppointment, completeAppointmentInTransaction, getAppointmentForCare, getPatientIdentity, AccessScopeError } from "./service";
export { getScheduleAuthoring, addAvailabilityTemplate, removeAvailabilityTemplate, addScheduleBlackout, removeScheduleBlackout, extendProviderSchedule, getProviderSlotCount } from "./service";
export { registerPatient, searchPatients } from "./service";
export { reschedulePatientAppointment, listMyAppointmentOptions } from "./service";
export { getWaitingRoomBoard, getClinicReport } from "./service";
export { findReminderTarget, listReminderWindow } from "./repository";
export { SlotUnavailableError, StaleAppointmentError, ScheduleAuthoringError, PatientRegistrationError, appointmentStatusSchema, bookingSchema, transitionSchema } from "./validators";
export { waitingMinutes, canTransition, roleMayTransition } from "./policy";
export type { AppointmentStatus } from "./validators";
