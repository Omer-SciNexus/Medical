import type { Metadata } from "next";
import { ChevronRight, Home, UserRoundPlus } from "lucide-react";
import { AppShell } from "@/components/app/shell";
import { getClinicSettings, listPeople } from "@/modules/identity";
import { listRecentRegistrations } from "@/modules/scheduling";
import { patientAge } from "@/modules/clinical";
import { clinicTimezone } from "@/lib/clinic-day";
import { mailConfigured } from "@/platform/mailer";
import { requireActor } from "@/app/session";
import { Patients, type RecentRegistration } from "./patients";

export const metadata: Metadata = { title: "Patients", robots: { index: false, follow: false } };

export default async function PatientsPage() {
  const actor = await requireActor(["staff", "admin"]);
  const clinic = await getClinicSettings(actor).catch(() => null);
  const breadcrumb = <><span className="breadcrumb-app"><Home /></span><span className="breadcrumb-first">Front desk</span><ChevronRight /><span>Patients</span></>;
  // Administrators review registrations after the fact instead of approving each one first.
  const review = actor.role === "admin" ? await loadReview(actor, clinic?.timezone ?? clinicTimezone()) : undefined;
  return <AppShell actor={actor} clinicName={clinic?.name ?? "Your clinic"} current="/staff/patients" breadcrumb={breadcrumb}>
    <div className="section-header">
      <div className="section-heading"><div><span className="eyebrow icon-label"><UserRoundPlus /> Front desk</span>
        <h2 style={{ marginTop: 6 }}>Patients</h2>
        {/* Searching is a patient read, so it is recorded; names never travel in the address bar. */}
        <p className="section-description">Register someone new, or find an existing record to correct it or invite them to the portal. Every search is recorded against your account.</p></div></div>
    </div>
    <Patients mailConfigured={mailConfigured()} review={review} />
  </AppShell>;
}

async function loadReview(actor: Parameters<typeof listRecentRegistrations>[0], timeZone: string) {
  const [recent, people] = await Promise.all([listRecentRegistrations(actor).catch(() => null), listPeople(actor).then((result) => result.people).catch(() => [])]);
  if (!recent) return null;
  const nameOf = (id: string) => people.find((person) => person.id === id)?.displayName ?? "A former colleague";
  const when = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return { days: recent.days, registrations: recent.registrations.map((row): RecentRegistration => ({
    id: row.id, givenName: row.givenName, surname: row.surname, age: patientAge(row.birthDate), sex: row.sex, mrn: row.mrn,
    registeredBy: nameOf(row.createdBy), registeredAt: when.format(row.createdAt),
    correctedBy: row.corrected ? nameOf(row.updatedBy) : null,
  })) };
}
