import "server-only";
import { recordSystemEvent, findPortalContact, verifyChainFully } from "@/modules/identity";
import { readSummaryForNotification } from "@/modules/clinical";
import { findChargeForNotification } from "@/modules/billing";
import { sendMail } from "@/platform/mailer";
import { scheduleAppointmentReminders, sendAppointmentReminder } from "./reminders";

export type JobPayload = Record<string, string>;
/**
 * What each topic means. A handler receives identifiers and re-reads everything it needs, which
 * is why outbox payloads carry nothing else. An unknown topic is not an error: an older row may
 * name a topic this deployment no longer handles, and it should not jam the queue.
 */
const handlers: Record<string, (payload: JobPayload) => Promise<unknown>> = {
  "appointment.booked": async (payload) => scheduleAppointmentReminders(payload.resourceId),
  "appointment.rescheduled": async (payload) => scheduleAppointmentReminders(payload.resourceId),
  "appointment.cancelled": async (payload) => scheduleAppointmentReminders(payload.resourceId),
  "appointment.reminder": async (payload) => sendAppointmentReminder({ appointmentId: payload.appointmentId, offsetHours: Number(payload.offsetHours) }),
  // The scheduled full pass: the only check that can see an alteration made before a checkpoint.
  "audit.verify_chain": async () => verifyChainFully(),
  "visit_summary.published": async (payload) => {
    const summary = await readSummaryForNotification(payload.clinicId, payload.resourceId);
    if (!summary?.publishedAt) return { sent: false, reason: "not published" };
    const contact = await findPortalContact(payload.clinicId, summary.patientId);
    if (!contact) return { sent: false, reason: "no portal account" };
    await sendMail({ to: contact.email, subject: "Your visit summary is ready",
      text: "Your clinician has published the summary of your recent visit. Sign in to your clinic portal to read it." });
    await recordSystemEvent({ clinicId: payload.clinicId, patientId: summary.patientId, action: "clinical.summary_notified", purpose: "patient.view", resourceId: payload.resourceId });
    return { sent: true };
  },
  "encounter.completed": async (payload) => {
    // Nothing leaves the clinic for this one; it exists so the visit's close-out is observable.
    const charge = await findChargeForNotification(payload.clinicId, payload.resourceId);
    await recordSystemEvent({ clinicId: payload.clinicId, action: "clinical.completion_observed", purpose: "billing", resourceId: payload.resourceId, reason: charge ? `charged:${charge.amountMinor}` : "no charge" });
    return { observed: true };
  },
};
export const handlerFor = (topic: string) => handlers[topic];
export const handledTopics = () => Object.keys(handlers);
