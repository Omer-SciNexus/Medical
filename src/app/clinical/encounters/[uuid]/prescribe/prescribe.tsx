"use client";

import * as React from "react";
import { useActionState } from "react";
import { AlertTriangle, Ban, Check, FlaskConical, Loader2, Pill, Search, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { Badge, Button, Field, Input, Textarea } from "@/components/ui/primitives";
import { idleAction } from "@/lib/action-state";
import { cancelPrescriptionAction, checkPrescriptionAction, draftPrescriptionAction, issuePrescriptionAction, searchMedicationsAction, type MedicationResult } from "@/app/clinical/actions";

type Medication = { id: string; name: string; ingredient: string; strength: string; form: string; source: string };
type Prescription = {
  id: string; name: string; strength: string; form: string; dose: string; unit: string; route: string; frequency: string; durationDays: number;
  status: string; safetyStatus: string; safetySource: string | null; safetyFindings: string[]; overrideReason: string | null; issuedAt: string | null;
};
const UNITS = ["mg", "micrograms", "g", "mL", "tablet", "capsule", "puff", "unit"];
const ROUTES = ["oral", "topical", "inhaled", "intramuscular", "intravenous", "subcutaneous", "rectal"];
const FREQUENCIES = ["once daily", "twice daily", "three times daily", "four times daily", "every 4 hours", "every 6 hours", "weekly", "as needed"];
const safetyTone = { clear: "accent", warning: "high", blocked: "critical", unavailable: "critical", unchecked: "neutral" } as const;
const SafetyIcon = ({ status }: { status: string }) => status === "clear" ? <ShieldCheck /> : status === "blocked" ? <Ban /> : status === "unchecked" ? <FlaskConical /> : <ShieldAlert />;

export function Prescribe({ encounterId, open, provider, allergies, prescriptions }: {
  encounterId: string; open: boolean; provider: { name: string; fixture: boolean };
  allergies: { id: string; substance: string; reaction: string; severity: string }[]; prescriptions: Prescription[];
}) {
  const [term, setTerm] = React.useState("");
  const [result, setResult] = React.useState<MedicationResult | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [chosen, setChosen] = React.useState<Medication | null>(null);
  const [overriding, setOverriding] = React.useState<string | null>(null);
  const [draftState, draft, draftPending] = useActionState(draftPrescriptionAction, idleAction);
  const [checkState, check, checkPending] = useActionState(checkPrescriptionAction, idleAction);
  const [issueState, issue, issuePending] = useActionState(issuePrescriptionAction, idleAction);
  const [cancelState, cancel, cancelPending] = useActionState(cancelPrescriptionAction, idleAction);
  const error = [draftState, checkState, issueState, cancelState].find((state) => state.error)?.error;
  const pending = draftPending || checkPending || issuePending || cancelPending;
  React.useEffect(() => { if (draftState.ok) { setChosen(null); setTerm(""); setResult(null); } }, [draftState]);

  async function runSearch(event: React.FormEvent) {
    event.preventDefault();
    if (term.trim().length < 2) return;
    setSearching(true);
    setResult(await searchMedicationsAction(term));
    setSearching(false);
  }

  return <>
    <div className={provider.fixture ? "integrity-banner integrity-broken" : "integrity-banner"} role="note">
      {provider.fixture ? <FlaskConical /> : <ShieldCheck />}
      <div><strong>{provider.fixture ? "Safety checks here come from a synthetic fixture" : `Safety checks come from ${provider.name}`}</strong>
        <p>{provider.fixture
          ? "It reasons only over this patient's own chart and calls itself synthetic-fixture, which the database refuses to accept behind an issued prescription. So a prescription can be drafted and checked in this build, and cannot be issued until a real safety service is configured."
          : "A cleared check can be issued. A warning needs a written justification and a fresh authenticator check; a hard stop cannot be issued at all."}</p></div>
    </div>
    {allergies.length ? <div className="allergy-strip" role="note">
      <AlertTriangle /><span><strong>Allergies</strong>{allergies.map((allergy) => `${allergy.substance} — ${allergy.reaction} (${allergy.severity})`).join(" · ")}</span>
    </div> : null}
    {error ? <p className="field-error" role="alert" style={{ marginBottom: 14 }}>{error}</p> : null}

    {open ? <>
      <form onSubmit={runSearch} className="admin-form" style={{ gridTemplateColumns: "minmax(0, 2fr) auto" }}>
        <Field label="Find a medicine" id="term" hint="Name or ingredient. The catalogue is this clinic's own list.">
          <Input id="term" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Amoxicillin" maxLength={80} /></Field>
        <div><Button type="submit" variant="secondary" disabled={searching || term.trim().length < 2}>{searching ? <Loader2 /> : <Search />}Search</Button></div>
      </form>
      {result?.ok === false ? <p className="field-error" role="alert">{result.error}</p> : null}
      {result?.ok && !chosen ? <div className="specimen" style={{ marginBottom: 18 }}>
        <div className="specimen-topline"><strong>Catalogue</strong><span>{result.medications.length} found</span></div>
        {!result.medications.length ? <div className="state-panel" style={{ textAlign: "center", minHeight: 0, padding: "28px 24px" }}>
          <h3>Nothing matched</h3><p>Check the spelling, or ask an administrator to add it to the catalogue.</p></div>
          : <ul className="medication-list">{result.medications.map((medication) => <li key={medication.id}>
            <span><strong>{medication.name}</strong> {medication.strength} · {medication.form}
              {medication.source === "synthetic-fixture" ? <Badge tone="neutral" className="grant-flag">fixture catalogue</Badge> : null}</span>
            <Button type="button" size="small" variant="secondary" onClick={() => setChosen(medication)}>Choose</Button>
          </li>)}</ul>}
      </div> : null}

      {chosen ? <form action={draft} className="admin-form schedule-form" aria-busy={draftPending}>
        <input type="hidden" name="encounterId" value={encounterId} />
        <input type="hidden" name="medicationId" value={chosen.id} />
        <Field label="Medicine" id="medicine"><Input id="medicine" value={`${chosen.name} ${chosen.strength}`} readOnly /></Field>
        <Field label="Dose" id="dose" error={draftState.errors?.dose?.[0]}>
          <Input id="dose" name="dose" type="number" step="0.001" min="0.001" max="10000" defaultValue={draftState.values?.dose} required className="mono" /></Field>
        <Field label="Unit" id="unit" error={draftState.errors?.unit?.[0]}>
          <select id="unit" name="unit" className="input" defaultValue={draftState.values?.unit ?? (chosen.form === "tablet" || chosen.form === "capsule" ? "mg" : "mg")}>
            {UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></Field>
        <Field label="Route" id="route" error={draftState.errors?.route?.[0]}>
          <select id="route" name="route" className="input" defaultValue={draftState.values?.route ?? "oral"}>
            {ROUTES.map((route) => <option key={route} value={route}>{route}</option>)}</select></Field>
        <Field label="Frequency" id="frequency" error={draftState.errors?.frequency?.[0]}>
          <select id="frequency" name="frequency" className="input" defaultValue={draftState.values?.frequency ?? "twice daily"}>
            {FREQUENCIES.map((frequency) => <option key={frequency} value={frequency}>{frequency}</option>)}</select></Field>
        <Field label="Course length" id="durationDays" error={draftState.errors?.durationDays?.[0]} hint="In days.">
          <Input id="durationDays" name="durationDays" type="number" min={1} max={365} defaultValue={draftState.values?.durationDays ?? "7"} required className="mono" /></Field>
        <div className="admin-form-actions">
          <Button type="submit" disabled={pending}>{draftPending ? <Loader2 /> : <Pill />}Add as a draft</Button>
          <Button type="button" variant="ghost" onClick={() => setChosen(null)}>Choose another medicine</Button>
          <span className="field-hint">Nothing is issued yet: a draft has to pass the safety check first.</span>
        </div>
      </form> : null}
    </> : <p className="field-hint" style={{ marginBottom: 18 }}>This visit is complete, so nothing further can be prescribed against it.</p>}

    <div className="specimen">
      <div className="specimen-topline"><strong>This visit&rsquo;s prescriptions</strong><span>{prescriptions.filter((prescription) => prescription.status === "issued").length} issued</span></div>
      {!prescriptions.length ? <div className="state-panel" style={{ textAlign: "center", minHeight: 0, padding: "36px 24px" }}>
        <p className="empty-state-icon"><Pill /></p><h3>Nothing prescribed yet</h3><p>Search the catalogue above to add the first draft.</p>
      </div> : <ul className="prescription-list">{prescriptions.map((prescription) => <li key={prescription.id}>
        <div className="prescription-head">
          <div><strong>{prescription.name} {prescription.strength}</strong>
            <p className="field-hint">{prescription.dose} {prescription.unit} · {prescription.route} · {prescription.frequency} · {prescription.durationDays} days</p></div>
          <div className="row-actions">
            <Badge tone={prescription.status === "issued" ? "accent" : prescription.status === "cancelled" ? "neutral" : "high"}>{prescription.status}</Badge>
            <Badge tone={safetyTone[prescription.safetyStatus as keyof typeof safetyTone] ?? "neutral"}><SafetyIcon status={prescription.safetyStatus} />{prescription.safetyStatus}</Badge>
          </div>
        </div>
        {prescription.safetyFindings.length ? <ul className="finding-list">{prescription.safetyFindings.map((finding) => <li key={finding}>{finding}</li>)}</ul> : null}
        {prescription.safetySource ? <p className="field-hint">Checked by {prescription.safetySource}{prescription.issuedAt ? ` · issued ${prescription.issuedAt.slice(0, 16).replace("T", " ")}` : ""}</p> : null}
        {prescription.overrideReason ? <p className="field-hint">Override recorded: {prescription.overrideReason}</p> : null}
        {open && prescription.status === "draft" ? <div className="row-actions" style={{ marginTop: 10 }}>
          <form action={check}><input type="hidden" name="encounterId" value={encounterId} /><input type="hidden" name="prescriptionId" value={prescription.id} />
            <Button type="submit" size="small" variant="secondary" disabled={pending}>{checkPending ? <Loader2 /> : <ShieldCheck />}{prescription.safetyStatus === "unchecked" ? "Run safety check" : "Check again"}</Button></form>
          {prescription.safetyStatus === "clear" ? <form action={issue}>
            <input type="hidden" name="encounterId" value={encounterId} /><input type="hidden" name="prescriptionId" value={prescription.id} />
            <Button type="submit" size="small" disabled={pending}>{issuePending ? <Loader2 /> : <Check />}Issue</Button></form> : null}
          {prescription.safetyStatus === "warning" ? (overriding === prescription.id
            ? <form action={issue} className="override-form">
              <input type="hidden" name="encounterId" value={encounterId} /><input type="hidden" name="prescriptionId" value={prescription.id} />
              <Textarea name="overrideReason" rows={2} minLength={20} maxLength={1000} required defaultValue={issueState.values?.overrideReason}
                placeholder="Why is this warning being overridden? At least 20 characters, and it is kept with the prescription." aria-label="Override justification" />
              <div className="row-actions">
                <Button type="submit" size="small" variant="danger" disabled={pending}>{issuePending ? <Loader2 /> : <ShieldAlert />}Override and issue</Button>
                <Button type="button" size="small" variant="ghost" onClick={() => setOverriding(null)}>Cancel</Button>
              </div>
            </form>
            : <Button type="button" size="small" variant="danger" onClick={() => setOverriding(prescription.id)}><ShieldAlert />Override this warning</Button>) : null}
          {prescription.safetyStatus === "blocked" ? <span className="field-error">A hard stop cannot be issued. Cancel it and choose another medicine.</span> : null}
          <form action={cancel}><input type="hidden" name="encounterId" value={encounterId} /><input type="hidden" name="prescriptionId" value={prescription.id} />
            <Button type="submit" size="small" variant="ghost" disabled={pending}><Trash2 />Cancel</Button></form>
        </div> : null}
      </li>)}</ul>}
      <div className="queue-footer"><span>Every draft, check, issue and cancellation is recorded against this patient with the prescribing purpose.</span></div>
    </div>
  </>;
}
