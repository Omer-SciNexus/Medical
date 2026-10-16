"use client";

import * as React from "react";
import { useActionState } from "react";
import { Clock, Eye, Loader2, ShieldAlert } from "lucide-react";
import { Button, Textarea } from "@/components/ui/primitives";
import { idleAction } from "@/lib/action-state";
import { breakGlassAction } from "@/app/clinical/actions";

/**
 * Deliberately uncomfortable. Nothing here is a shortcut: the grant is read-only, lasts fifteen
 * minutes, names this clinician in the access log, and needs a reason worth reading later.
 */
export function BreakGlass({ patientId }: { patientId: string }) {
  const [state, request, pending] = useActionState(breakGlassAction, idleAction);
  const [confirmed, setConfirmed] = React.useState(false);
  const [reason, setReason] = React.useState("");

  if (state.ok) return <div className="integrity-banner" role="status" style={{ marginTop: 20 }}>
    <Eye />
    <div><strong>Emergency read access granted for fifteen minutes</strong>
      <p>Reload this page to open the chart. The grant is read-only, so nothing can be documented or prescribed under it, and it appears in the access log as an emergency access against your name.</p></div>
  </div>;

  return <section className="break-glass" style={{ marginTop: 20 }}>
    <h3><ShieldAlert /> Emergency access</h3>
    <p>If this patient needs care now and the usual authority is not in place, you can take read-only access to their chart. It is recorded against your name as an emergency access and reviewed.</p>
    <ul className="break-glass-terms">
      <li><Eye /> Read-only. Documenting and prescribing still need ordinary care authority.</li>
      <li><Clock /> Expires fifteen minutes after it is granted, with no extension.</li>
      <li><ShieldAlert /> Needs a recent authenticator check, and a recovery code does not count.</li>
    </ul>
    {state.error ? <p className="field-error" role="alert">{state.error}</p> : null}
    <form action={request}>
      <input type="hidden" name="patientId" value={patientId} />
      <Textarea name="reason" rows={3} minLength={20} maxLength={1000} required value={reason} onChange={(event) => setReason(event.target.value)}
        placeholder="Why does this patient need care now, and why is the usual authority not in place? At least 20 characters." aria-label="Reason for emergency access" />
      <label className="auth-checkbox" style={{ marginTop: 10 }}>
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        I understand this is recorded against my name and will be reviewed.
      </label>
      <Button type="submit" variant="danger" disabled={pending || !confirmed || reason.trim().length < 20} style={{ marginTop: 12 }}>
        {pending ? <Loader2 /> : <ShieldAlert />}Take emergency read access</Button>
    </form>
  </section>;
}
