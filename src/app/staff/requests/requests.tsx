"use client";

import * as React from "react";
import { useActionState } from "react";
import { Check, Copy, Link2, Loader2, UserRoundPlus, X } from "lucide-react";
import { Button, Field, Input } from "@/components/ui/primitives";
import { ConfirmForm } from "@/components/ui/confirm-form";
import { clinicalName } from "@/lib/format";
import { idleAction, type ActionState } from "@/lib/action-state";
import { declineRequestAction, findRequestMatchesAction, linkRequestAction, registerFromRequestAction, type MatchesResult } from "@/app/staff/actions";

export type PendingRequest = { id: string; givenName: string; surname: string; age: number; contactEmail: string; contactPhone: string | null; reason: string; preferredTimes: string | null; receivedAt: string };

function CopyBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => { setCopied(false); }, [value]);
  return <div className="invite-link" role="status">
    <div><strong>{label}</strong><code>{value}</code></div>
    <Button type="button" variant="secondary" size="small" onClick={() => navigator.clipboard.writeText(value).then(() => setCopied(true), () => setCopied(false))}>
      {copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy link"}</Button>
  </div>;
}

export function Requests({ clinicId, requests, mailConfigured }: { clinicId: string; requests: PendingRequest[] | null; mailConfigured: boolean }) {
  const [shareLink, setShareLink] = React.useState("");
  React.useEffect(() => { setShareLink(`${window.location.origin}/request-appointment?clinic=${clinicId}`); }, [clinicId]);
  const [open, setOpen] = React.useState<string | null>(null);
  const [linkState, link, linkPending] = useActionState(linkRequestAction, idleAction);
  const [registerState, register, registerPending] = useActionState(registerFromRequestAction, idleAction);
  const [declineState, decline, declinePending] = useActionState(declineRequestAction, idleAction);
  const pending = linkPending || registerPending || declinePending;
  // Whichever action ran last decides what is shown; each one closes the review it came from.
  const [last, setLast] = React.useState<ActionState>(idleAction);
  React.useEffect(() => { setLast(linkState); if (linkState.ok) setOpen(null); }, [linkState]);
  React.useEffect(() => { setLast(registerState); if (registerState.ok) setOpen(null); }, [registerState]);
  React.useEffect(() => { setLast(declineState); if (declineState.ok) setOpen(null); }, [declineState]);
  const reviewing = requests?.find((request) => request.id === open);

  return <>
    {shareLink ? <CopyBox label="Your clinic's request link. Put it on your website or send it to people who want an appointment:" value={shareLink} /> : null}
    {last.link ? <CopyBox value={last.link} label={[last.notice, last.delivered ? "Portal invitation sent. This link also works directly:"
      : mailConfigured ? "Portal invitation created, but it could not be emailed. Give this link to the patient:" : "Portal invitation created. Give this link to the patient:"].filter(Boolean).join(" ")} /> : null}
    {last.ok && !last.link && last.notice ? <p className="field-hint" role="status" style={{ marginBottom: 14 }}>{last.notice}</p> : null}
    {last.error ? <p className="field-error" role="alert" style={{ marginBottom: 14 }}>{last.error}</p> : null}

    {requests === null ? <p className="field-error" role="alert">Requests could not be read. Reload the page to try again.</p> : <div className="specimen">
      <div className="specimen-topline"><strong>Waiting for review</strong><span>{requests.length === 100 ? "oldest 100" : `${requests.length} pending`}</span></div>
      {!requests.length ? <div className="state-panel" style={{ textAlign: "center", minHeight: 0, padding: "32px 24px" }}>
        <h3>No requests waiting</h3><p>Confirmed requests from your clinic&rsquo;s link appear here, oldest first.</p>
      </div> : <div className="table-scroll">
        <table className="clinical-table">
          <caption className="sr-only">Appointment requests waiting for review, oldest first</caption>
          <thead><tr><th scope="col">Name</th><th scope="col">Age</th><th scope="col">Contact</th><th scope="col">Reason</th><th scope="col">Received</th><th scope="col">Actions</th></tr></thead>
          <tbody>{requests.map((request) => <tr key={request.id} aria-selected={open === request.id}>
            <td>{clinicalName(request.givenName, request.surname)}</td>
            <td className="numeric">{request.age}</td>
            <td><span className="mono">{request.contactEmail}</span>{request.contactPhone ? <><br /><span className="mono">{request.contactPhone}</span></> : null}</td>
            <td>{request.reason}{request.preferredTimes ? <><br /><span className="field-hint">Prefers: {request.preferredTimes}</span></> : null}</td>
            <td className="numeric">{request.receivedAt}</td>
            <td><Button type="button" size="small" variant={open === request.id ? "secondary" : "ghost"} onClick={() => setOpen(open === request.id ? null : request.id)}>
              {open === request.id ? "Close" : "Review"}</Button></td>
          </tr>)}</tbody>
        </table>
      </div>}
      <div className="queue-footer"><span>Nothing is booked from here: each person is invited to the portal and chooses a time themselves.</span></div>
    </div>}

    {reviewing ? <Review key={reviewing.id} request={reviewing} pending={pending} link={link} register={register} decline={decline} declineErrors={declineState.errors} onClose={() => setOpen(null)} /> : null}
  </>;
}

