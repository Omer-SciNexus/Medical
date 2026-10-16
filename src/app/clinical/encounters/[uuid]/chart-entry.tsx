"use client";

import * as React from "react";
import { useActionState } from "react";
import { Activity, AlertTriangle, Check, CircleDot, Loader2, Plus, Stethoscope } from "lucide-react";
import { Badge, Button, Field, Input } from "@/components/ui/primitives";
import { idleAction } from "@/lib/action-state";
import { addProblemAction, changeProblemStatusAction, recordAllergyAction, recordVitalsAction } from "@/app/clinical/actions";

type Vital = { key: string; label: string; unit: string; low: number | null; high: number | null; min: number; max: number; step: number };
type Problem = { id: string; description: string; status: string };
type Observation = { id: string; label: string; value: string; unit: string; flag: string; referenceLow: string | null; referenceHigh: string | null; observedAt: string };

const flagClass = (flag: string) => flag === "critical" ? "text-critical" : flag === "high" ? "text-high" : flag === "low" ? "text-low" : undefined;
const range = (vital: Vital) => vital.low !== null && vital.high !== null ? `${vital.low}–${vital.high} ${vital.unit}` : vital.unit;

export function ChartEntry({ encounterId, vitals, problems, observations, allergyCount, open }: {
  encounterId: string; vitals: Vital[]; problems: Problem[]; observations: Observation[]; allergyCount: number; open: boolean;
}) {
  const [vitalsState, saveVitals, vitalsPending] = useActionState(recordVitalsAction, idleAction);
  const [problemState, addProblem, problemPending] = useActionState(addProblemAction, idleAction);
  const [statusState, changeStatus, statusPending] = useActionState(changeProblemStatusAction, idleAction);
  const [allergyState, addAllergy, allergyPending] = useActionState(recordAllergyAction, idleAction);
  const [showAllergy, setShowAllergy] = React.useState(false);
  const error = [vitalsState, problemState, statusState, allergyState].find((state) => state.error)?.error;
  const pending = vitalsPending || problemPending || statusPending || allergyPending;
  const active = problems.filter((problem) => problem.status === "active");
  const resolved = problems.filter((problem) => problem.status === "resolved");
  // The latest reading per measurement, which is what the bedside actually wants to see.
  const latest = observations.filter((observation, index) => observations.findIndex((candidate) => candidate.label === observation.label) === index);

  if (!open) return <section className="chart-entry">
    <h3><Stethoscope /> Chart</h3>
    <p className="context-footnote">This visit is complete, so its chart is read-only here. Amend the note to correct the record.</p>
  </section>;

  return <section className="chart-entry">
    <h3><Stethoscope /> Record at the bedside</h3>
    {error ? <p className="field-error" role="alert">{error}</p> : null}

    <form action={saveVitals} aria-busy={vitalsPending}>
      <input type="hidden" name="encounterId" value={encounterId} />
      <div className="vitals-grid">
        {vitals.map((vital) => <Field key={vital.key} label={vital.label} id={`vital.${vital.key}`} hint={range(vital)}>
          <Input id={`vital.${vital.key}`} name={`vital.${vital.key}`} type="number" inputMode="decimal"
            min={vital.min} max={vital.max} step={vital.step} placeholder="—" className="mono" />
        </Field>)}
      </div>
      <div className="row-actions" style={{ marginTop: 12 }}>
        <Button type="submit" size="small" disabled={pending}>{vitalsPending ? <Loader2 /> : <Activity />}Save measurements</Button>
        {vitalsState.notice ? <span className="field-hint" role="status">{vitalsState.notice}</span> : <span className="field-hint">Leave a field empty to skip it. Each reading is stored with the range it was read against.</span>}
      </div>
    </form>

    {latest.length ? <div className="table-scroll" style={{ marginTop: 16 }}>
      <table className="clinical-table">
        <caption className="sr-only">Most recent reading for each measurement</caption>
        <thead><tr><th scope="col">Measurement</th><th scope="col">Value</th><th scope="col">Reference</th><th scope="col">Flag</th></tr></thead>
        <tbody>{latest.map((observation) => <tr key={observation.id}>
          <td>{observation.label}</td>
          <td className={`numeric ${flagClass(observation.flag) ?? ""}`}>{observation.value} <small>{observation.unit}</small></td>
          <td className="mono">{observation.referenceLow && observation.referenceHigh ? `${observation.referenceLow}–${observation.referenceHigh}` : "—"}</td>
          <td>{observation.flag === "normal" ? <Badge tone="neutral">normal</Badge> : <Badge tone={observation.flag === "critical" ? "critical" : "high"}>{observation.flag}</Badge>}</td>
        </tr>)}</tbody>
      </table>
    </div> : null}

    <h4 className="chart-entry-heading"><CircleDot /> Problems</h4>
    {active.length ? <ul className="problem-list">{active.map((problem) => <li key={problem.id}>
      <span>{problem.description}</span>
      <form action={changeStatus}><input type="hidden" name="encounterId" value={encounterId} /><input type="hidden" name="problemId" value={problem.id} /><input type="hidden" name="status" value="resolved" />
        <Button type="submit" size="small" variant="ghost" disabled={pending}><Check />Resolve</Button></form>
    </li>)}</ul> : <p className="field-hint">No active problems on this chart.</p>}
    {resolved.length ? <p className="field-hint">{resolved.length} resolved: {resolved.map((problem) => problem.description).join(", ")}</p> : null}
    <form action={addProblem} className="inline-form" aria-busy={problemPending}>
      <input type="hidden" name="encounterId" value={encounterId} />
      <Input name="description" defaultValue={problemState.values?.description} placeholder="Add a problem, such as Essential hypertension" maxLength={200} required aria-label="New problem" />
      <Button type="submit" size="small" variant="secondary" disabled={pending}>{problemPending ? <Loader2 /> : <Plus />}Add</Button>
    </form>

    <h4 className="chart-entry-heading"><AlertTriangle /> Allergies</h4>
    <p className="field-hint">{allergyCount ? `${allergyCount} recorded, shown at the top of this visit.` : "Nothing recorded. An allergy added here appears on every future chart read."}</p>
    {showAllergy ? <form action={addAllergy} className="allergy-form" aria-busy={allergyPending}>
      <input type="hidden" name="encounterId" value={encounterId} />
      <Field label="Substance" id="substance"><Input id="substance" name="substance" defaultValue={allergyState.values?.substance} placeholder="Penicillin" maxLength={120} required /></Field>
      <Field label="Reaction" id="reaction"><Input id="reaction" name="reaction" defaultValue={allergyState.values?.reaction} placeholder="Urticaria" maxLength={200} required /></Field>
      <Field label="Severity" id="severity">
        <select id="severity" name="severity" className="input" defaultValue={allergyState.values?.severity ?? "moderate"}>
          <option value="mild">Mild</option><option value="moderate">Moderate</option><option value="severe">Severe</option>
        </select></Field>
      <div className="row-actions">
        <Button type="submit" size="small" disabled={pending}>{allergyPending ? <Loader2 /> : <AlertTriangle />}Record allergy</Button>
        <Button type="button" size="small" variant="ghost" onClick={() => setShowAllergy(false)}>Cancel</Button>
      </div>
    </form> : <Button type="button" size="small" variant="secondary" onClick={() => setShowAllergy(true)}><Plus />Record an allergy</Button>}
  </section>;
}
