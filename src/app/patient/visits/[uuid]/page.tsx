import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight, Clock, FileText, Home, Receipt, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/app/shell";
import { getClinicSettings } from "@/modules/identity";
import { getVisitSummary } from "@/modules/clinical";
import { clinicalDate, patientName } from "@/lib/format";
import { clinicTimezone } from "@/lib/clinic-day";
import { requireActor } from "@/app/session";

export const metadata: Metadata = { title: "Your visit summary", robots: { index: false, follow: false } };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function VisitPage({ params }: { params: Promise<{ uuid: string }> }) {
  const actor = await requireActor(["patient", "clinician"]);
  const { uuid } = await params;
  if (!uuidPattern.test(uuid)) notFound();
  const timeZone = clinicTimezone();
  const [clinic, visit] = await Promise.all([getClinicSettings(actor), getVisitSummary(actor, uuid).catch(() => null)]);
  const breadcrumb = <><span className="breadcrumb-app"><Home /></span><Link className="breadcrumb-first" href="/patient/book">Your care</Link><ChevronRight /><span>Visit summary</span></>;
  const shell = (children: React.ReactNode) =>
    <AppShell actor={actor} clinicName={clinic?.name ?? "Your clinic"} current="/patient/book" breadcrumb={breadcrumb} register="patient">{children}</AppShell>;

  if (!visit) return shell(<div className="specimen"><div className="state-panel error-example">
    <p className="empty-state-icon"><TriangleAlert /></p><h3>This visit is not available</h3>
    <p>It may not exist, or it may belong to another patient. If you believe this is your visit, contact the clinic.</p>
    <Link className="button button-secondary" href="/patient/book"><ArrowLeft /> Back to your care</Link>
  </div></div>);

  const { summary, patient } = visit;
  return shell(<>
    <div className="patient-welcome">
      <span className="patient-welcome-label"><span className="patient-welcome-line" /> Visit summary</span>
      <h1>{summary.published ? "Your visit summary." : "Your summary is being prepared."}</h1>
      <p>{patientName(patient.givenName, patient.surname)} &middot; {summary.completedAt ? clinicalDate(summary.completedAt, new Date(), timeZone) : "Visit in progress"}</p>
    </div>

    {summary.published ? <article className="visit-summary">
      <span className="eyebrow icon-label"><FileText /> Written and reviewed by your clinician</span>
      <div className="visit-summary-body">{summary.summary!.split("\n").filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
      {summary.charge ? <p className="visit-charge"><Receipt /> {summary.charge.description}: {(summary.charge.amountMinor / 100).toFixed(2)} {summary.charge.currency} &middot; {summary.charge.status}</p> : null}
      <p className="context-footnote">This is the summary your clinician published. It is not a prescription and does not replace advice from the clinic.</p>
    </article> : <div className="visit-pending" role="status">
      <Clock /><div><strong>Not published yet</strong>
      <p>Your clinician has not finished reviewing this visit. Summaries appear here only after they have been written and signed, so nothing unreviewed is shown to you.</p></div>
    </div>}

    <p style={{ marginTop: 24 }}><Link className="button button-secondary" href="/patient/book"><ArrowLeft /> Back to your care</Link></p>
  </>);
}
