"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button, Field, Input } from "@/components/ui/primitives";
import { idleAction } from "@/lib/action-state";
import { correctPatientAction, getPatientDetailsAction, type DetailsResult } from "@/app/staff/actions";

/** Opens one record's registration details, date of birth included, and saves a correction. */
export function PatientCorrection({ patientId, onClose, onSaved }: { patientId: string; onClose: () => void; onSaved: (notice: string) => void }) {
  const [details, setDetails] = React.useState<DetailsResult | null>(null);
  const [state, save, pending] = useActionState(correctPatientAction, idleAction);
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    let live = true;
    getPatientDetailsAction(patientId).then((result) => { if (live) setDetails(result); });
    return () => { live = false; };
  }, [patientId]);
  React.useEffect(() => { if (details?.ok) formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [details]);
  React.useEffect(() => { if (state.ok && state.notice) onSaved(state.notice); }, [state, onSaved]);

  if (!details) return <p className="field-hint" role="status" style={{ marginTop: 18 }}><Loader2 /> Opening the record…</p>;
  if (!details.ok) return <p className="field-error" role="alert" style={{ marginTop: 18 }}>{details.error}</p>;
  const patient = details.patient;
  const value = (name: "givenName" | "surname" | "birthDate" | "sex") => state.values?.[name] ?? patient[name];

  return <form ref={formRef} action={save} className="admin-form schedule-form" aria-busy={pending} aria-label={`Correct ${patient.mrn}`} style={{ marginTop: 18 }}>
    <input type="hidden" name="patientId" value={patient.id} />
    <input type="hidden" name="version" value={patient.version} />
    <Field label="Record number" id="correctMrn" hint="Stays the same; other records already point at it.">
      <Input id="correctMrn" value={patient.mrn} readOnly className="mono" /></Field>
    <Field label="Given name" id="correctGivenName" error={state.errors?.givenName?.[0]}>
      <Input id="correctGivenName" name="givenName" defaultValue={value("givenName")} maxLength={80} required /></Field>
    <Field label="Surname" id="correctSurname" error={state.errors?.surname?.[0]}>
      <Input id="correctSurname" name="surname" defaultValue={value("surname")} maxLength={80} required /></Field>
    <Field label="Date of birth" id="correctBirthDate" error={state.errors?.birthDate?.[0]}>
      <Input id="correctBirthDate" name="birthDate" type="date" defaultValue={value("birthDate")} required /></Field>
    <Field label="Sex" id="correctSex" error={state.errors?.sex?.[0]}>
      <select id="correctSex" name="sex" className="input" defaultValue={value("sex")}>
        <option value="female">Female</option><option value="male">Male</option><option value="intersex">Intersex</option><option value="unknown">Not recorded</option>
      </select></Field>
    <div className="admin-form-actions">
      <Button type="submit" disabled={pending}>{pending ? <Loader2 /> : <Save />}Save correction</Button>
      <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
      {state.error ? <span className="field-error" role="alert">{state.error}</span>
        : <span className="field-hint">The access log records which details changed and who changed them.</span>}
    </div>
  </form>;
}
