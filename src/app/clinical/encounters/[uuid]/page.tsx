import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronRight, History, Home, Pill, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/app/shell";
import { Badge } from "@/components/ui/primitives";
import { getClinicSettings } from "@/modules/identity";
import { assistConfigured, CONSULTATION_FEE_MINOR, VITALS, getEncounterWorkspace } from "@/modules/clinical";
import { clinicalDate, clinicalName } from "@/lib/format";
import { clinicTimezone } from "@/lib/clinic-day";
import { requireActor } from "@/app/session";
import { NoteEditor } from "./note-editor";
import { ChartEntry } from "./chart-entry";

export const metadata: Metadata = { title: "Visit encounter", robots: { index: false, follow: false } };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EncounterPage({ params }: { params: Promise<{ uuid: string }> }) {
  const actor = await requireActor(["clinician"]);
  const { uuid } = await params;
  if (!uuidPattern.test(uuid)) notFound();
  const timeZone = clinicTimezone();
  const [clinic, workspace] = await Promise.all([getClinicSettings(actor), getEncounterWorkspace(actor, uuid).catch(() => null)]);
  const breadcrumb = <><span className="breadcrumb-app"><Home /></span><Link className="breadcrumb-first" href="/clinical/today">Today</Link><ChevronRight /><span>Encounter</span></>;
  if (!workspace) return <AppShell actor={actor} clinicName={clinic?.name ?? "Your clinic"} current="/clinical/today" breadcrumb={breadcrumb}>
    <div className="specimen"><div className="state-panel error-example">
      <p className="empty-state-icon"><TriangleAlert /></p><h3>This visit is not available to you</h3>
      <p>It may not exist, may belong to another clinic, or you may not have a care relationship with this patient. The attempt was recorded.</p>
      <Link className="button button-secondary" href="/clinical/today">Back to today&rsquo;s clinic</Link>
    </div></div>
  </AppShell>;

  const { encounter, patient, chart, note, history, charge } = workspace;
  const activeProblems = chart.problems.filter((problem) => problem.status === "active");
  return <AppShell actor={actor} clinicName={clinic?.name ?? "Your clinic"} current="/clinical/today" breadcrumb={breadcrumb}>
    <div className="encounter-grid">
      <div>
        <div className="section-header">
          <div><span className="eyebrow">Encounter</span>
            <h2 style={{ marginTop: 6 }}>{clinicalName(patient.givenName, patient.surname)}</h2>
            <div className="context-meta" style={{ fontSize: 11 }}><span>{patient.age}y</span><span>{patient.sex}</span><span className="mono">{patient.mrn}</span>
              <Badge tone={encounter.status === "completed" ? "neutral" : "accent"}>{encounter.status === "completed" ? "completed" : "in progress"}</Badge></div></div>
        </div>
        {chart.allergies.length ? <div className="allergy-strip" role="note">
          <AlertTriangle /><span><strong>Allergies</strong>{chart.allergies.map((allergy) => `${allergy.substance} — ${allergy.reaction} (${allergy.severity})`).join(" · ")}</span>
        </div> : <p className="context-normal"><CheckCircle2 /> No known allergies recorded</p>}

        <NoteEditor
          note={{ ...note, signedAt: note.signedAt ? note.signedAt.toISOString() : null }}
          encounter={{ id: encounter.id, status: encounter.status, summary: encounter.summary, publishedAt: encounter.publishedAt ? encounter.publishedAt.toISOString() : null }}
          charge={charge ? { amountMinor: charge.amountMinor, currency: charge.currency } : null}
          fee={{ amountMinor: CONSULTATION_FEE_MINOR, currency: clinic?.currency ?? "TRY" }}
          aiEnabled={assistConfigured()}
        />

        {encounter.status === "in_progress" ? <p className="row-actions" style={{ marginTop: 18 }}>
          <Link className="button button-secondary button-small" href={`/clinical/encounters/${encounter.id}/prescribe`}><Pill />Prescribe</Link>
        </p> : null}

        <ChartEntry
          encounterId={encounter.id}
          open={encounter.status === "in_progress"}
          allergyCount={chart.allergies.length}
          vitals={VITALS.map((vital) => ({ key: vital.key, label: vital.label, unit: vital.unit, low: vital.low, high: vital.high, min: vital.min, max: vital.max, step: vital.step }))}
          problems={chart.problems}
          observations={chart.observations.map((observation) => ({ ...observation, observedAt: observation.observedAt.toISOString() }))}
        />

        {history.length > 1 ? <section className="note-history">
          <h3><History /> Version history</h3>
          <ol>{history.map((version) => <li key={version.id}>
            <div><strong>Version {version.version}</strong> <Badge tone={version.status === "draft" ? "accent" : "neutral"}>{version.status}</Badge></div>
            {version.signedAt ? <p className="muted">Signed {clinicalDate(version.signedAt, new Date(), timeZone)}</p> : <p className="muted">Not signed</p>}
            {version.amendmentReason ? <p className="muted">Amendment reason: {version.amendmentReason}</p> : null}
            <pre className="note-previous">{version.content}</pre>
          </li>)}</ol>
          <p className="context-footnote">Signed text is retained in full. An amendment adds a version; it never rewrites one.</p>
        </section> : null}
      </div>
      <aside className="encounter-aside">
        <div className="context-heading"><span className="eyebrow">Chart</span></div>
        {activeProblems.length ? <><span className="eyebrow" style={{ display: "block", marginTop: 14 }}>Active problems</span>
          <ul className="plain-list">{activeProblems.map((problem) => <li key={problem.id}>{problem.description}</li>)}</ul></>
          : <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>No active problems recorded.</p>}
        <dl className="context-observations">{chart.observations.slice(0, 6).map((observation) => <div key={observation.id} className="context-observation">
          <dt>{observation.label}</dt>
          <dd className={observation.flag === "high" ? "text-high" : observation.flag === "low" ? "text-low" : observation.flag === "critical" ? "text-critical" : undefined}>
            {observation.value}<small> {observation.unit}</small></dd>
        </div>)}</dl>
        <p className="context-footnote">Synthetic development data. Reading this chart was authorized and recorded.</p>
      </aside>
    </div>
  </AppShell>;
}
