import "server-only";
import { describeNotificationClinic, findPortalContact, recordSystemEvent } from "@/modules/identity";
import { findFollowUp, listFollowUpsToRemind, markFollowUpReminded } from "@/modules/scheduling";
import { addClinicDays, todayInZone } from "@/lib/clinic-day";
import { sendJobMail } from "@/platform/mailer";
import { logOperational } from "@/platform/log";

/** How long before a follow-up falls due the patient hears about it. */
export const FOLLOW_UP_NOTICE_DAYS = 7;
const dayLabel = (day: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${day}T12:00:00Z`));

/**
 * Sends one follow-up reminder. Everything is re-read here, so a follow-up booked or closed since
 * sends nothing. The clinician's note stays out of the message: mail is not a place for it. One
 * reminder a day at most, enforced by the delivery key, however often this runs.
 */
export async function remindFollowUp(clinicId: string, followUpId: string, options: { requested?: boolean } = {}) {
  const [followUp, clinic] = await Promise.all([findFollowUp(clinicId, followUpId), describeNotificationClinic(clinicId)]);
  if (!followUp || !clinic || followUp.status !== "pending") return { sent: false, reason: "not pending" };
  const today = todayInZone(clinic.timezone);
  if (!options.requested && (followUp.remindedAt || followUp.dueOn > addClinicDays(today, FOLLOW_UP_NOTICE_DAYS))) return { sent: false, reason: "not due" };
  const contact = await findPortalContact(clinicId, followUp.patientId);
  if (!contact) return { sent: false, reason: "no portal account" };
  const link = process.env.APP_ORIGIN ? `${process.env.APP_ORIGIN}/patient/appointments` : "your clinic portal";
  const delivery = await sendJobMail({ to: contact.email, subject: `${clinic.name} would like to see you again`, idempotencyKey: `follow-up-${followUpId}-${today}`,
    text: `Your clinician at ${clinic.name} would like to see you again by ${dayLabel(followUp.dueOn)}.\n\nSign in to choose a time that suits you: ${link}` });
  await markFollowUpReminded(clinicId, followUpId);
  await recordSystemEvent({ clinicId, patientId: followUp.patientId, action: "scheduling.follow_up_reminded", purpose: "scheduling", resourceId: followUpId });
  return { sent: true, delivered: delivery.delivered };
}
/** The hourly pass. One undeliverable address must not stop the rest, so each failure is its own. */
export async function remindDueFollowUps() {
  // The day is a day ahead of UTC at most in any clinic; remindFollowUp decides in clinic time.
  const horizon = new Date(Date.now() + (FOLLOW_UP_NOTICE_DAYS + 1) * 86_400_000).toISOString().slice(0, 10);
  const due = await listFollowUpsToRemind(horizon);
  let sent = 0;
  for (const followUp of due) {
    try {
      if ((await remindFollowUp(followUp.clinicId, followUp.id)).sent) sent += 1;
    } catch {
      logOperational("job.failed", { code: "FOLLOW_UP_REMINDER_FAILED" });
    }
  }
  return { due: due.length, sent };
}
