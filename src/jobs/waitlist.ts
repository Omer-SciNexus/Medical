import "server-only";
import { describeNotificationClinic, findPortalContact, recordSystemEvent } from "@/modules/identity";
import { findOfferForNotification } from "@/modules/scheduling";
import { sendJobMail } from "@/platform/mailer";

/** Tells someone waiting that a time has opened. Sends nothing if it has already gone. */
export async function sendWaitlistOffer(clinicId: string, offerId: string) {
  const [offer, clinic] = await Promise.all([findOfferForNotification(clinicId, offerId), describeNotificationClinic(clinicId)]);
  if (!offer || !clinic) return { sent: false, reason: "no longer open" };
  const contact = await findPortalContact(clinicId, offer.patientId);
  if (!contact) return { sent: false, reason: "no portal account" };
  const when = new Intl.DateTimeFormat("en-GB", { timeZone: clinic.timezone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(offer.startsAt);
  const link = process.env.APP_ORIGIN ? `${process.env.APP_ORIGIN}/patient/appointments` : "your clinic portal";
  const delivery = await sendJobMail({ to: contact.email, subject: `A time has opened up at ${clinic.name}`, idempotencyKey: `waitlist-offer-${offerId}`,
    text: `A time has opened up on ${when} (${clinic.timezone}).\n\nIt goes to the first person to accept, so it may not stay open for long. Sign in to take it: ${link}` });
  await recordSystemEvent({ clinicId, patientId: offer.patientId, action: "scheduling.waitlist_offer_sent", purpose: "scheduling", resourceId: offerId });
  return { sent: true, delivered: delivery.delivered };
}
