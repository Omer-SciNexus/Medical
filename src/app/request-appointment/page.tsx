import type { Metadata } from "next";
import { ArrowRight, CalendarSearch } from "lucide-react";
import { clientAddress, describeRequestClinic } from "@/modules/identity";
import { findRequestClinic } from "@/modules/scheduling";
import { RequestForm } from "./request-form";

export const metadata: Metadata = { title: "Request an appointment" };
export const dynamic = "force-dynamic";

const codeErrors = {
  not_found: "No clinic has that code. Check it against what your clinic gave you and try again.",
  limited: "Too many codes tried from here. Please wait 15 minutes and try again.",
  unavailable: "Codes cannot be checked right now. Please try again shortly.",
  invalid_link: "This link isn’t valid. It may be incomplete or out of date. If your clinic gave you a code, enter it here.",
} as const;

// Reached from the sign-in page and the home page with no clinic yet, so the patient names it by code.
function CodeEntry({ code, error }: { code?: string; error?: keyof typeof codeErrors }) {
  return <div className="auth-content">
    <div className="auth-title-icon"><CalendarSearch /></div>
    <span className="public-eyebrow">APPOINTMENT REQUEST</span>
    <h1>Which clinic?</h1>
    <p className="auth-description">Enter the code your clinic gave you. It is eight letters and numbers, like K7M4-QX9P. You don&rsquo;t need an account to send a request.</p>
    {error ? <div className="auth-error" role="alert">{codeErrors[error]}</div> : null}
    <form method="get" action="/request-appointment" className="auth-form">
      <div className="auth-field"><label htmlFor="code">Clinic code</label>
        <input id="code" name="code" className="auth-input" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={16} required
          defaultValue={code} aria-invalid={error === "not_found"} aria-describedby="code-hint" />
        <p className="auth-field-hint" id="code-hint">Don&rsquo;t have one? Ask your clinic for their code or their appointment request link.</p></div>
      <button className="public-button auth-submit" type="submit">Continue<ArrowRight /></button>
    </form>
  </div>;
}

export default async function RequestAppointmentPage({ searchParams }: { searchParams: Promise<{ clinic?: string; code?: string }> }) {
  const { clinic: clinicId, code } = await searchParams;
  if (code !== undefined) {
    const found = await findRequestClinic(code, await clientAddress()).catch(() => ({ status: "unavailable" as const }));
    if (found.status === "found") return <RequestForm clinicId={found.clinic.id} clinicName={found.clinic.name} />;
    return <CodeEntry code={code} error={found.status} />;
  }
  if (clinicId === undefined) return <CodeEntry />;
  const clinic = await describeRequestClinic(clinicId).catch(() => null);
  if (!clinic) return <CodeEntry error="invalid_link" />;
  return <RequestForm clinicId={clinic.id} clinicName={clinic.name} />;
}
