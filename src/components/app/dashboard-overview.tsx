import Link from "next/link";
import { ArrowRight, ArrowUpRight, CalendarDays, CalendarPlus, CalendarRange, CheckCheck, ChevronRight, ClipboardList, Clock3, FileText, Inbox, Receipt, ShieldCheck, Stethoscope, Users } from "lucide-react";
import type { Actor } from "@/modules/identity";

const icons = { calendar: CalendarDays, people: Users, clock: Clock3, complete: CheckCheck, document: FileText };
export type DashboardMetric = { label: string; value: number; hint: string; href: string; icon: keyof typeof icons };
export type DashboardRow = { id: string; title: string; detail: string; time: string; caption: string; status: string; tone: "neutral" | "active"; href: string };
export type DashboardSummary = {
  metrics: DashboardMetric[];
  focus: { title: string; description: string; href: string; action: string };
  panel: { title: string; description: string; href: string; action: string; emptyTitle: string; emptyDescription: string };
  rows: DashboardRow[];
  distribution: { title: string; items: { label: string; value: number }[] } | null;
};
const workspaces = {
  admin: {
    label: "Clinic overview", introduction: "Your team, your schedule, and a clear way forward.",
    shortcuts: [
      { href: "/admin/people", title: "People & invitations", text: "Manage your team and their accounts", icon: Users },
      { href: "/admin/schedule", title: "Manage availability", text: "Weekly sessions and appointment times", icon: CalendarRange },
      { href: "/admin/reports", title: "Clinic reports", text: "Review attendance and capacity", icon: ClipboardList },
      { href: "/admin/services", title: "Services & billing", text: "Price list, invoices, and payments", icon: Receipt },
    ],
  },
  clinician: {
    label: "Clinical overview", introduction: "A little more clarity. More space for your patients.",
    shortcuts: [
      { href: "/clinical/today", title: "Today's clinic", text: "Your queue, charts, and consultations", icon: Stethoscope },
      { href: "/account/security", title: "Account & security", text: "Sign-in and recovery options", icon: ShieldCheck },
    ],
  },
  staff: {
    label: "Front-desk overview", introduction: "Keep arrivals, appointments, and the team in step.",
    shortcuts: [
      { href: "/staff/board", title: "Waiting room", text: "Follow arrivals and visit progress", icon: ClipboardList },
      { href: "/staff/patients", title: "Find a patient", text: "Registrations and portal access", icon: Users },
      { href: "/admin/services", title: "Invoices & payments", text: "Review charges and record payments", icon: Receipt },
    ],
  },
  patient: {
    label: "Your care overview", introduction: "Your appointments and next steps, all in one place.",
    shortcuts: [
      { href: "/patient/book", title: "Book a visit", text: "Find a clinician and an available time", icon: CalendarPlus },
      { href: "/patient/appointments", title: "Your appointments", text: "Review a visit or choose a new time", icon: CalendarDays },
      { href: "/account/security", title: "Account & security", text: "Keep your sign-in details up to date", icon: ShieldCheck },
    ],
  },
} satisfies Record<Actor["role"], { label: string; introduction: string; shortcuts: { href: string; title: string; text: string; icon: typeof Users }[] }>;

