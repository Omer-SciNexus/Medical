import type { Metadata } from "next";
import { ChevronRight, Home, Inbox } from "lucide-react";
import { AppShell } from "@/components/app/shell";
import { getClinicSettings } from "@/modules/identity";
import { formatRequestCode, listAppointmentRequests } from "@/modules/scheduling";
import { patientAge } from "@/modules/clinical";
import { clinicTimezone } from "@/lib/clinic-day";
import { mailConfigured } from "@/platform/mailer";
import { requireActor } from "@/app/session";
import { Requests, type PendingRequest } from "./requests";

export const metadata: Metadata = { title: "Appointment requests", robots: { index: false, follow: false } };

export default async function RequestsPage() {
  const actor = await requireActor(["staff", "admin"]);
  const clinic = await getClinicSettings(actor).catch(() => null);
  const when = new Intl.DateTimeFormat("en-GB", { timeZone: clinic?.timezone ?? clinicTimezone(), day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const rows = await listAppointmentRequests(actor).catch(() => null);
  const requests: PendingRequest[] | null = rows?.map((row) => ({ id: row.id, givenName: row.givenName, surname: row.surname, age: patientAge(row.birthDate),
    contactEmail: row.contactEmail, contactPhone: row.contactPhone, reason: row.reason, preferredTimes: row.preferredTimes, receivedAt: when.format(row.createdAt) })) ?? null;
  const breadcrumb = <><span className="breadcrumb-app"><Home /></span><span className="breadcrumb-first">Front desk</span><ChevronRight /><span>Requests</span></>;
  return <AppShell actor={actor} clinicName={clinic?.name ?? "Your clinic"} current="/staff/requests" breadcrumb={breadcrumb}>
    <div className="section-header">
      <div className="section-heading"><div><span className="eyebrow icon-label"><Inbox /> Front desk</span>
        <h2 style={{ marginTop: 6 }}>Appointment requests</h2>
        <p className="section-description">People who are not yet patients ask for an appointment from your clinic&rsquo;s link or code. Match each one to an existing record or register them, and they&rsquo;re invited to the portal to choose a time.</p></div></div>
    </div>
    <Requests clinicId={actor.clinicId} requestCode={clinic ? formatRequestCode(clinic.requestCode) : null} requests={requests} mailConfigured={mailConfigured()} />
  </AppShell>;
}
