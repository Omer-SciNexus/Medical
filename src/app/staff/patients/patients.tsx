"use client";

import * as React from "react";
import { useActionState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, List, Loader2, Mail, Pencil, Search, UserRoundPlus } from "lucide-react";
import { Badge, Button, Field, Input } from "@/components/ui/primitives";
import { clinicalName } from "@/lib/format";
import { idleAction } from "@/lib/action-state";
import { invitePatientPortalAction, listPatientsAction, registerPatientAction, searchPatientsAction, type PatientMatch, type PatientPage, type RegisterState, type SearchResult } from "@/app/staff/actions";
import { PatientCorrection } from "./correction";

const portalTone = { none: "neutral", invited: "high", active: "accent", deactivated: "critical" } as const;
const portalLabel = { none: "no account", invited: "link sent", active: "portal account", deactivated: "deactivated" } as const;

export type RecentRegistration = { id: string; givenName: string; surname: string; age: number; sex: string; mrn: string; registeredBy: string; registeredAt: string; correctedBy: string | null };
type Review = { days: number; registrations: RecentRegistration[] } | null | undefined;

export function Patients({ mailConfigured, review }: { mailConfigured: boolean; review?: Review }) {
  const [term, setTerm] = React.useState("");
  const [result, setResult] = React.useState<SearchResult | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [inviting, setInviting] = React.useState<PatientMatch | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [corrected, setCorrected] = React.useState<string | null>(null);
  const [registerState, register, registerPending] = useActionState<RegisterState, FormData>(registerPatientAction, idleAction);
  const [inviteState, invite, invitePending] = useActionState(invitePatientPortalAction, idleAction);
  const [copied, setCopied] = React.useState(false);
  const [list, setList] = React.useState<PatientPage | null>(null);
  const [listPage, setListPage] = React.useState(1);
  const [listing, setListing] = React.useState(false);

  const loadList = React.useCallback(async (page: number) => {
    setListing(true);
    setList(await listPatientsAction(page));
    setListPage(page);
    setListing(false);
  }, []);
  React.useEffect(() => { void loadList(1); }, [loadList]);
  // A new registration or a new invitation changes what the list shows, so the current page is read again.
  React.useEffect(() => { if (registerState.ok) void loadList(listPage); }, [registerState]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (inviteState.link) void loadList(listPage); }, [inviteState.link]); // eslint-disable-line react-hooks/exhaustive-deps

  async function search(value: string) {
    setSearching(true);
    setResult(await searchPatientsAction(value));
    setSearching(false);
  }
  async function runSearch(event: React.FormEvent) {
    event.preventDefault();
    if (term.trim().length < 2) return;
    await search(term);
  }
  function edit(patientId: string) { setInviting(null); setCorrected(null); setEditing(patientId); }
  // Saving closes the form; a visible search is re-run so it shows the corrected details.
  const saved = React.useCallback((notice: string) => {
    setEditing(null); setCorrected(notice);
    if (result?.ok && term.trim().length >= 2) void search(term);
    void loadList(listPage);
  }, [result, term, loadList, listPage]);
  function clearSearch() { setTerm(""); setResult(null); }
  function startInvite(match: PatientMatch) { setEditing(null); setInviting(match); }
  const pages = list?.ok ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;
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
        {registerState.error && !registerState.duplicates ? <span className="field-error" role="alert">{registerState.error}</span> : null}
      </div>
      {registerState.duplicates?.length ? <div className="specimen field-full" role="alert">
        <div className="specimen-topline"><strong>Is this the same person?</strong><span>{registerState.duplicates.length === 1 ? "1 record" : `${registerState.duplicates.length} records`} with this name and date of birth</span></div>
        <div className="table-scroll">
          <table className="clinical-table">
            <caption className="sr-only">Existing patients with the same name and date of birth</caption>
            <thead><tr><th scope="col">Patient</th><th scope="col">Record number</th><th scope="col">Age</th><th scope="col">Sex</th><th scope="col">Actions</th></tr></thead>
            <tbody>{registerState.duplicates.map((match) => <tr key={match.id}>
              <td>{clinicalName(match.givenName, match.surname)}</td>
              <td className="mono">{match.mrn}</td>
              <td className="numeric">{match.age}</td>
              <td>{match.sex}</td>
              <td><Button type="button" size="small" variant="ghost" onClick={() => edit(match.id)}><Pencil />Open this record</Button></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="queue-footer">
          <span>If it is the same person, use the existing record instead of creating a second one.</span>
          <Button type="submit" name="confirmDistinct" value="yes" size="small" variant="secondary" disabled={registerPending}><UserRoundPlus />Different person, register anyway</Button>
        </div>
      </div> : null}
    </form>

    <form onSubmit={runSearch} className="admin-form" style={{ gridTemplateColumns: "minmax(0, 2fr) auto" }}>
      <Field label="Find a patient" id="term" hint="Surname, given name or record number. At least two characters.">
        <Input id="term" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Yilmaz, or MR-2481" maxLength={80} /></Field>
      <div className="table-actions">
        <Button type="submit" variant="secondary" disabled={searching || term.trim().length < 2}>{searching ? <Loader2 /> : <Search />}Search</Button>
        {result ? <Button type="button" variant="ghost" onClick={clearSearch}><List />Show all patients</Button> : null}
      </div>
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
      </div> : <PatientTable caption="Patients matching the search" patients={result.matches} onEdit={edit} onInvite={startInvite} />}
      <div className="queue-footer"><span>An age is shown here, never a date of birth. Opening a chart is a separate, authorized step.</span></div>
    </div> : null}

    {!result && list?.ok === false ? <p className="field-error" role="alert">{list.error}</p> : null}
    {!result && list?.ok ? <div className="specimen" aria-busy={listing}>
      <div className="specimen-topline"><strong>All patients</strong><span>{list.total === 1 ? "1 registered" : `${list.total} registered`}</span></div>
      {!list.patients.length ? <div className="state-panel" style={{ textAlign: "center", minHeight: 0, padding: "32px 24px" }}>
        <h3>No patients yet</h3><p>Patients you register above appear here.</p>
      </div> : <PatientTable caption="All registered patients, by surname" patients={list.patients} onEdit={edit} onInvite={startInvite} />}
      <div className="queue-footer">
        <span>By surname. {list.total ? `Showing ${(list.page - 1) * list.pageSize + 1}–${(list.page - 1) * list.pageSize + list.patients.length} of ${list.total}.` : null}</span>
        {pages > 1 ? <div className="table-actions">
          <Button type="button" size="small" variant="ghost" disabled={listing || list.page <= 1} onClick={() => void loadList(list.page - 1)}><ChevronLeft />Previous</Button>
          <span className="field-hint">Page {list.page} of {pages}</span>
          <Button type="button" size="small" variant="ghost" disabled={listing || list.page >= pages} onClick={() => void loadList(list.page + 1)}>Next<ChevronRight /></Button>
        </div> : null}
      </div>
    </div> : null}
    {!result && !list ? <p className="field-hint" role="status">Loading patients…</p> : null}

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

    {editing ? <PatientCorrection key={editing} patientId={editing} onClose={() => setEditing(null)} onSaved={saved} /> : null}
    {corrected ? <p className="field-hint" role="status" style={{ marginTop: 14 }}>{corrected}</p> : null}

    {review === null ? <p className="field-error" role="alert" style={{ marginTop: 24 }}>Recent registrations could not be read. Reload the page to try again.</p> : null}
    {review ? <div className="specimen" style={{ marginTop: 24 }}>
      <div className="specimen-topline"><strong>Recent registrations</strong><span>last {review.days} days · {review.registrations.length === 100 ? "latest 100" : review.registrations.length}</span></div>
      {!review.registrations.length ? <div className="state-panel" style={{ textAlign: "center", minHeight: 0, padding: "32px 24px" }}>
        <h3>No new patients</h3><p>Patients the front desk registers appear here for you to check.</p>
      </div> : <div className="table-scroll">
        <table className="clinical-table">
          <caption className="sr-only">Patients registered in the last {review.days} days</caption>
          <thead><tr><th scope="col">Patient</th><th scope="col">Record number</th><th scope="col">Age</th><th scope="col">Registered by</th><th scope="col">When</th><th scope="col">Actions</th></tr></thead>
          <tbody>{review.registrations.map((row) => <tr key={row.id}>
            <td>{clinicalName(row.givenName, row.surname)}{row.correctedBy ? <> <Badge tone="high">corrected by {row.correctedBy}</Badge></> : null}</td>
            <td className="mono">{row.mrn}</td>
            <td className="numeric">{row.age}</td>
            <td>{row.registeredBy}</td>
            <td className="numeric">{row.registeredAt}</td>
            <td><Button type="button" size="small" variant="ghost" onClick={() => edit(row.id)}><Pencil />Edit details</Button></td>
          </tr>)}</tbody>
        </table>
      </div>}
      <div className="queue-footer"><span>Registrations take effect straight away. Check them here, and correct anything mistyped.</span></div>
    </div> : null}
  </>;
}

