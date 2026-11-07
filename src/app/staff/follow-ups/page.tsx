import type { Metadata } from "next";
import { CalendarClock, ChevronRight, Home, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/app/shell";
import { getClinicSettings, listCareProviders, listPortalLinks } from "@/modules/identity";
import { FOLLOW_UP_CLOSE_REASONS, getFollowUpWorklist } from "@/modules/scheduling";
import { requireActor } from "@/app/session";
import { FollowUps, type FollowUpRow } from "./follow-ups";

export const metadata: Metadata = { title: "Follow-ups", robots: { index: false, follow: false } };
const SOON_DAYS = 14;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export default async function FollowUpsPage() {
  const actor = await requireActor(["staff", "admin"]);
  const clinic = await getClinicSettings(actor).catch(() => null);
  const breadcrumb = <><span className="breadcrumb-app"><Home /></span><span className="breadcrumb-first">Front desk</span><ChevronRight /><span>Follow-ups</span></>;
  const shell = (children: React.ReactNode) =>
    <AppShell actor={actor} clinicName={clinic?.name ?? "Your clinic"} current="/staff/follow-ups" breadcrumb={breadcrumb}>{children}</AppShell>;

  const loaded = await (async () => {
    const worklist = await getFollowUpWorklist(actor);
    const [providers, links] = await Promise.all([listCareProviders(actor), listPortalLinks(actor, [...new Set(worklist.followUps.map((row) => row.patientId))])]);
    return { worklist, providers, links };
  })().catch(() => null);
  if (!loaded) return shell(<div className="specimen"><div className="state-panel error-example">
    <p className="empty-state-icon"><TriangleAlert /></p><h3>Follow-ups could not be read</h3>
    <p>Nothing was changed. Reload the page to try again.</p>
  </div></div>);

  const { worklist, providers, links } = loaded;
  const formatDay = (day: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${day}T12:00:00Z`));
  const formatInstant = new Intl.DateTimeFormat("en-GB", { timeZone: worklist.timeZone, day: "numeric", month: "short" });
  const rows: FollowUpRow[] = worklist.followUps.map((row) => ({
    id: row.id, givenName: row.givenName, surname: row.surname, mrn: row.mrn,
    clinician: providers.find((provider) => provider.id === row.providerId)?.displayName ?? "A former colleague",
    due: formatDay(row.dueOn), daysUntilDue: daysBetween(worklist.today, row.dueOn),
    remindedOn: row.remindedAt ? formatInstant.format(row.remindedAt) : null,
    canRemind: links.accounts.some((account) => account.patientId === row.patientId && account.active),
  }));
  const overdue = rows.filter((row) => row.daysUntilDue < 0).length;
  const soon = rows.filter((row) => row.daysUntilDue >= 0 && row.daysUntilDue <= SOON_DAYS).length;

  return shell(<>
    <div className="section-header">
      <div className="section-heading"><div><span className="eyebrow icon-label"><CalendarClock /> Front desk</span>
        <h2 style={{ marginTop: 6 }}>Follow-ups</h2>
        <p className="section-description">Patients a clinician asked to see again who have not booked yet. They leave this list by themselves when they book with that clinician, and come back if they cancel or miss that visit.</p></div></div>
    </div>
    <div className="board-summary" style={{ marginBottom: 20 }}>
      <div><span className="board-count">{overdue}</span><span>overdue</span></div>
      <div><span className="board-count">{soon}</span><span>due within {SOON_DAYS} days</span></div>
      <div><span className="board-count">{rows.length - overdue - soon}</span><span>later</span></div>
    </div>
    <FollowUps rows={rows} closeReasons={[...FOLLOW_UP_CLOSE_REASONS]} />
  </>);
}