type FormAction = (payload: FormData) => void;
function Review({ request, pending, link, register, decline, declineErrors, onClose }: { request: PendingRequest; pending: boolean; link: FormAction; register: FormAction; decline: FormAction; declineErrors?: ActionState["errors"]; onClose: () => void }) {
  const [matches, setMatches] = React.useState<MatchesResult | null>(null);
  React.useEffect(() => { void findRequestMatchesAction(request.id).then(setMatches); }, [request.id]);
  const name = clinicalName(request.givenName, request.surname);

  return <div className="specimen" style={{ marginTop: 18 }}>
    <div className="specimen-topline"><strong>Reviewing {name}</strong><Button type="button" size="small" variant="ghost" onClick={onClose}><X />Close</Button></div>
    {!matches ? <p className="field-hint" role="status" style={{ padding: "16px 20px" }}><Loader2 /> Looking for existing records…</p>
      : !matches.ok ? <p className="field-error" role="alert" style={{ padding: "16px 20px" }}>{matches.error}</p>
      : matches.matches.length ? <div className="table-scroll">
        <table className="clinical-table">
          <caption className="sr-only">Existing patients with the same name and date of birth</caption>
          <thead><tr><th scope="col">Existing patient</th><th scope="col">Record number</th><th scope="col">Age</th><th scope="col">Sex</th><th scope="col">Actions</th></tr></thead>
          <tbody>{matches.matches.map((match) => <tr key={match.id}>
            <td>{clinicalName(match.givenName, match.surname)}</td>
            <td className="mono">{match.mrn}</td>
            <td className="numeric">{match.age}</td>
            <td>{match.sex}</td>
            <td><form action={link}><input type="hidden" name="requestId" value={request.id} /><input type="hidden" name="patientId" value={match.id} />
              <Button type="submit" size="small" variant="secondary" disabled={pending}><Link2 />Same person: link and invite</Button></form></td>
          </tr>)}</tbody>
        </table>
      </div>
      : <p className="field-hint" style={{ padding: "16px 20px" }}>No existing patient has this name and date of birth. If you know they are already registered under other details, find them on the Patients page and decline this request with a note.</p>}
    <div className="queue-footer">
      <form action={register}><input type="hidden" name="requestId" value={request.id} />
        <Button type="submit" size="small" variant={matches?.ok && matches.matches.length ? "ghost" : "primary"} disabled={pending || !matches}>
          {pending ? <Loader2 /> : <UserRoundPlus />}{matches?.ok && matches.matches.length ? "Different person: register and invite" : "Register and invite"}</Button></form>
      <ConfirmForm action={decline} title={`Decline the request from ${name}?`} description="It leaves the queue and nothing is sent to them. Contact them yourself if they should hear from the clinic." confirmLabel="Decline request"
        className="table-actions">
        <input type="hidden" name="requestId" value={request.id} />
        <Field label="Note (optional)" id="declineNote" error={declineErrors?.note?.[0]}><Input id="declineNote" name="note" maxLength={200} placeholder="For example: already registered as MR-2490" /></Field>
        <Button type="submit" size="small" variant="ghost" disabled={pending}><X />Decline</Button>
      </ConfirmForm>
    </div>
  </div>;
}
