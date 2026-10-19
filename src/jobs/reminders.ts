import "server-only";
import { findReminderTarget, listReminderWindow } from "@/modules/scheduling";
import { findPortalContact, recordSystemEvent } from "@/modules/identity";
import { sendJobMail } from "@/platform/mailer";
import { getJobQueue } from "@/platform/queue";

/** How far ahead of a visit each reminder goes out. */
export const REMINDER_OFFSETS_HOURS = [24, 2];
export const reminderJobId = (appointmentId: string, offsetHours: number) => `reminder:${appointmentId}:${offsetHours}`;

/**
 * Schedules this appointment's reminders, replacing any already scheduled for it.
 *
 * The job id is derived from the appointment and the offset, so rescheduling cancels and
 * reissues rather than sending twice, and a repeated dispatch of the same outbox row lands on
 * the same job. Nothing about the patient travels in the job: only the appointment id.
 */
export async function scheduleAppointmentReminders(appointmentId: string) {
  const appointment = await findReminderTarget(appointmentId);
  const queue = getJobQueue();
  let scheduled = 0;
  for (const offset of REMINDER_OFFSETS_HOURS) {
    const jobId = reminderJobId(appointmentId, offset);
    await queue.remove(jobId);
    if (!appointment || appointment.status === "cancelled" || appointment.status === "no_show" || appointment.status === "done") continue;
    const dueAt = appointment.startsAt.getTime() - offset * 3_600_000;
    if (dueAt <= Date.now()) continue;
    await queue.add("appointment.reminder", jobId, { appointmentId, offsetHours: String(offset) }, { delayMs: dueAt - Date.now() });
    scheduled += 1;
  }
  return { scheduled };
}

/**
 * Sends one reminder. The job carries an identifier, so everything else is re-read here, and a
 * visit that has since been cancelled or moved out of the window simply sends nothing.
 */
export async function sendAppointmentReminder(input: { appointmentId: string; offsetHours: number }) {
  const appointment = await findReminderTarget(input.appointmentId);
  if (!appointment || appointment.status === "cancelled" || appointment.status === "no_show" || appointment.status === "done") return { sent: false, reason: "not due" };
  const hoursAway = (appointment.startsAt.getTime() - Date.now()) / 3_600_000;
  // A rescheduled visit has a new reminder of its own; this one is no longer the right message.
  if (hoursAway < 0 || hoursAway > input.offsetHours + 1) return { sent: false, reason: "no longer due" };
  const contact = await findPortalContact(appointment.clinicId, appointment.patientId);
  if (!contact) return { sent: false, reason: "no portal account" };
  const delivery = await sendJobMail({ to: contact.email, subject: "A reminder about your appointment",
    idempotencyKey: `reminder-${input.appointmentId}-${input.offsetHours}-${appointment.startsAt.getTime()}`,
    text: `Your appointment is on ${appointment.startsAt.toISOString().slice(0, 16).replace("T", " at ")} UTC.\n\n${appointment.preparation}\n\nSign in to your clinic portal to see the details, move it or cancel it.` });
  // Recorded against the patient as a system event: no person sent this.
  await recordSystemEvent({ clinicId: appointment.clinicId, patientId: appointment.patientId, action: "scheduling.reminder_sent",
    purpose: "scheduling", resourceId: input.appointmentId, reason: `${input.offsetHours}h` });
  return { sent: true, delivered: delivery.delivered };
}
/** Used by the worker at start-up to pick up visits booked while nothing was running. */
export async function scheduleUpcomingReminders(hoursAhead = 48) {
  const upcoming = await listReminderWindow(hoursAhead);
  let scheduled = 0;
  for (const appointment of upcoming) scheduled += (await scheduleAppointmentReminders(appointment.id)).scheduled;
  return { appointments: upcoming.length, scheduled };
}
