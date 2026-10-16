"use client";

import * as React from "react";
import { useActionState } from "react";
import { Check, Copy, Loader2, Mail, Search, UserRoundPlus } from "lucide-react";
import { Badge, Button, Field, Input } from "@/components/ui/primitives";
import { clinicalName } from "@/lib/format";
import { idleAction } from "@/lib/action-state";
import { invitePatientPortalAction, registerPatientAction, searchPatientsAction, type PatientMatch, type SearchResult } from "@/app/staff/actions";

const portalTone = { none: "neutral", invited: "high", active: "accent", deactivated: "critical" } as const;
const portalLabel = { none: "no account", invited: "link sent", active: "portal account", deactivated: "deactivated" } as const;

export function Patients({ mailConfigured }: { mailConfigured: boolean }) {
  const [term, setTerm] = React.useState("");
  const [result, setResult] = React.useState<SearchResult | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [inviting, setInviting] = React.useState<PatientMatch | null>(null);
  const [registerState, register, registerPending] = useActionState(registerPatientAction, idleAction);
  const [inviteState, invite, invitePending] = useActionState(invitePatientPortalAction, idleAction);
  const [copied, setCopied] = React.useState(false);

  async function runSearch(event: React.FormEvent) {
    event.preventDefault();
    if (term.trim().length < 2) return;
    setSearching(true);
    setResult(await searchPatientsAction(term));
    setSearching(false);
  }
  React.useEffect(() => { setCopied(false); }, [inviteState.link]);
  // A successful invitation closes the form but keeps the link on screen to copy.
  React.useEffect(() => { if (inviteState.link) setInviting(null); }, [inviteState.link]);

  return <>
    <form action={register} className="admin-form schedule-form" aria-busy={registerPending}>
      <Field label="Given name" id="givenName" error={registerState.errors?.givenName?.[0]}>
        <Input id="givenName" name="givenName" defaultValue={registerState.values?.givenName} maxLength={80} required /></Field>
      <Field label="Surname" id="surname" error={registerState.errors?.surname?.[0]}>
        <Input id="surname" name="surname" defaultValue={registerState.values?.surname} maxLength={80} required /></Field>
      <Field label="Date of birth" id="birthDate" error={registerState.errors?.birthDate?.[0]}>
        <Input id="birthDate" name="birthDate" type="date" defaultValue={registerState.values?.birthDate} required /></Field>
      <Field label="Sex" id="sex" error={registerState.errors?.sex?.[0]}>
        <select id="sex" name="sex" className="input" defaultValue={registerState.values?.sex ?? "unknown"}>
          <option value="female">Female</option><option value="male">Male</option><option value="intersex">Intersex</option><option value="unknown">Not recorded</option>
        </select></Field>
      <Field label="Record number" id="mrn" error={registerState.errors?.mrn?.[0]} hint="Leave empty to assign the clinic's next number.">
        <Input id="mrn" name="mrn" defaultValue={registerState.values?.mrn} placeholder="MR-2521" maxLength={32} className="mono" /></Field>
      <div className="admin-form-actions">
        <Button type="submit" disabled={registerPending}>{registerPending ? <Loader2 /> : <UserRoundPlus />}Register patient</Button>
        {registerState.notice ? <span className="field-hint" role="status">{registerState.notice}</span> : null}
        {registerState.error ? <span className="field-error" role="alert">{registerState.error}</span> : null}
      </div>
    </form>

    <form onSubmit={runSearch} className="admin-form" style={{ gridTemplateColumns: "minmax(0, 2fr) auto" }}>
      <Field label="Find a patient" id="term" hint="Surname, given name or record number. At least two characters.">
        <Input id="term" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Yilmaz, or MR-2481" maxLength={80} /></Field>
      <div><Button type="submit" variant="secondary" disabled={searching || term.trim().length < 2}>{searching ? <Loader2 /> : <Search />}Search</Button></div>
    </form>

    {inviteState.link ? <div className="invite-link" role="status">
      <div><strong>{inviteState.delivered ? "Portal invitation sent. This link also works directly:" : "Portal invitation created. Give this link to the patient:"}</strong><code>{inviteState.link}</code></div>
      <Button type="button" variant="secondary" size="small" onClick={() => navigator.clipboard.writeText(inviteState.link ?? "").then(() => setCopied(true), () => setCopied(false))}>
        {copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy link"}</Button>
    </div> : null}
    {inviteState.error ? <p className="field-error" role="alert" style={{ marginBottom: 14 }}>{inviteState.error}</p> : null}

    {result?.ok === false ? <p className="field-error" role="alert">{result.error}</p> : null}
    {result?.ok ? <div className="specimen">
      <div className="specimen-topline"><strong>Matches</strong><span>{result.matches.length === 25 ? "first 25" : `${result.matches.length} found`}</span></div>
      {!result.matches.length ? <div className="state-panel" style={{ textAlign: "center", minHeight: 0, padding: "32px 24px" }}>
        <h3>Nothing matched</h3><p>Check the spelling, or register the patient above.</p>
      </div> : <div className="table-scroll">
        <table className="clinical-table">
          <caption className="sr-only">Patients matching the search</caption>
          <thead><tr><th scope="col">Patient</th><th scope="col">Record number</th><th scope="col">Age</th><th scope="col">Sex</th><th scope="col">Portal</th><th scope="col">Actions</th></tr></thead>
          <tbody>{result.matches.map((match) => <tr key={match.id}>
            <td>{clinicalName(match.givenName, match.surname)}</td>
            <td className="mono">{match.mrn}</td>
            <td className="numeric">{match.age}</td>
            <td>{match.sex}</td>
            <td><Badge tone={portalTone[match.portal]}>{portalLabel[match.portal]}</Badge></td>
            <td>{match.portal === "none" || match.portal === "invited"
              ? <Button type="button" size="small" variant="ghost" onClick={() => setInviting(match)}><Mail />{match.portal === "invited" ? "Send a new link" : "Invite to portal"}</Button>
              : <span className="field-hint">—</span>}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      <div className="queue-footer"><span>An age is shown here, never a date of birth. Opening a chart is a separate, authorized step.</span></div>
    </div> : null}

    {inviting ? <form action={invite} className="admin-form schedule-form" aria-busy={invitePending} style={{ marginTop: 18 }}>
      <input type="hidden" name="patientId" value={inviting.id} />
      <Field label="Patient" id="invitePatient"><Input id="invitePatient" value={`${clinicalName(inviting.givenName, inviting.surname)} · ${inviting.mrn}`} readOnly /></Field>
      <Field label="Their name" id="displayName" error={inviteState.errors?.displayName?.[0]}>
        <Input id="displayName" name="displayName" defaultValue={`${inviting.givenName} ${inviting.surname}`} maxLength={100} required /></Field>
      <Field label="Their email" id="patientEmail" error={inviteState.errors?.email?.[0]}>
        <Input id="patientEmail" name="email" type="email" defaultValue={inviteState.values?.email} maxLength={254} required /></Field>
      <div className="admin-form-actions">
        <Button type="submit" disabled={invitePending}>{invitePending ? <Loader2 /> : <Mail />}Send portal invitation</Button>
        <Button type="button" variant="ghost" onClick={() => setInviting(null)}>Cancel</Button>
        <span className="field-hint">{mailConfigured ? "Emailed to the patient; the link expires in 7 days." : "No mail provider is configured, so the link is shown here to pass on. It expires in 7 days."}</span>
      </div>
    </form> : null}
  </>;
}
