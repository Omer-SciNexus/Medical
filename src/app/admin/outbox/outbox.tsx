"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Inbox, Loader2, RotateCcw } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { clinicalDate } from "@/lib/format";
import { idleAction } from "@/lib/action-state";
import { retryOutboxAction } from "@/app/admin/actions";

type Row = { id: string; topic: string; resourceId: string; attempts: number; lastError: string | null; createdAt: string; dispatchedAt: string | null; nextAttemptAt: string | null; failedAt: string | null };
const labels = { pending: "Waiting", dead: "Needs a decision", dispatched: "Handed over" } as const;

export function Outbox({ rows, scope, backlog, timeZone }: {
  rows: Row[]; scope: "pending" | "dead" | "dispatched"; backlog: { pending: number; dead: number; dispatched: number }; timeZone: string;
}) {
  const [state, retry, pending] = useActionState(retryOutboxAction, idleAction);
  const counts = { pending: backlog.pending, dead: backlog.dead, dispatched: backlog.dispatched };

  return <>
    {state.error ? <p className="field-error" role="alert" style={{ marginBottom: 14 }}>{state.error}</p> : null}
    {state.notice ? <p className="field-hint" role="status" style={{ marginBottom: 14 }}>{state.notice}</p> : null}
    <div className="provider-tabs" role="tablist" aria-label="Delivery state">
      {(["pending", "dead", "dispatched"] as const).map((candidate) => <Link key={candidate} role="tab" aria-selected={candidate === scope}
        className="shortcut-button" data-active={candidate === scope} href={`/admin/outbox?scope=${candidate}`}>
        {labels[candidate]} <span className="queue-count">{counts[candidate]}</span></Link>)}
    </div>
    <div className="specimen">
      <div className="specimen-topline"><strong>{labels[scope]}</strong><span>{rows.length} shown</span></div>
      {!rows.length ? <div className="state-panel" style={{ textAlign: "center", padding: "40px 24px" }}>
        <p className="empty-state-icon"><Inbox /></p><h3>Nothing here</h3>
        <p>{scope === "dead" ? "No event has exhausted its attempts." : scope === "pending" ? "Every event has been handed to the queue." : "Nothing has been dispatched yet."}</p>
      </div> : <div className="table-scroll">
        <table className="clinical-table">
          <caption className="sr-only">Outbox rows in this clinic</caption>
          <thead><tr><th scope="col">Raised</th><th scope="col">Topic</th><th scope="col">Resource</th><th scope="col">Attempts</th>
            <th scope="col">{scope === "dispatched" ? "Handed over" : "Next try"}</th><th scope="col">Last error</th>{scope === "dead" ? <th scope="col">Actions</th> : null}</tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}>
            <td><time className="mono">{clinicalDate(row.createdAt, new Date(), timeZone)}</time></td>
            <td className="mono">{row.topic}</td>
            <td className="mono" title={row.resourceId}>{row.resourceId.slice(0, 8)}</td>
            <td className="numeric">{row.attempts}</td>
            <td>{row.dispatchedAt ? <time className="mono">{clinicalDate(row.dispatchedAt, new Date(), timeZone)}</time>
              : row.failedAt ? <Badge tone="critical">gave up</Badge>
              : row.nextAttemptAt ? <time className="mono">{clinicalDate(row.nextAttemptAt, new Date(), timeZone)}</time>
              : <Badge tone="accent">next pass</Badge>}</td>
            <td className="field-hint">{row.lastError ?? "—"}</td>
            {scope === "dead" ? <td><form action={retry}><input type="hidden" name="outboxId" value={row.id} />
              <Button type="submit" size="small" variant="secondary" disabled={pending}>{pending ? <Loader2 /> : <RotateCcw />}Try again</Button></form></td> : null}
          </tr>)}</tbody>
        </table>
      </div>}
      <div className="queue-footer">
        <span>Rows are claimed with FOR UPDATE SKIP LOCKED, so several workers can drain this queue at once and simply take different rows.</span>
      </div>
    </div>
  </>;
}
