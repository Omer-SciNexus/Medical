import type { Metadata } from "next";
import { ChevronRight, Home, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app/shell";
import { emailVerificationState, getClinicSettings } from "@/modules/identity";
import { mailConfigured } from "@/platform/mailer";
import { requireActor } from "@/app/session";
import { Security } from "./security";

export const metadata: Metadata = { title: "Account security", robots: { index: false, follow: false } };

export default async function SecurityPage() {
  const actor = await requireActor();
  const [clinic, account] = await Promise.all([getClinicSettings(actor).catch(() => null), emailVerificationState(actor)]);
  const breadcrumb = <><span className="breadcrumb-app"><Home /></span><span className="breadcrumb-first">Your account</span><ChevronRight /><span>Security</span></>;
  return <AppShell actor={actor} clinicName={clinic?.name ?? "Your clinic"} current="/account/security" breadcrumb={breadcrumb} register={actor.role === "patient" ? "patient" : "clinical"}>
    <div className="section-header">
      <div className="section-heading"><div><span className="eyebrow icon-label"><ShieldCheck /> Your account</span>
        <h2 style={{ marginTop: 6 }}>Security</h2>
        <p className="section-description">Your email address, your authenticator and your sessions. Each change here is recorded against your account.</p></div></div>
    </div>
    <Security
      email={account.email}
      verified={account.verified}
      hasMfa={account.hasMfa}
      recoveryRemaining={account.recoveryRemaining}
      canReissue={actor.mfaVerifiedAt !== null}
      mailConfigured={mailConfigured()}
      usesAuthenticator={actor.role !== "patient"}
    />
  </AppShell>;
}