function PatientTable({ caption, patients, onEdit, onInvite }: { caption: string; patients: PatientMatch[]; onEdit: (id: string) => void; onInvite: (match: PatientMatch) => void }) {
  return <div className="table-scroll">
    <table className="clinical-table">
      <caption className="sr-only">{caption}</caption>
      <thead><tr><th scope="col">Patient</th><th scope="col">Record number</th><th scope="col">Age</th><th scope="col">Sex</th><th scope="col">Portal</th><th scope="col">Actions</th></tr></thead>
      <tbody>{patients.map((match) => <tr key={match.id}>
        <td>{clinicalName(match.givenName, match.surname)}</td>
        <td className="mono">{match.mrn}</td>
        <td className="numeric">{match.age}</td>
        <td>{match.sex}</td>
        <td><Badge tone={portalTone[match.portal]}>{portalLabel[match.portal]}</Badge></td>
        <td><div className="table-actions">
          <Button type="button" size="small" variant="ghost" onClick={() => onEdit(match.id)}><Pencil />Edit details</Button>
          {match.portal === "none" || match.portal === "invited"
            ? <Button type="button" size="small" variant="ghost" onClick={() => onInvite(match)}><Mail />{match.portal === "invited" ? "Send a new link" : "Invite to portal"}</Button>
            : null}
        </div></td>
      </tr>)}</tbody>
    </table>
  </div>;
}
