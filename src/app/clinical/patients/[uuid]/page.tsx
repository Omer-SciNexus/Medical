import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronRight, FileText, History, Home, Pill, ShieldAlert } from "lucide-react";
import { AppShell } from "@/components/app/shell";
import { Badge } from "@/components/ui/primitives";
import { getClinicSettings } from "@/modules/identity";
import { getPatientChartView, listPatientDocuments } from "@/modules/clinical";
import { objectStoreConfigured } from "@/platform/objects";
import { clinicalDate, clinicalName } from "@/lib/format";
import { clinicTimezone } from "@/lib/clinic-day";
import { requireActor } from "@/app/session";
import { BreakGlass } from "./break-glass";
import { Attachments } from "./attachments";

export const metadata: Metadata = { title: "Patient chart", robots: { index: false, follow: false } };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const flagClass = (flag: string) => flag === "critical" ? "text-critical" : flag === "high" ? "text-high" : flag === "low" ? "text-low" : undefined;

export default async function PatientChartPage({ params }: { params: Promise<{ uuid: string }> }) {
  const actor = await requireActor(["clinician"]);
  const { uuid } = await params;
  if (!uuidPattern.test(uuid)) notFound();
  const timeZone = (await getClinicSettings(actor).catch(() => null))?.timezone ?? clinicTimezone();
  const [clinic, view] = await Promise.all([getClinicSettings(actor), getPatientChartView(actor, uuid).catch(() => null)]);
  const documents = view ? await listPatientDocuments(actor, uuid).catch(() => []) : [];
  const breadcrumb = <><span className="breadcrumb-app"><Home /></span><Link className="breadcrumb-first" href="/clinical/today">Today</Link><ChevronRight /><span>Chart</span></>;
  const shell = (children: React.ReactNode) =>
    <AppShell actor={actor} clinicName={clinic?.name ?? "Your clinic"} current="/clinical/today" breadcrumb={breadcrumb}>{children}</AppShell>;

  // A denial is the ordinary case for a patient this clinician has no relationship with, and
  // break-glass is the deliberate way through it.
  if (!view) return shell(<>
    <div className="specimen"><div className="state-panel error-example">
      <p className="empty-state-icon"><ShieldAlert /></p><h3>You do not have access to this chart</h3>
      <p>Chart access begins when a patient arrives for an appointment with you. This attempt was recorded, as every denial is.</p>
      <Link className="button button-secondary" href="/clinical/today">Back to today&rsquo;s clinic</Link>
    </div></div>
    <BreakGlass patientId={uuid} />
  </>);

  const { patient, chart, visits, prescriptions } = view;
  const active = chart.problems.filter((problem) => problem.status === "active");
  const resolved = chart.problems.filter((problem) => problem.status === "resolved");
  return shell(<>
    <div className="chart-identity">
      <div>
        <span className="eyebrow">Patient</span>
        <h2 style={{ marginTop: 6 }}>{clinicalName(patient.givenName, patient.surname)}</h2>
        <div className="context-meta" style={{ fontSize: 11 }}><span>{patient.age}y</span><span>{patient.sex}</span><span className="mono">{patient.mrn}</span></div>
      </div>
      <p className="field-hint">Opening this chart was authorized and recorded.</p>
    </div>

    {chart.allergies.length ? <div className="allergy-strip" role="note">
      <AlertTriangle /><span><strong>Allergies</strong>{chart.allergies.map((allergy) => `${allergy.substance} — ${allergy.reaction} (${allergy.severity})`).join(" · ")}</span>
    </div> : <p className="context-normal"><CheckCircle2 /> No known allergies recorded</p>}

    <div className="chart-columns">
      <section className="specimen">
        <div className="specimen-topline"><strong>Active problems</strong><span>{active.length}</span></div>
        {active.length ? <ul className="chart-list">{active.map((problem) => <li key={problem.id}>{problem.description}</li>)}</ul>
          : <div className="state-panel" style={{ minHeight: 0, padding: "24px" }}><p>Nothing active on this chart.</p></div>}
        {resolved.length ? <div className="queue-footer"><span>{resolved.length} resolved: {resolved.map((problem) => problem.description).join(", ")}</span></div> : null}
      </section>

      <section className="specimen">
        <div className="specimen-topline"><strong>Observations</strong><span>most recent first</span></div>
        {chart.observations.length ? <div className="table-scroll">
          <table className="clinical-table">
            <caption className="sr-only">Observation timeline with reference ranges</caption>
            <thead><tr><th scope="col">When</th><th scope="col">Measurement</th><th scope="col">Value</th><th scope="col">Reference</th></tr></thead>
            <tbody>{chart.observations.map((observation) => <tr key={observation.id}>
              <td><time className="mono">{clinicalDate(observation.observedAt, new Date(), timeZone)}</time></td>
              <td>{observation.label}</td>
              <td className={`numeric ${flagClass(observation.flag) ?? ""}`}>{observation.value} <small>{observation.unit}</small></td>
              <td className="mono">{observation.referenceLow && observation.referenceHigh ? `${observation.referenceLow}–${observation.referenceHigh}` : "—"}</td>
            </tr>)}</tbody>
          </table>
        </div> : <div className="state-panel" style={{ minHeight: 0, padding: "24px" }}><p>Nothing measured yet.</p></div>}
      </section>
    </div>

    <section className="specimen" style={{ marginTop: 20 }}>
      <div className="specimen-topline"><strong>Prescriptions</strong><span>{prescriptions.filter((prescription) => prescription.status === "issued").length} issued</span></div>
      {prescriptions.length ? <div className="table-scroll">
        <table className="clinical-table">
          <caption className="sr-only">Prescriptions for this patient</caption>
          <thead><tr><th scope="col">When</th><th scope="col">Medicine</th><th scope="col">Course</th><th scope="col">Safety</th><th scope="col">State</th></tr></thead>
          <tbody>{prescriptions.map((prescription) => <tr key={prescription.id}>
            <td><time className="mono">{clinicalDate(prescription.createdAt, new Date(), timeZone)}</time></td>
            <td>{prescription.name} {prescription.strength}</td>
            <td>{prescription.dose} {prescription.unit} · {prescription.frequency} · {prescription.durationDays}d</td>
            <td className="mono">{prescription.safetyStatus}</td>
            <td><Badge tone={prescription.status === "issued" ? "accent" : "neutral"}>{prescription.status}</Badge></td>
          </tr>)}</tbody>
        </table>
      </div> : <div className="state-panel" style={{ minHeight: 0, padding: "24px" }}><p><Pill /> Nothing prescribed for this patient.</p></div>}
    </section>

    <Attachments
      patientId={patient.id}
      configured={objectStoreConfigured()}
      timeZone={timeZone}
      documents={documents.map((document) => ({ id: document.id, kind: document.kind, filename: document.filename,
        contentType: document.contentType, byteSize: document.byteSize, createdAt: document.createdAt.toISOString() }))}
    />

    <section className="specimen" style={{ marginTop: 20 }}>
      <div className="specimen-topline"><strong>Prior visits</strong><span>{visits.length}</span></div>
      {visits.length ? <ol className="visit-history">{visits.map((visit) => <li key={visit.id}>
        <div className="visit-history-head">
          <div><strong>{clinicalDate(visit.createdAt, new Date(), timeZone)}</strong>
            <Badge tone={visit.status === "completed" ? "neutral" : "accent"} className="grant-flag">{visit.status === "completed" ? "completed" : visit.status}</Badge></div>
          <Link className="button button-ghost button-small" href={`/clinical/encounters/${visit.id}`}><FileText />Open</Link>
        </div>
        {visit.notes.length ? <ol className="note-versions">{visit.notes.map((note) => <li key={note.id}>
          <div><span className="eyebrow">Version {note.version}</span> <Badge tone={note.status === "draft" ? "accent" : "neutral"}>{note.status}</Badge>
            {note.signedAt ? <span className="field-hint"> signed {clinicalDate(note.signedAt, new Date(), timeZone)}</span> : <span className="field-hint"> not signed</span>}</div>
          {note.amendmentReason ? <p className="field-hint"><History /> Amended: {note.amendmentReason}</p> : null}
          <pre className="note-previous">{note.content}</pre>
        </li>)}</ol> : <p className="field-hint">No note on this visit.</p>}
        {visit.summary ? <p className="field-hint">Patient summary: {visit.summary}</p> : null}
      </li>)}</ol> : <div className="state-panel" style={{ minHeight: 0, padding: "24px" }}><p>No visits recorded yet.</p></div>}
      <div className="queue-footer"><span>Signed text is kept in full. An amendment adds a version and never rewrites one.</span></div>
    </section>
  </>);
}
