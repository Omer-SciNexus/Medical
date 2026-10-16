import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Check, LayoutDashboard, LogOut, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/public/brand";
import { CareGraphic } from "@/components/design/graphics";
import { findAccountSummary, resolveSession, SESSION_COOKIE } from "@/modules/identity";
import { signOutAction } from "@/app/(auth)/actions";

export const metadata: Metadata = { title: "Your workspace", robots: { index: false, follow: false } };
// Where each role starts.
const entryPoint = { clinician: { href: "/clinical/today", label: "Open today’s clinic" }, patient: { href: "/patient/appointments", label: "See your appointments" }, admin: { href: "/admin/people", label: "Set up your clinic" }, staff: { href: "/staff/board", label: "Open the waiting room" } } as const;

export default async function DashboardPage() {
  const actor = await resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!actor) redirect("/sign-in");
  const account = await findAccountSummary(actor);
  if (!account) redirect("/sign-in");
  const entry = entryPoint[actor.role];
  return <div className="account-shell"><header className="account-header public-container"><Brand /><form action={signOutAction}><button className="public-button public-button-outline public-button-small" type="submit">Sign out <LogOut /></button></form></header><main className="public-container account-main"><div className="account-welcome"><span className="public-eyebrow"><LayoutDashboard /> YOUR WORKSPACE</span><h1>Welcome, {account.displayName.split(" ")[0]}.</h1><p>You’re signed in to <strong>{account.clinicName}</strong>.</p><div className="account-access"><ShieldCheck /><div><strong>{actor.role === "admin" ? "Workspace administrator" : `${actor.role.charAt(0).toUpperCase()}${actor.role.slice(1)} account`}</strong><span>{actor.mfaVerified ? "Authenticator or recovery verification complete" : "Your account is connected"}</span></div><Check /></div><h2>Your workspace starts here.</h2><p>The complete visit thread is available: booking, the clinical encounter, the signed note, the charge and the published summary.</p><Link className="public-button" href={entry.href}>{entry.label} <ArrowRight /></Link><Link className="public-button public-button-outline" href="/design">Design library <ArrowRight /></Link><p className="account-preview-note">This build uses synthetic development data. It is not a certified clinical system.</p></div><CareGraphic /></main></div>;
}
