import { ChevronRight, Home } from "lucide-react";
import { AppShell } from "@/components/app/shell";
import { DashboardOverview } from "@/components/app/dashboard-overview";
import { findAccountSummary, getClinicSettings } from "@/modules/identity";
import { clinicTimezone, todayInZone } from "@/lib/clinic-day";
import { requireActor } from "@/app/session";
import { redirect } from "next/navigation";
import { readDashboardSummary } from "./summary";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Your workspace", robots: { index: false, follow: false } };

export default async function DashboardPage() {
  const actor = await requireActor();
  const account = await findAccountSummary(actor);
  if (!account) redirect("/sign-in");
  const clinic = await getClinicSettings(actor).catch(() => null);
  const timeZone = clinic?.timezone ?? clinicTimezone();
  const summary = await readDashboardSummary(actor, timeZone).catch(() => null);
  return <AppShell actor={actor} clinicName={account.clinicName} current="/dashboard" breadcrumb={<><Home aria-hidden="true" /><ChevronRight aria-hidden="true" /><span>Overview</span></>} register={actor.role === "patient" ? "patient" : "clinical"}>
    <DashboardOverview role={actor.role} name={account.displayName} clinicName={account.clinicName} day={todayInZone(timeZone)} timeZone={timeZone} verified={actor.mfaVerified} summary={summary} />
  </AppShell>;
}
