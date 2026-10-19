import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, CheckCircle2, ChevronRight, FileText, Home, TriangleAlert, UserRound } from "lucide-react";
import { AppShell } from "@/components/app/shell";
import { Badge } from "@/components/ui/primitives";
import { getClinicSettings, listCareProviders } from "@/modules/identity";
import { listMyAppointments, listProviderAvailability } from "@/modules/scheduling";
import { listMyVisits } from "@/modules/clinical";
import { clinicalDate } from "@/lib/format";
import { clinicTimezone } from "@/lib/clinic-day";
import { requireActor } from "@/app/session";
import { Booking } from "./booking";

export const metadata: Metadata = { title: "Book a visit", robots: { index: false, follow: false } };

export default async function BookPage({ searchParams }: { searchParams: Promise<{ providerId?: string; confirmed?: string }> }) {
  const actor = await requireActor(["patient"]);
  const { providerId, confirmed } = await searchParams;
  const timeZone = (await getClinicSettings(actor).catch(() => null))?.timezone ?? clinicTimezone();
  const breadcrumb = <><span className="breadcrumb-app"><Home /></span><span className="breadcrumb-first">Your care</span><ChevronRight /><span>Book a visit</span></>;
  const shell = (children: React.ReactNode, clinicName: string) =>
    <AppShell actor={actor} clinicName={clinicName} current="/patient/book" breadcrumb={breadcrumb} register="patient">{children}</AppShell>;

  let clinicName = "Your clinic";
  try {
    const [clinic, providers, appointments, visits] = await Promise.all([
      getClinicSettings(actor), listCareProviders(actor), listMyAppointments(actor), listMyVisits(actor),
    ]);
    clinicName = clinic?.name ?? clinicName;
    const provider = providers.find((candidate) => candidate.id === providerId) ?? null;
    const slots = provider ? await listProviderAvailability(actor, { providerId: provider.id, days: 21 }) : [];
    const upcoming = appointments.filter((appointment) => appointment.startsAt.getTime() > Date.now() && appointment.status !== "cancelled");
    const published = visits.filter((visit) => visit.publishedAt);

    return shell(<>
      <div className="patient-welcome">
        <span className="patient-welcome-label"><span className="patient-welcome-line" /> Your care</span>
        <h1>{confirmed ? "Your appointment is booked." : "Book a visit."}</h1>
        <p>{confirmed ? "We have saved your appointment and your clinician can see the reason you gave. You can review it below."
          : "Choose a clinician, tell us what it is about, and pick a time that suits you. Nothing is booked until you confirm."}</p>
      </div>

      {confirmed ? <div className="booking-confirmed" role="status"><CheckCircle2 /><div>
        <strong>Appointment confirmed</strong><p>A reminder will be sent before your visit. You can book another below.</p></div></div> : null}

      <section className="section">
        <div className="section-header"><div className="section-heading"><div>
          <span className="eyebrow icon-label"><UserRound /> Step 1</span><h2 style={{ marginTop: 6 }}>Choose your clinician</h2></div></div></div>
        {!providers.length ? <p className="booking-empty"><TriangleAlert /> No clinicians are available for booking in this clinic yet.</p>
          : <div className="provider-options">{providers.map((candidate) => <Link key={candidate.id} href={`/patient/book?providerId=${candidate.id}`}
            className="provider-option" data-selected={candidate.id === provider?.id}>
            <span className="provider-avatar"><UserRound /></span>
            <span><strong>{candidate.displayName}</strong><small>General practice</small></span>
            {candidate.id === provider?.id ? <CheckCircle2 /> : <ChevronRight />}
          </Link>)}</div>}
      </section>

      {provider ? <section className="section">
        <div className="section-header"><div className="section-heading"><div>
          <span className="eyebrow icon-label"><CalendarCheck /> Step 2</span><h2 style={{ marginTop: 6 }}>Reason and time</h2></div></div></div>
        <Booking providerId={provider.id} providerName={provider.displayName} timeZone={timeZone}
          slots={slots.map((slot) => ({ id: slot.id, startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() }))} />
      </section> : null}

      {upcoming.length ? <section className="section">
        <h2>Your upcoming visits</h2>
        <ul className="visit-list">{upcoming.map((appointment) => <li key={appointment.id}>
          <div><strong>{clinicalDate(appointment.startsAt, new Date(), timeZone)}</strong><p>{appointment.reason}</p></div>
          <Badge tone={appointment.status === "booked" ? "neutral" : "accent"}>{appointment.status.replace("_", " ")}</Badge>
        </li>)}</ul>
      </section> : null}

      {published.length ? <section className="section">
        <h2>Your visit summaries</h2>
        <ul className="visit-list">{published.map((visit) => <li key={visit.id}>
          <div><strong>{clinicalDate(visit.completedAt ?? visit.createdAt, new Date(), timeZone)}</strong><p>Reviewed and published by your clinician</p></div>
          <Link className="button button-secondary button-small" href={`/patient/visits/${visit.id}`}><FileText /> Read summary</Link>
        </li>)}</ul>
      </section> : null}
    </>, clinicName);
  } catch {
    return shell(<div className="specimen"><div className="state-panel error-example">
      <p className="empty-state-icon"><TriangleAlert /></p><h3>Booking is unavailable right now</h3>
      <p>Nothing was changed and no appointment was created. Please try again shortly.</p>
    </div></div>, clinicName);
  }
}
