import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Eye, Home, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/app/shell";
import { Badge } from "@/components/ui/primitives";
import { getClinicSettings, getMyRecordAccess } from "@/modules/identity";
import { clinicTimezone } from "@/lib/clinic-day";
import { requireActor } from "@/app/session";

export const metadata: Metadata = { title: "Who viewed my record", robots: { index: false, follow: false } };

export default async function RecordAccessPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const actor = await requireActor(["patient"]);
  const { before: requested } = await searchParams;
  const before = /^\d{1,18}$/.test(requested ?? "") ? Number(requested) : undefined;
  const clinic = await getClinicSettings(actor).catch(() => null);
  const timeZone = clinic?.timezone ?? clinicTimezone();
  const breadcrumb = <><span className="breadcrumb-app"><Home /></span><span className="breadcrumb-first">Your care</span><ChevronRight /><span>Record access</span></>;
  const shell = (children: React.ReactNode) =>
    <AppShell actor={actor} clinicName={clinic?.name ?? "Your clinic"} current="/patient/access" breadcrumb={breadcrumb} register="patient">{children}</AppShell>;

  const history = await getMyRecordAccess(actor, { before }).catch(() => null);
  if (!history) return shell(<div className="specimen"><div className="state-panel error-example">
    <p className="empty-state-icon"><TriangleAlert /></p><h3>This history could not be loaded</h3>
    <p>Nothing was changed. Please try again shortly.</p>
  </div></div>);

  const day = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "long", year: "numeric" });
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const { entries, olderThan } = history;
  const people = new Set(entries.map((entry) => `${entry.person}:${entry.role}`)).size;
  const emergencies = entries.filter((entry) => entry.kind === "emergency").length;
  const refusals = entries.filter((entry) => entry.kind === "refused").length;

  return shell(<>
    <div className="patient-welcome">
      <span className="patient-welcome-label"><span className="patient-welcome-line" /> Your care</span>
      <h1>Who viewed your record.</h1>
      <p>Every time someone at {clinic?.name ?? "your clinic"} opens or changes your record, it is written to a log that cannot be edited. This is that log, in plain words.</p>
    </div>

    <div className="board-summary" style={{ marginBottom: 20 }}>
      <div><span className="board-count">{people}</span><span>{people === 1 ? "person" : "people"}</span></div>
      <div><span className="board-count">{emergencies}</span><span>emergency {emergencies === 1 ? "access" : "accesses"}</span></div>
      <div><span className="board-count">{refusals}</span><span>refused {refusals === 1 ? "attempt" : "attempts"}</span></div>
    </div>

    {!entries.length ? <p className="booking-empty"><ShieldCheck /> {before ? "There is nothing older than this." : "Nobody at the clinic has opened your record yet."}</p>
      : <ul className="appointment-list">{entries.map((entry) => <li key={entry.id} className="access-entry" data-kind={entry.kind}>
        <div className="appointment-head">
          <div>
            <strong>{entry.person}</strong>
            <p className="appointment-meta">{entry.role} · {day.format(entry.lastAt)} · {time.format(entry.firstAt)}{time.format(entry.firstAt) === time.format(entry.lastAt) ? "" : `–${time.format(entry.lastAt)}`}</p>
          </div>
          {entry.kind === "emergency" ? <Badge tone="critical"><ShieldAlert /> Emergency access</Badge> : entry.kind === "refused" ? <Badge tone="high">Refused</Badge> : <Badge><Eye /> {entry.reasons.join(", ")}</Badge>}
        </div>
        <ul className="access-activities">{entry.activities.map((activity) => <li key={activity}>{activity}</li>)}</ul>
        {entry.note ? <p className="appointment-prep">Reason they gave: &ldquo;{entry.note}&rdquo;</p> : null}
      </li>)}</ul>}

    {olderThan ? <p style={{ marginTop: 18 }}><Link className="button button-secondary button-small" href={`/patient/access?before=${olderThan}`}>Show older</Link></p> : null}
    {before ? <p className="account-preview-note" style={{ marginTop: 12 }}><Link href="/patient/access">Back to the most recent</Link></p> : null}
    <p className="context-footnote" style={{ marginTop: 20 }}>Screens that list many patients at once, such as a day&rsquo;s queue or a patient search, are recorded for the clinic but are not shown here. If something here looks wrong, contact the clinic and ask to speak to its administrator.</p>
  </>);
}
