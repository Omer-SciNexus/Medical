import type { Metadata } from "next";
import { CalendarX } from "lucide-react";
import { describeRequestClinic } from "@/modules/identity";
import { RequestForm } from "./request-form";

export const metadata: Metadata = { title: "Request an appointment" };
export const dynamic = "force-dynamic";

export default async function RequestAppointmentPage({ searchParams }: { searchParams: Promise<{ clinic?: string }> }) {
  const { clinic: clinicId } = await searchParams;
  const clinic = await describeRequestClinic(clinicId).catch(() => null);
  if (!clinic) return <div className="auth-content">
    <div className="auth-title-icon"><CalendarX /></div>
    <span className="public-eyebrow">APPOINTMENT REQUEST</span>
    <h1>This link isn&rsquo;t valid.</h1>
    <p className="auth-description">It may be incomplete or out of date. Ask the clinic for their current appointment request link.</p>
  </div>;
  return <RequestForm clinicId={clinic.id} clinicName={clinic.name} />;
}
