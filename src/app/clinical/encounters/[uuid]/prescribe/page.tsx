import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Home, Pill, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/app/shell";
import { getClinicSettings } from "@/modules/identity";
import { getPrescribingWorkspace } from "@/modules/clinical";
import { requireActor } from "@/app/session";
import { Prescribe } from "./prescribe";

export const metadata: Metadata = { title: "Prescribe", robots: { index: false, follow: false } };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PrescribePage({ params }: { params: Promise<{ uuid: string }> }) {
  const actor = await requireActor(["clinician"]);
  const { uuid } = await params;
  if (!uuidPattern.test(uuid)) notFound();
  const [clinic, workspace] = await Promise.all([getClinicSettings(actor), getPrescribingWorkspace(actor, uuid).catch(() => null)]);
  const breadcrumb = <><span className="breadcrumb-app"><Home /></span><Link className="breadcrumb-first" href="/clinical/today">Today</Link><ChevronRight />
    <Link href={`/clinical/encounters/${uuid}`}>Encounter</Link><ChevronRight /><span>Prescribe</span></>;
  const shell = (children: React.ReactNode) =>
    <AppShell actor={actor} clinicName={clinic?.name ?? "Your clinic"} current="/clinical/today" breadcrumb={breadcrumb}>{children}</AppShell>;

  if (!workspace) return shell(<div className="specimen"><div className="state-panel error-example">
    <p className="empty-state-icon"><TriangleAlert /></p><h3>This visit is not available to you</h3>
    <p>Prescribing needs a care relationship with this patient for that purpose. The attempt was recorded.</p>
    <Link className="button button-secondary" href="/clinical/today">Back to today&rsquo;s clinic</Link>
  </div></div>);

  return shell(<>
    <div className="section-header">
      <div className="section-heading"><div><span className="eyebrow icon-label"><Pill /> Encounter</span>
        <h2 style={{ marginTop: 6 }}>Prescribe</h2>
        <p className="section-description">Every prescription is checked before it can be issued. A hard stop cannot be overridden; a warning needs a written justification and a fresh authenticator check.</p></div></div>
    </div>
    <Prescribe
      encounterId={workspace.encounter.id}
      open={workspace.encounter.status === "in_progress"}
      provider={workspace.provider}
      allergies={workspace.chart.allergies}
      prescriptions={workspace.prescriptions.map((prescription) => ({
        id: prescription.id, name: prescription.name, strength: prescription.strength, form: prescription.form,
        dose: prescription.dose, unit: prescription.unit, route: prescription.route, frequency: prescription.frequency, durationDays: prescription.durationDays,
        status: prescription.status, safetyStatus: prescription.safetyStatus, safetySource: prescription.safetySource,
        safetyFindings: prescription.safetyFindings, overrideReason: prescription.overrideReason,
        issuedAt: prescription.issuedAt?.toISOString() ?? null,
      }))}
    />
  </>);
}
