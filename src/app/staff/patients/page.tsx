import type { Metadata } from "next";
import { ChevronRight, Home, UserRoundPlus } from "lucide-react";
import { AppShell } from "@/components/app/shell";
import { getClinicSettings } from "@/modules/identity";
import { mailConfigured } from "@/platform/mailer";
import { requireActor } from "@/app/session";
import { Patients } from "./patients";

export const metadata: Metadata = { title: "Patients", robots: { index: false, follow: false } };

export default async function PatientsPage() {
  const actor = await requireActor(["staff", "admin"]);
  const clinic = await getClinicSettings(actor).catch(() => null);
  const breadcrumb = <><span className="breadcrumb-app"><Home /></span><span className="breadcrumb-first">Front desk</span><ChevronRight /><span>Patients</span></>;
  return <AppShell actor={actor} clinicName={clinic?.name ?? "Your clinic"} current="/staff/patients" breadcrumb={breadcrumb}>
    <div className="section-header">
      <div className="section-heading"><div><span className="eyebrow icon-label"><UserRoundPlus /> Front desk</span>
        <h2 style={{ marginTop: 6 }}>Patients</h2>
        {/* Searching is a patient read, so it is recorded; names never travel in the address bar. */}
        <p className="section-description">Register someone new, or find an existing record to invite them to the portal. Every search is recorded against your account.</p></div></div>
    </div>
    <Patients mailConfigured={mailConfigured()} />
  </AppShell>;
}
