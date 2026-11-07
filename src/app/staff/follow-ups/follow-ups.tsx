"use client";

import { useActionState } from "react";
import { BellRing, Loader2, X } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { ConfirmForm } from "@/components/ui/confirm-form";
import { clinicalName } from "@/lib/format";
import { idleAction } from "@/lib/action-state";
import { closeFollowUpAction, remindFollowUpAction } from "@/app/staff/actions";

export type FollowUpRow = { id: string; givenName: string; surname: string; mrn: string; clinician: string; due: string; daysUntilDue: number; remindedOn: string | null; canRemind: boolean };

function dueBadge(days: number) {
  if (days < 0) return <Badge tone="critical">{-days} {days === -1 ? "day" : "days"} overdue</Badge>;
  if (days === 0) return <Badge tone="high">Due today</Badge>;
  return <Badge>In {days} {days === 1 ? "day" : "days"}</Badge>;
}

// The clinician's note is not on this page on purpose: the front desk books visits, not care.
export function FollowUps({ rows, closeReasons }: { rows: FollowUpRow[]; closeReasons: string[] }) {
  const [remindState, remind, remindPending] = useActionState(remindFollowUpAction, idleAction);
  const [closeState, close, closePending] = useActionState(closeFollowUpAction, idleAction);
  const error = remindState.error ?? closeState.error ?? closeState.errors?.reason?.[0];
  return <>
    {error ? <p className="field-error" role="alert" style={{ marginBottom: 14 }}>{error}</p> : null}
    {remindState.ok && remindState.notice ? <p className="field-hint" role="status" style={{ marginBottom: 14 }}>{remindState.notice}</p> : null}
    <div className="specimen">
      <div className="specimen-topline"><strong>Waiting to be booked</strong><span>{rows.length === 100 ? "soonest 100" : `${rows.length} open`}</span></div>
      {!rows.length ? <div className="state-panel" style={{ textAlign: "center", minHeight: 0, padding: "32px 24px" }}>
        <h3>Nobody to chase</h3><p>When a clinician asks to see a patient again, they appear here until they book.</p>
      </div> : <div className="table-scroll">
        <table className="clinical-table">
          <caption className="sr-only">Follow-ups waiting to be booked, soonest first</caption>
          <thead><tr><th scope="col">Patient</th><th scope="col">Record number</th><th scope="col">Clinician</th><th scope="col">See again by</th><th scope="col">Reminder</th><th scope="col">Actions</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}>
            <td>{clinicalName(row.givenName, row.surname)}</td>
            <td className="mono">{row.mrn}</td>
            <td>{row.clinician}</td>
            <td><span className="numeric">{row.due}</span> {dueBadge(row.daysUntilDue)}</td>
            <td>{row.remindedOn ? `Sent ${row.remindedOn}` : row.canRemind ? "Not yet" : "No portal account"}</td>
            <td><div className="row-actions">
              {row.canRemind ? <form action={remind}><input type="hidden" name="followUpId" value={row.id} />
                <Button type="submit" size="small" variant="secondary" disabled={remindPending}>{remindPending ? <Loader2 /> : <BellRing />}Remind</Button></form> : null}
              <ConfirmForm action={close} className="row-actions" title={`Close the follow-up for ${clinicalName(row.givenName, row.surname)}?`} description="They leave this list and the request disappears from their portal. Only close it if they no longer need to book." confirmLabel="Close follow-up">
                <input type="hidden" name="followUpId" value={row.id} />
                <select name="reason" className="input follow-up-reason" aria-label={`Why the follow-up for ${clinicalName(row.givenName, row.surname)} is closing`} defaultValue={closeReasons[0]}>
                  {closeReasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                </select>
                <Button type="submit" size="small" variant="ghost" disabled={closePending}><X />Close</Button>
              </ConfirmForm>
            </div></td>
          </tr>)}</tbody>
        </table>
      </div>}
      <div className="queue-footer"><span>Reminders say only that the clinic would like to see them. The reason stays in the patient&rsquo;s portal.</span></div>
    </div>
  </>;
}
