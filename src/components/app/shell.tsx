import Link from "next/link";
import { CalendarCheck, CalendarRange, ClipboardList, LayoutDashboard, LogOut, ScrollText, ShieldCheck, UserRoundPlus, Users } from "lucide-react";
import { MeridianMark } from "@/components/design/graphics";
import { signOutAction } from "@/app/(auth)/actions";
import type { Actor } from "@/modules/identity";

// Only routes that exist and that this role may actually open.
const navigation = {
  clinician: [{ href: "/clinical/today", label: "Today's clinic", icon: ClipboardList }],
  staff: [{ href: "/staff/patients", label: "Patients", icon: UserRoundPlus }, { href: "/dashboard", label: "Your workspace", icon: LayoutDashboard }],
  patient: [{ href: "/patient/book", label: "Your care", icon: CalendarCheck }],
  admin: [{ href: "/admin/people", label: "People", icon: Users }, { href: "/admin/schedule", label: "Schedule", icon: CalendarRange },
    { href: "/staff/patients", label: "Patients", icon: UserRoundPlus }, { href: "/admin/audit", label: "Access log", icon: ScrollText }],
} satisfies Record<Actor["role"], { href: string; label: string; icon: typeof ClipboardList }[]>;

export function AppShell({ actor, clinicName, current, breadcrumb, children, register = "clinical" }: {
  actor: Actor; clinicName: string; current: string; breadcrumb: React.ReactNode; children: React.ReactNode; register?: "clinical" | "patient";
}) {
  return <div className={`app-shell${register === "patient" ? " patient-register" : ""}`}>
    <a className="skip-link" href="#main">Skip to content</a>
    <aside className="sidebar">
      <Link href="/dashboard" className="brand" aria-label="Meridian workspace"><span className="brand-mark"><MeridianMark /></span><span>meridian<span className="brand-period">.</span></span></Link>
      <p className="brand-caption">{clinicName}</p>
      <nav className="sidebar-section" aria-label="Workspace">
        <span className="eyebrow">Workspace</span>
        <div className="side-nav">{navigation[actor.role].map(({ href, label, icon: Icon }) =>
          <Link key={href} href={href} data-active={current === href}><Icon />{label}</Link>)}</div>
      </nav>
      <div className="sidebar-note">
        <div className="workspace-identity">
          <span className="workspace-icon"><ShieldCheck /></span>
          <div><strong>{actor.role === "admin" ? "Administrator" : `${actor.role[0].toUpperCase()}${actor.role.slice(1)}`}</strong><span>{actor.mfaVerified ? "Verified session" : "Session active"}</span></div>
        </div>
        <p>Synthetic development data. This build is not a certified clinical system.</p>
      </div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <nav className="breadcrumb" aria-label="Breadcrumb">{breadcrumb}</nav>
        <div className="topbar-actions">
          <form action={signOutAction}><button className="shortcut-button" type="submit"><LogOut /><span>Sign out</span></button></form>
        </div>
      </header>
      <main className="main-content" id="main">{children}</main>
    </div>
  </div>;
}
