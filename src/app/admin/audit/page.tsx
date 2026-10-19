import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Download, Home, Inbox, Link2, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/app/shell";
import { Badge, Button, Field, Input } from "@/components/ui/primitives";
import { getClinicSettings, readAuditLog } from "@/modules/identity";
import { clinicalDate } from "@/lib/format";
import { clinicTimezone } from "@/lib/clinic-day";
import { requireActor } from "@/app/session";

export const metadata: Metadata = { title: "Access log", robots: { index: false, follow: false } };
type Filters = { actorId?: string; patientId?: string; action?: string; from?: string; to?: string; before?: string };
const outcomeTone = (outcome: string) => outcome === "denied" ? "critical" : outcome === "emergency" ? "high" : "neutral";

export default async function AuditPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const actor = await requireActor(["admin"]);
  const filters = await searchParams;
  const timeZone = (await getClinicSettings(actor).catch(() => null))?.timezone ?? clinicTimezone();
  const clinic = await getClinicSettings(actor).catch(() => null);
  const breadcrumb = <><span className="breadcrumb-app"><Home /></span><span className="breadcrumb-first">Administration</span><ChevronRight /><span>Access log</span></>;
  const shell = (children: React.ReactNode) =>
    <AppShell actor={actor} clinicName={clinic?.name ?? "Your clinic"} current="/admin/audit" breadcrumb={breadcrumb}>{children}</AppShell>;

  // Blank filter fields are dropped so an empty form means "no filter", not "match empty".
  const query = Object.fromEntries(Object.entries(filters).filter(([, value]) => typeof value === "string" && value.trim() !== ""));
  const result = await readAuditLog(actor, { ...query, limit: 50 }).catch(() => null);
  if (!result) return shell(<div className="specimen"><div className="state-panel error-example">
    <p className="empty-state-icon"><TriangleAlert /></p><h3>The access log could not be read</h3>
    <p>Confirm the auditor database credential is configured. A failed attempt to read this log is itself recorded.</p>
  </div></div>);

  const { events, integrity, outcomes } = result;
  const last = events.at(-1);
  const exportHref = `/admin/audit/export?${new URLSearchParams(query)}`;
  return shell(<>
    <div className="section-header">
      <div className="section-heading"><div><span className="eyebrow icon-label"><ShieldCheck /> Administration</span>
        <h2 style={{ marginTop: 6 }}>Access log</h2>
        <p className="section-description">Every patient read, write, denial and emergency access. Administration grants no chart access, and opening this log is itself recorded.</p></div></div>
    </div>

    <div className={integrity.brokenSeq === null ? "integrity-banner" : "integrity-banner integrity-broken"} role="status">
      {integrity.brokenSeq === null ? <ShieldCheck /> : <ShieldAlert />}
      <div><strong>{integrity.brokenSeq === null
        ? `Chain verified across ${integrity.checked} ${integrity.checked === 1 ? "event" : "events"} since the last checkpoint`
        : `Chain broken at event ${integrity.brokenSeq}`}</strong>
        <p>{integrity.brokenSeq === null
          ? "Each entry carries a hash of the entry before it, so an altered or removed row breaks every hash after it. This check starts from the last position the chain was known good at, which is why it is cheap enough to run on a page view."
          : "An entry does not match the hash of its predecessor. Treat the log as altered from this point forward and investigate the database directly."}</p>
        <p>{integrity.lastFullPassAt
          ? `The whole chain was last walked ${clinicalDate(integrity.lastFullPassAt, new Date(), timeZone)}, across ${integrity.lastFullPassChecked} events. A full pass is what can see an alteration made before a checkpoint, and the worker runs one on a schedule.`
          : "The whole chain has not been walked yet on this deployment. Until a full pass runs, this check can only speak for what has arrived since the first checkpoint."}</p></div>
    </div>

    {outcomes.length ? <div className="specimen" style={{ marginBottom: 20 }}>
      <div className="specimen-topline"><strong>Refusals and emergency access, last 30 days</strong><span>by whoever did it</span></div>
      <div className="table-scroll">
        <table className="clinical-table">
          <caption className="sr-only">Denied and emergency events grouped by actor</caption>
          <thead><tr><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Outcome</th><th scope="col">Events</th><th scope="col">Most recent</th></tr></thead>
          <tbody>{outcomes.map((row) => <tr key={`${row.actorId}:${row.action}:${row.outcome}`}>
            <td className="mono">{row.actorId?.slice(0, 8) ?? "system"}</td>
            <td className="mono">{row.action}</td>
            <td><Badge tone={outcomeTone(row.outcome)}>{row.outcome}</Badge></td>
            <td className="numeric">{row.events}</td>
            <td><time className="mono">{clinicalDate(row.latest, new Date(), timeZone)}</time></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="queue-footer"><span>A run of refusals against one actor is worth asking about; emergency access always is.</span></div>
    </div> : null}

    <form className="audit-filters" method="get">
      <Field label="Actor ID" id="actorId"><Input id="actorId" name="actorId" defaultValue={filters.actorId} placeholder="uuid" className="mono" /></Field>
      <Field label="Patient ID" id="patientId" hint="Identifiers only; patient names are never filter values."><Input id="patientId" name="patientId" defaultValue={filters.patientId} placeholder="uuid" className="mono" /></Field>
      <Field label="Action" id="action"><Input id="action" name="action" defaultValue={filters.action} placeholder="clinical.note_signed" className="mono" /></Field>
      <Field label="From" id="from"><Input id="from" name="from" type="date" defaultValue={filters.from} /></Field>
      <Field label="To" id="to"><Input id="to" name="to" type="date" defaultValue={filters.to} /></Field>
      <div className="audit-filter-actions"><Button type="submit">Apply filters</Button><Link className="button button-ghost" href="/admin/audit">Clear</Link></div>
    </form>

    {!events.length ? <div className="specimen"><div className="state-panel" style={{ textAlign: "center", padding: "48px 24px" }}>
      <p className="empty-state-icon"><Inbox /></p><h3>No events match these filters</h3><p>Widen the date range or clear the filters.</p>
    </div></div> : <>
      <div className="specimen"><div className="table-scroll">
        <table className="clinical-table audit-table">
          <caption className="sr-only">Audit events, newest first</caption>
          <thead><tr><th scope="col">Seq</th><th scope="col">When</th><th scope="col">Action</th><th scope="col">Outcome</th><th scope="col">Actor</th><th scope="col">Patient</th><th scope="col">Chain</th></tr></thead>
          <tbody>{events.map((event) => <tr key={event.id}>
            <td className="numeric">{event.seq}</td>
            <td><time className="mono">{clinicalDate(event.createdAt, new Date(), timeZone)}</time></td>
            <td className="mono">{event.action}</td>
            <td><Badge tone={outcomeTone(event.outcome)}>{event.outcome}</Badge></td>
            <td className="mono">{event.actorId?.slice(0, 8) ?? "—"}</td>
            <td className="mono">{event.patientId?.slice(0, 8) ?? "—"}</td>
            <td className="mono" title={event.hash ?? undefined}><Link2 /> {event.hash?.slice(0, 10) ?? "—"}</td>
          </tr>)}</tbody>
        </table>
      </div></div>
      <div className="queue-footer" style={{ margin: 0 }}>
        <span>{events.length} events shown, newest first. Reasons are recorded but not displayed in this table.</span>
        <span className="row-actions">
          <a className="button button-ghost button-small" href={exportHref}><Download />Export CSV</a>
          {last ? <Link className="button button-secondary button-small" href={`/admin/audit?${new URLSearchParams({ ...query, before: String(last.seq) })}`}>Older events</Link> : null}
        </span>
      </div>
    </>}
  </>);
}
