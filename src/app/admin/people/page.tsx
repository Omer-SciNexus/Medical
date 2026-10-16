import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Home, MailWarning, TriangleAlert, Users } from "lucide-react";
import { AppShell } from "@/components/app/shell";
import { emailVerificationState, getClinicSettings, listPeople } from "@/modules/identity";
import { mailConfigured } from "@/platform/mailer";
import { requireActor } from "@/app/session";
import { People } from "./people";

export const metadata: Metadata = { title: "People", robots: { index: false, follow: false } };

export default async function PeoplePage() {
  const actor = await requireActor(["admin"]);
  const clinic = await getClinicSettings(actor).catch(() => null);
  const breadcrumb = <><span className="breadcrumb-app"><Home /></span><span className="breadcrumb-first">Administration</span><ChevronRight /><span>People</span></>;
  const shell = (children: React.ReactNode) =>
    <AppShell actor={actor} clinicName={clinic?.name ?? "Your clinic"} current="/admin/people" breadcrumb={breadcrumb}>{children}</AppShell>;

  const [result, account] = await Promise.all([listPeople(actor).catch(() => null), emailVerificationState(actor)]);
  if (!result) return shell(<div className="specimen"><div className="state-panel error-example">
    <p className="empty-state-icon"><TriangleAlert /></p><h3>This clinic&rsquo;s people could not be read</h3>
    <p>Nothing was changed. Confirm the database is running, then reload this page.</p>
  </div></div>);

  return shell(<>
    <div className="section-header">
      <div className="section-heading"><div><span className="eyebrow icon-label"><Users /> Administration</span>
        <h2 style={{ marginTop: 6 }}>People</h2>
        <p className="section-description">Invite colleagues, end sessions and reset authenticators. None of this grants chart access: every change here is recorded in the access log.</p></div></div>
    </div>
    {account.verified ? null : <div className="integrity-banner integrity-broken" role="status">
      <MailWarning />
      <div><strong>Confirm your email address before inviting colleagues</strong>
        <p>Invitations are sent in this clinic&rsquo;s name, so your own address has to be confirmed first. Send yourself a confirmation link from <Link href="/account/security">your security settings</Link>.</p></div>
    </div>}
    <People
      self={actor.id}
      mailConfigured={mailConfigured()}
      people={result.people.map((person) => ({ ...person, createdAt: person.createdAt.toISOString() }))}
      invitations={result.invitations.map((invitation) => ({
        id: invitation.id, email: invitation.email, displayName: invitation.displayName, role: invitation.role,
        expiresAt: invitation.expiresAt.toISOString(), consumedAt: invitation.consumedAt?.toISOString() ?? null, revokedAt: invitation.revokedAt?.toISOString() ?? null,
      }))}
    />
  </>);
}
