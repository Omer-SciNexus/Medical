import type { Metadata } from "next";
import Link from "next/link";
import { ChartNoAxesColumn, ChevronRight, Home, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/app/shell";
import { getClinicSettings, listCareProviders } from "@/modules/identity";
import { getClinicReport } from "@/modules/scheduling";
import { requireActor } from "@/app/session";

export const metadata: Metadata = { title: "Clinic report", robots: { index: false, follow: false } };
const WINDOWS = [7, 28, 92];
const percent = (part: number, whole: number) => whole ? `${Math.round((part / whole) * 100)}%` : "—";
const minutes = (value: number | null) => value === null ? "—" : `${Math.round(value)} min`;
const BAND_ORDER = ["late", "under 5", "5 to 15", "15 to 30", "over 30"];
const BAND_LABEL: Record<string, string> = { late: "Arrived after their time", "under 5": "Under 5 minutes", "5 to 15": "5 to 15 minutes", "15 to 30": "15 to 30 minutes", "over 30": "Over 30 minutes" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const actor = await requireActor(["admin"]);
  const { days: requested } = await searchParams;
  const days = WINDOWS.includes(Number(requested)) ? Number(requested) : 28;
  const breadcrumb = <><span className="breadcrumb-app"><Home /></span><span className="breadcrumb-first">Administration</span><ChevronRight /><span>Report</span></>;
  const [clinic, providers, report] = await Promise.all([
    getClinicSettings(actor).catch(() => null), listCareProviders(actor).catch(() => []), getClinicReport(actor, { days }).catch(() => null),
  ]);
  const shell = (children: React.ReactNode) =>
    <AppShell actor={actor} clinicName={clinic?.name ?? "Your clinic"} current="/admin/reports" breadcrumb={breadcrumb}>{children}</AppShell>;

  if (!report) return shell(<div className="specimen"><div className="state-panel error-example">
    <p className="empty-state-icon"><TriangleAlert /></p><h3>The report could not be read</h3>
    <p>Nothing was changed. Confirm the database is running, then reload this page.</p>
  </div></div>);

  const { totals, providers: utilisation, waits } = report;
  const nameOf = (providerId: string) => providers.find((provider) => provider.id === providerId)?.displayName ?? "A former colleague";
  const arrivals = waits.reduce((sum, band) => sum + band.arrivals, 0);
  return shell(<>
    <div className="section-header">
      <div className="section-heading"><div><span className="eyebrow icon-label"><ChartNoAxesColumn /> Administration</span>
        <h2 style={{ marginTop: 6 }}>Clinic report</h2>
        {/* Counts and minutes, derived from the appointment table and its slots. */}
        <p className="section-description">{report.from} to {report.to}, in {report.timeZone}. Counts and minutes only: nothing here identifies a patient.</p></div></div>
      <div className="topbar-actions">{WINDOWS.map((window) => <Link key={window} className="shortcut-button" data-active={window === days} href={`/admin/reports?days=${window}`}>{window} days</Link>)}</div>
    </div>

    <div className="board-summary" style={{ marginBottom: 20 }}>
      <div><span className="board-count">{totals?.booked ?? 0}</span><span>appointments</span></div>
      <div><span className="board-count">{totals?.seen ?? 0}</span><span>seen</span></div>
      <div><span className="board-count">{percent(totals?.noShows ?? 0, totals?.booked ?? 0)}</span><span>no-show rate</span></div>
      <div><span className="board-count">{percent(totals?.cancelled ?? 0, totals?.booked ?? 0)}</span><span>cancelled</span></div>
      <div><span className="board-count">{minutes(totals?.medianWait ?? null)}</span><span>median wait</span></div>
    </div>

    <div className="chart-columns">
      <section className="specimen">
        <div className="specimen-topline"><strong>How long people waited</strong><span>{arrivals} arrivals</span></div>
        {!arrivals ? <div className="state-panel" style={{ minHeight: 0, padding: 24 }}><p>Nobody has been checked in during this window.</p></div>
          : <ul className="wait-bands">{BAND_ORDER.filter((band) => waits.some((row) => row.band === band)).map((band) => {
            const row = waits.find((candidate) => candidate.band === band)!;
            return <li key={band}>
              <span>{BAND_LABEL[band]}</span>
              <span className="wait-bar" aria-hidden="true"><span style={{ width: `${Math.max(2, Math.round((row.arrivals / arrivals) * 100))}%` }} /></span>
              <span className="numeric">{row.arrivals}</span>
            </li>;
          })}</ul>}
        <div className="queue-footer"><span>Measured from check-in to the appointment time, so a negative wait means they arrived after it.</span></div>
      </section>

      <section className="specimen">
        <div className="specimen-topline"><strong>Provider utilisation</strong><span>offered against taken</span></div>
        {!utilisation.length ? <div className="state-panel" style={{ minHeight: 0, padding: 24 }}><p>No sessions were offered in this window.</p></div>
          : <div className="table-scroll">
            <table className="clinical-table">
              <caption className="sr-only">Utilisation by provider</caption>
              <thead><tr><th scope="col">Clinician</th><th scope="col">Times offered</th><th scope="col">Booked</th><th scope="col">Taken up</th><th scope="col">Seen</th><th scope="col">No-shows</th></tr></thead>
              <tbody>{utilisation.map((row) => <tr key={row.providerId}>
                <td>{nameOf(row.providerId)}</td>
                <td className="numeric">{row.slots} <small>({Math.round(row.offeredMinutes / 60)}h)</small></td>
                <td className="numeric">{row.booked}</td>
                <td className="numeric">{percent(row.booked, row.slots)}</td>
                <td className="numeric">{row.seen}</td>
                <td className="numeric">{row.noShows}</td>
              </tr>)}</tbody>
            </table>
          </div>}
        <div className="queue-footer"><span>Taken up is booked appointments against times offered, counting a cancellation as a time that went unused.</span></div>
      </section>
    </div>
  </>);
}