export function DashboardOverview({ role, name, clinicName, day, timeZone, verified, summary }: {
  role: Actor["role"]; name: string; clinicName: string; day: string; timeZone: string; verified: boolean; summary: DashboardSummary | null;
}) {
  const workspace = workspaces[role];
  const date = new Date(`${day}T12:00:00Z`);
  const formattedDay = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(date);
  return <div className="dashboard-overview">
    <div className="dashboard-heading">
      <div><span className="eyebrow">{workspace.label}</span><h1>Welcome back, {name.trim().split(/\s+/)[0]}<span>.</span></h1><p>{workspace.introduction}</p></div>
      <div className="dashboard-date"><CalendarDays aria-hidden="true" /><div><time dateTime={day}>{formattedDay}</time><span>{timeZone}</span></div></div>
    </div>
    {summary ? <>
      <section className="dashboard-focus" aria-labelledby="dashboard-focus-heading">
        <div><span className="dashboard-kicker">{clinicName} <span aria-hidden="true">/</span> {role === "patient" ? "Your next step" : "At a glance"}</span><h2 id="dashboard-focus-heading">{summary.focus.title}</h2><p>{summary.focus.description}</p><Link className="dashboard-primary" href={summary.focus.href}>{summary.focus.action}<ArrowRight aria-hidden="true" /></Link></div>
      </section>
      <section className="dashboard-metrics" aria-label="Workspace summary">{summary.metrics.map(({ label, value, hint, href, icon }) => {
        const Icon = icons[icon];
        return <Link href={href} className="dashboard-metric" key={label}><span className="dashboard-metric-heading"><span className="dashboard-metric-icon"><Icon aria-hidden="true" /></span><ArrowUpRight aria-hidden="true" /></span><strong>{value}</strong><span className="dashboard-metric-label">{label}</span><span className="dashboard-metric-hint">{hint}</span></Link>;
      })}</section>
    </> : <section className="dashboard-unavailable" role="status"><Inbox aria-hidden="true" /><div><h2>Your overview is temporarily unavailable.</h2><p>Your workspace shortcuts are still available. Reload to try fetching the latest information.</p><Link href="/dashboard">Reload overview <ArrowRight aria-hidden="true" /></Link></div></section>}
    <div className="dashboard-columns">
      {summary && <section className="dashboard-panel" aria-labelledby="dashboard-panel-heading">
        <div className="dashboard-panel-heading"><div><span className="eyebrow">{role === "admin" ? "Planning ahead" : "Your day, organised"}</span><h2 id="dashboard-panel-heading">{summary.panel.title}</h2><p>{summary.panel.description}</p></div><Link href={summary.panel.href}>{summary.panel.action}<ArrowUpRight aria-hidden="true" /></Link></div>
        {summary.distribution && <div className="dashboard-distribution"><h3>{summary.distribution.title}</h3><ul>{summary.distribution.items.map(item => <li key={item.label}><span>{item.label}</span><strong>{item.value}</strong><span className="dashboard-distribution-track" aria-hidden="true"><span style={{ width: `${Math.max(0, item.value) / Math.max(1, ...summary.distribution!.items.map(entry => entry.value)) * 100}%` }} /></span></li>)}</ul></div>}
        {summary.rows.length ? <ul className="dashboard-agenda">{summary.rows.map(row => <li key={row.id}><Link href={row.href}><div className="dashboard-agenda-time"><strong>{row.time}</strong><span>{row.caption}</span></div><div className="dashboard-agenda-copy"><strong>{row.title}</strong><span>{row.detail}</span></div><span className="dashboard-status" data-tone={row.tone}>{row.status}</span><ChevronRight aria-hidden="true" /></Link></li>)}</ul> : <div className="dashboard-empty"><span><CalendarDays aria-hidden="true" /></span><h3>{summary.panel.emptyTitle}</h3><p>{summary.panel.emptyDescription}</p><Link href={summary.panel.href}>{summary.panel.action}<ArrowRight aria-hidden="true" /></Link></div>}
        {summary.rows.length > 0 && <div className="dashboard-panel-footer"><span>Showing {summary.rows.length} {role === "admin" ? "weekly sessions" : "appointments"}</span><Link href={summary.panel.href}>View all <ArrowRight aria-hidden="true" /></Link></div>}
      </section>}
      <div className="dashboard-rail">
        <section className="dashboard-shortcuts" aria-labelledby="dashboard-shortcuts-heading"><span className="eyebrow">Within reach</span><h2 id="dashboard-shortcuts-heading">Your workspace</h2><div>{workspace.shortcuts.map(({ href, title, text, icon: Icon }) => <Link href={href} key={href}><span className="dashboard-shortcut-icon"><Icon aria-hidden="true" /></span><span><strong>{title}</strong><small>{text}</small></span><ChevronRight aria-hidden="true" /></Link>)}</div></section>
        <section className="dashboard-security" aria-labelledby="dashboard-security-heading"><ShieldCheck aria-hidden="true" /><div><h2 id="dashboard-security-heading">{verified ? "A verified session" : "Your account, protected"}</h2><p>{verified ? "Authenticator or recovery verification is complete. Keep your recovery options up to date." : "Review your sign-in details and recovery options in account settings."}</p><Link href="/account/security">Manage security <ArrowUpRight aria-hidden="true" /></Link></div></section>
      </div>
    </div>
    <p className="dashboard-footnote"><Clock3 aria-hidden="true" />Overview reflects data at page load. {role === "clinician" || role === "staff" ? "Open your queue for live updates." : "Reload to refresh."}</p>
  </div>;
}
