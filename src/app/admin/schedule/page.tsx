import type { Metadata } from "next";
import { CalendarRange, ChevronRight, Home, TriangleAlert, UserPlus } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/app/shell";
import { getClinicSettings, listCareProviders } from "@/modules/identity";
import { getScheduleAuthoring } from "@/modules/scheduling";
import { requireActor } from "@/app/session";
import { Schedule } from "./schedule";

export const metadata: Metadata = { title: "Schedule", robots: { index: false, follow: false } };

export default async function SchedulePage() {
  const actor = await requireActor(["admin"]);
  const clinic = await getClinicSettings(actor).catch(() => null);
  const breadcrumb = <><span className="breadcrumb-app"><Home /></span><span className="breadcrumb-first">Administration</span><ChevronRight /><span>Schedule</span></>;
  const shell = (children: React.ReactNode) =>
    <AppShell actor={actor} clinicName={clinic?.name ?? "Your clinic"} current="/admin/schedule" breadcrumb={breadcrumb}>{children}</AppShell>;

  const [authoring, providers] = await Promise.all([getScheduleAuthoring(actor).catch(() => null), listCareProviders(actor).catch(() => [])]);
  if (!authoring) return shell(<div className="specimen"><div className="state-panel error-example">
    <p className="empty-state-icon"><TriangleAlert /></p><h3>The schedule could not be read</h3>
    <p>Nothing was changed. Confirm the database is running, then reload this page.</p>
  </div></div>);

  const header = <div className="section-header">
    <div className="section-heading"><div><span className="eyebrow icon-label"><CalendarRange /> Administration</span>
      <h2 style={{ marginTop: 6 }}>Schedule</h2>
      <p className="section-description">Weekly sessions per clinician, expanded into bookable appointment times. Overlaps are refused by the database, not guessed at here.</p></div></div>
  </div>;

  if (!providers.length) return shell(<>{header}
    <div className="specimen"><div className="state-panel" style={{ textAlign: "center", padding: "48px 24px" }}>
      <p className="empty-state-icon"><UserPlus /></p><h3>No clinicians yet</h3>
      <p>A weekly session belongs to a clinician, so invite one first. Their sessions then become the times patients can book.</p>
      <Link className="button button-primary" href="/admin/people">Invite a clinician</Link>
    </div></div></>);

  return shell(<>{header}
    <Schedule
      timeZone={authoring.timeZone}
      providers={providers}
      templates={authoring.templates}
      blackouts={authoring.blackouts.map((blackout) => ({ ...blackout, startsAt: blackout.startsAt.toISOString(), endsAt: blackout.endsAt.toISOString() }))}
    />
  </>);
}
