import type { Metadata } from "next";
import { ChevronRight, Home, KeyRound, ShieldCheck, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/app/shell";
import { getClinicSettings, listAccessGrants } from "@/modules/identity";
import { clinicTimezone } from "@/lib/clinic-day";
import { requireActor } from "@/app/session";
import { Access } from "./access";

export const metadata: Metadata = { title: "Who holds access", robots: { index: false, follow: false } };

export default async function AccessPage() {
  const actor = await requireActor(["admin"]);
  const clinic = await getClinicSettings(actor).catch(() => null);
  const breadcrumb = <><span className="breadcrumb-app"><Home /></span><span className="breadcrumb-first">Administration</span><ChevronRight /><span>Access</span></>;
  const shell = (children: React.ReactNode) =>
    <AppShell actor={actor} clinicName={clinic?.name ?? "Your clinic"} current="/admin/access" breadcrumb={breadcrumb}>{children}</AppShell>;

  const grants = await listAccessGrants(actor).catch(() => null);
  if (!grants) return shell(<div className="specimen"><div className="state-panel error-example">
    <p className="empty-state-icon"><TriangleAlert /></p><h3>Access could not be listed</h3>
    <p>Nothing was changed. Confirm the database is running, then reload this page.</p>
  </div></div>);

  return shell(<>
    <div className="section-header">
      <div className="section-heading"><div><span className="eyebrow icon-label"><KeyRound /> Administration</span>
        <h2 style={{ marginTop: 6 }}>Who holds access</h2>
        <p className="section-description">Every live care relationship in this clinic. Booking grants scheduling access to the provider; arrival grants the clinical access that lets a chart be opened.</p></div></div>
    </div>
    <div className="integrity-banner" role="note">
      <ShieldCheck />
      <div><strong>Patients appear here as identifiers, not names</strong>
        <p>Administration grants no chart access, so this screen shows who holds access to which record without resolving a name. Withdrawing access takes effect on the next request and is itself recorded.</p></div>
    </div>
    <Access
      timeZone={clinic?.timezone ?? clinicTimezone()}
      grants={grants.map((grant) => ({ id: grant.id, patientId: grant.patientId, purpose: grant.purpose, emergency: grant.emergency, reason: grant.reason,
        actorName: grant.actorName, actorRole: grant.actorRole, createdAt: grant.createdAt.toISOString(), expiresAt: grant.expiresAt?.toISOString() ?? null }))}
    />
  </>);
}
