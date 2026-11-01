import type { Metadata } from "next";
import { MailCheck, MailWarning } from "lucide-react";
import { confirmAppointmentRequest } from "@/modules/scheduling";

export const metadata: Metadata = { title: "Confirm your request" };
export const dynamic = "force-dynamic";

export default async function ConfirmRequestPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const confirmed = await confirmAppointmentRequest(token).catch(() => false);
  return <div className="auth-content">
    <div className="auth-title-icon">{confirmed ? <MailCheck /> : <MailWarning />}</div>
    <span className="public-eyebrow">APPOINTMENT REQUEST</span>
    <h1>{confirmed ? "Thank you — your request is with the clinic." : "This link cannot be used."}</h1>
    <p className="auth-description">{confirmed
      ? "The clinic will review it and email you a link to set up your account and choose a time. You can close this page."
      : "It may have expired or already been used. Confirmation links work once and last 24 hours. If you still need an appointment, send a new request from the clinic's link."}</p>
  </div>;
}
