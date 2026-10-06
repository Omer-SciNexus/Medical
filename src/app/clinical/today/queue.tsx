"use client";

import * as React from "react";
import { useActionState } from "react";
import { AlertTriangle, CheckCircle2, Inbox, Loader2, ShieldCheck, Stethoscope } from "lucide-react";
import { Badge, Button, Skeleton } from "@/components/ui/primitives";
import { clinicalName, clinicalDate } from "@/lib/format";
import { idleAction } from "@/lib/action-state";
import { advanceAppointmentAction, loadChartAction, startVisitAction, type ChartResult } from "@/app/clinical/actions";

// Age arrives already derived, so the browser never receives a date of birth.
type Entry = {
  id: string; patientId: string; reason: string; status: string; revision: number; waitingMinutes: number | null;
  startsAt: string; givenName: string; surname: string; age: number; sex: string; mrn: string;
};
const tone = (status: string) => status === "ready" ? "accent" : status === "in_progress" ? "high" : status === "done" ? "neutral" : status === "no_show" || status === "cancelled" ? "critical" : "neutral";
const label = (status: string) => status.replace("_", " ");

export function Queue({ entries, day, timeZone }: { entries: Entry[]; day: string; timeZone: string }) {
  const [selectedId, setSelectedId] = React.useState(entries[0]?.id ?? null);
  const [chart, setChart] = React.useState<ChartResult | null>(null);
  const [loadingChart, setLoadingChart] = React.useState(false);
  const rows = React.useRef<Map<string, HTMLTableRowElement | null>>(new Map());
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const [startState, startVisit, startPending] = useActionState(startVisitAction, idleAction);
  const [moveState, moveAppointment, movePending] = useActionState(advanceAppointmentAction, idleAction);

  React.useEffect(() => {
    if (!selected) { setChart(null); return; }
    let active = true;
    setLoadingChart(true);
    loadChartAction(selected.patientId).then((result) => { if (active) { setChart(result); setLoadingChart(false); } });
    return () => { active = false; };
  }, [selected?.patientId, selected]);

  const move = React.useCallback((offset: number) => {
    setSelectedId((current) => {
      const index = entries.findIndex((entry) => entry.id === current);
      const next = entries[Math.min(entries.length - 1, Math.max(0, (index === -1 ? 0 : index) + offset))];
      if (next) rows.current.get(next.id)?.scrollIntoView({ block: "nearest" });
      return next?.id ?? current;
    });
  }, [entries]);
  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "j" || event.key === "ArrowDown") { event.preventDefault(); move(1); }
    if (event.key === "k" || event.key === "ArrowUp") { event.preventDefault(); move(-1); }
  }
  if (!entries.length) return <div className="specimen"><div className="state-panel" style={{ textAlign: "center", padding: "56px 24px" }}>
    <p className="empty-state-icon"><Inbox /></p><h3>No appointments on {day}</h3>
    <p>This clinic day has no booked visits. Choose another day above, or ask the front desk to book one.</p>
  </div></div>;

  return <div className="specimen">
    <div className="clinical-toolbar">
      <div><h3><Stethoscope /> Today&rsquo;s clinic <span className="queue-count">{entries.length}</span></h3>
        <p>{day} &middot; times shown in {timeZone}</p></div>
    </div>
    <div className="clinical-split">
      <div className="queue">
        <div className="table-scroll">
          <table className="clinical-table" onKeyDown={onKeyDown}>
            <caption className="sr-only">Appointments for {day}. Use j and k to move between patients.</caption>
            <thead><tr><th scope="col">Time</th><th scope="col">Patient</th><th scope="col" className="reason-column">Reason</th><th scope="col">Waiting</th><th scope="col">State</th></tr></thead>
            <tbody>{entries.map((entry) => <tr key={entry.id} ref={(node) => { rows.current.set(entry.id, node); }} data-selected={entry.id === selectedId}>
              <td><time className="mono">{new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(entry.startsAt))}</time></td>
              <td><button type="button" className="patient-row-button" aria-current={entry.id === selectedId} onClick={() => setSelectedId(entry.id)}>
                {clinicalName(entry.givenName, entry.surname)}</button></td>
              <td className="reason-column">{entry.reason}</td>
              <td className="numeric">{entry.waitingMinutes === null ? "—" : `${entry.waitingMinutes} min`}</td>
              <td><Badge tone={tone(entry.status)}>{label(entry.status)}</Badge></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="queue-footer">
          <span><kbd>j</kbd> <kbd>k</kbd> move between patients</span>
          <span>Selecting a patient records an audited chart read.</span>
        </div>
      </div>
      <aside className="context-panel" aria-live="polite">
        {!selected ? <p className="muted">Select a patient to see their chart.</p> : <>
          <div className="context-heading"><span className="eyebrow">Patient</span><span className="context-symbol"><ShieldCheck /></span></div>
          <p className="context-name">{clinicalName(selected.givenName, selected.surname)}</p>
          <div className="context-meta"><span>{selected.age}y</span><span>{selected.sex}</span><span className="mono">{selected.mrn}</span></div>
          {loadingChart ? <div style={{ marginTop: 16 }}><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line skeleton-short" /></div>
            : chart?.ok === false ? <p className="field-error" style={{ marginTop: 14 }}>{chart.error}</p>
            : chart?.ok ? <>
              {chart.chart.allergies.length ? chart.chart.allergies.map((allergy) => <div key={allergy.id} className="allergy-strip">
                <AlertTriangle /><span><strong>{allergy.substance}</strong>{allergy.reaction} &middot; {allergy.severity}</span></div>)
                : <p className="context-normal"><CheckCircle2 /> No known allergies recorded</p>}
              {chart.chart.problems.length ? <><span className="eyebrow" style={{ display: "block", marginTop: 14 }}>Active problems</span>
                <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none" }}>{chart.chart.problems.filter((problem) => problem.status === "active").map((problem) =>
                  <li key={problem.id} style={{ fontSize: 11, paddingBlock: 3 }}>{problem.description}</li>)}</ul></> : null}
              <dl className="context-observations">{chart.chart.observations.slice(0, 4).map((observation) => <div key={observation.id} className="context-observation">
                <dt>{observation.label}</dt>
                <dd className={observation.flag === "high" ? "text-high" : observation.flag === "low" ? "text-low" : observation.flag === "critical" ? "text-critical" : undefined}>
                  {observation.value}<small> {observation.unit}</small></dd>
              </div>)}</dl>
              <p className="context-footnote">Last observed {chart.chart.observations[0] ? clinicalDate(chart.chart.observations[0].observedAt, new Date(), timeZone) : "—"}. Synthetic development data.</p>
            </> : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
            {selected.status === "booked" || selected.status === "checked_in" || selected.status === "rooming" ? <form action={moveAppointment}>
              <input type="hidden" name="appointmentId" value={selected.id} /><input type="hidden" name="revision" value={selected.revision} />
              <input type="hidden" name="status" value={selected.status === "booked" ? "checked_in" : selected.status === "checked_in" ? "rooming" : "ready"} />
              <Button type="submit" variant="secondary" size="small" disabled={movePending} style={{ width: "100%" }}>
                {movePending ? <Loader2 /> : null}{selected.status === "booked" ? "Check in" : selected.status === "checked_in" ? "Move to room" : "Mark ready"}</Button>
            </form> : null}
            {selected.status === "ready" || selected.status === "in_progress" ? <form action={startVisit}>
              <input type="hidden" name="appointmentId" value={selected.id} /><input type="hidden" name="revision" value={selected.revision} />
              <Button type="submit" disabled={startPending} style={{ width: "100%" }}>{startPending ? <Loader2 /> : <Stethoscope />}
                {selected.status === "in_progress" ? "Resume visit" : "Start visit"}</Button>
            </form> : null}
            {startState.error ? <p className="field-error" role="alert">{startState.error}</p> : null}
            {moveState.error ? <p className="field-error" role="alert">{moveState.error}</p> : null}
          </div>
        </>}
      </aside>
    </div>
  </div>;
}
