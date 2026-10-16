import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarCheck, ChevronRight, Home, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/app/shell";
import { getClinicSettings, listCareProviders } from "@/modules/identity";
import { listMyAppointmentOptions, listMyAppointments } from "@/modules/scheduling";
import { clinicTimezone } from "@/lib/clinic-day";
import { requireActor } from "@/app/session";
import { Appointments } from "./appointments";

export const metadata: Metadata = { title: "Your appointments", robots: { index: false, follow: false } };

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<{ move?: string }> }) {
  const actor = await requireActor(["patient"]);
  const { move } = await searchParams;
  const timeZone = clinicTimezone();
  const breadcrumb = <><span className="breadcrumb-app"><Home /></span><span className="breadcrumb-first">Your care</span><ChevronRight /><span>Appointments</span></>;
  const shell = (children: React.ReactNode, clinicName: string) =>
    <AppShell actor={actor} clinicName={clinicName} current="/patient/appointments" breadcrumb={breadcrumb} register="patient">{children}</AppShell>;

  try {
    const [clinic, providers, appointments] = await Promise.all([getClinicSettings(actor), listCareProviders(actor), listMyAppointments(actor)]);
    const moving = appointments.find((appointment) => appointment.id === move && appointment.status === "booked") ?? null;
    // Only the appointment being moved needs its clinician's open times loaded.
    const options = moving ? await listMyAppointmentOptions(actor, moving.providerId) : [];
    return shell(<>
      <div className="patient-welcome">
        <span className="patient-welcome-label"><span className="patient-welcome-line" /> Your care</span>
        <h1>Your appointments.</h1>
        <p>What is coming up, what to bring, and what has already happened. You can move or cancel anything still to come.</p>
      </div>
      <Appointments
        timeZone={timeZone}
        moving={moving ? { id: moving.id, revision: moving.revision, providerId: moving.providerId } : null}
        options={options.map((slot) => ({ id: slot.id, startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() }))}
        providers={providers}
        appointments={appointments.map((appointment) => ({
          id: appointment.id, reason: appointment.reason, preparation: appointment.preparation, status: appointment.status, revision: appointment.revision,
          providerId: appointment.providerId, startsAt: appointment.startsAt.toISOString(), endsAt: appointment.endsAt.toISOString(),
        }))}
      />
      <p className="account-preview-note" style={{ marginTop: 20 }}>
        Need a different clinician or a new visit? <Link href="/patient/book">Book another appointment <ArrowRight /></Link>
      </p>
    </>, clinic?.name ?? "Your clinic");
  } catch {
    return shell(<div className="specimen"><div className="state-panel error-example">
      <p className="empty-state-icon"><TriangleAlert /></p><h3>Your appointments could not be loaded</h3>
      <p>Nothing was changed. Please try again shortly.</p>
      <Link className="button button-secondary" href="/patient/book"><CalendarCheck />Book a visit instead</Link>
    </div></div>, "Your clinic");
  }
}
