"use client";

import * as React from "react";
import { useActionState } from "react";
import { Inbox, Loader2, ShieldOff, Siren } from "lucide-react";
import { Badge, Button, Input } from "@/components/ui/primitives";
import { clinicalDate } from "@/lib/format";
import { idleAction } from "@/lib/action-state";
import { revokeAccessGrantAction } from "@/app/admin/actions";

type Grant = { id: string; patientId: string; purpose: string; emergency: boolean; reason: string | null; actorName: string; actorRole: string; createdAt: string; expiresAt: string | null };

export function Access({ grants, timeZone }: { grants: Grant[]; timeZone: string }) {
  const [filter, setFilter] = React.useState("");
  const [state, revoke, pending] = useActionState(revokeAccessGrantAction, idleAction);
  const needle = filter.trim().toLowerCase();
  const shown = needle ? grants.filter((grant) => grant.actorName.toLowerCase().includes(needle) || grant.patientId.startsWith(needle) || grant.purpose.includes(needle)) : grants;
  const emergencies = grants.filter((grant) => grant.emergency).length;

  return <>
    {state.error ? <p className="field-error" role="alert" style={{ marginBottom: 14 }}>{state.error}</p> : null}
    <div className="admin-form" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
      <div className="field">
        <label htmlFor="grantFilter">Filter</label>
        <Input id="grantFilter" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Clinician name, purpose, or the start of a patient identifier" maxLength={80} />
        <p className="field-hint">{grants.length} live {grants.length === 1 ? "grant" : "grants"}{emergencies ? `, ${emergencies} from break-glass` : ""}.</p>
      </div>
    </div>
    <div className="specimen">
      <div className="specimen-topline"><strong>Live access</strong><span>{shown.length === grants.length ? `${grants.length} total` : `${shown.length} of ${grants.length}`}</span></div>
      {!shown.length ? <div className="state-panel" style={{ textAlign: "center", minHeight: 0, padding: "40px 24px" }}>
        <p className="empty-state-icon"><Inbox /></p><h3>{grants.length ? "Nothing matches that filter" : "No live access"}</h3>
        <p>{grants.length ? "Clear the filter to see every grant." : "Access appears here as soon as a patient books an appointment or arrives for one."}</p>
      </div> : <div className="table-scroll">
        <table className="clinical-table">
          <caption className="sr-only">Live care relationships in this clinic</caption>
          <thead><tr><th scope="col">Holder</th><th scope="col">Role</th><th scope="col">Patient</th><th scope="col">Purpose</th><th scope="col">Granted</th><th scope="col">Until</th><th scope="col">Actions</th></tr></thead>
          <tbody>{shown.map((grant) => <tr key={grant.id}>
            <td>{grant.actorName}{grant.emergency ? <Badge tone="critical" className="grant-flag"><Siren />break-glass</Badge> : null}</td>
            <td>{grant.actorRole}</td>
            <td className="mono" title={grant.patientId}>{grant.patientId.slice(0, 8)}</td>
            <td className="mono">{grant.purpose}</td>
            <td><time className="mono">{clinicalDate(grant.createdAt, new Date(), timeZone)}</time></td>
            <td>{grant.expiresAt ? <time className="mono">{clinicalDate(grant.expiresAt, new Date(), timeZone)}</time> : <span className="field-hint">until withdrawn</span>}</td>
            <td><form action={revoke}><input type="hidden" name="relationshipId" value={grant.id} />
              <Button type="submit" size="small" variant="ghost" disabled={pending}>{pending ? <Loader2 /> : <ShieldOff />}Withdraw</Button></form></td>
          </tr>)}</tbody>
        </table>
      </div>}
      <div className="queue-footer"><span>Withdrawing a grant does not remove what was already recorded: the access log keeps every read that happened while it was live.</span></div>
    </div>
  </>;
}
