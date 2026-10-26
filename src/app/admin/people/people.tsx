"use client";

import * as React from "react";
import { useActionState } from "react";
import { Check, Copy, KeyRound, Loader2, LogOut, MailPlus, Trash2, UserCheck, UserX } from "lucide-react";
import { Badge, Button, Field, Input } from "@/components/ui/primitives";
import { ConfirmForm } from "@/components/ui/confirm-form";
import { idleAction, type ActionState } from "@/lib/action-state";
import { invitePersonAction, resendInvitationAction, resetPersonMfaAction, revokeInvitationAction, revokePersonSessionsAction, setPersonActiveAction } from "@/app/admin/actions";

type Person = { id: string; email: string; displayName: string; role: string; active: boolean; hasMfa: boolean; createdAt: string };
type Invitation = { id: string; email: string; displayName: string; role: string; expiresAt: string; consumedAt: string | null; revokedAt: string | null };

const invitationState = (invitation: Invitation) =>
  invitation.consumedAt ? { label: "accepted", tone: "neutral" as const } : invitation.revokedAt ? { label: "revoked", tone: "neutral" as const }
    : Date.parse(invitation.expiresAt) <= Date.now() ? { label: "expired", tone: "critical" as const } : { label: "pending", tone: "accent" as const };

/** Shown once, never stored in plain text: the table holds only a peppered hash of the token. */
function InvitationLink({ state }: { state: ActionState }) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => { setCopied(false); }, [state.link]);
  if (!state.link) return null;
  return <div className="invite-link" role="status">
    <div><strong>{state.delivered ? "Invitation sent. This link also works directly:" : "Invitation created. Share this link with them:"}</strong>
      <code>{state.link}</code></div>
    <Button type="button" variant="secondary" size="small" onClick={() => navigator.clipboard.writeText(state.link ?? "").then(() => setCopied(true), () => setCopied(false))}>
      {copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy link"}</Button>
  </div>;
}

export function People({ people, invitations, self, mailConfigured }: { people: Person[]; invitations: Invitation[]; self: string; mailConfigured: boolean }) {
  const [inviteState, invite, invitePending] = useActionState(invitePersonAction, idleAction);
  const [resendState, resend, resendPending] = useActionState(resendInvitationAction, idleAction);
  const [revokeState, revokeInvitation, revokePending] = useActionState(revokeInvitationAction, idleAction);
  const [activeState, setActive, activePending] = useActionState(setPersonActiveAction, idleAction);
  const [mfaState, resetMfa, mfaPending] = useActionState(resetPersonMfaAction, idleAction);
  const [sessionState, revokeSessions, sessionPending] = useActionState(revokePersonSessionsAction, idleAction);
  const error = [inviteState, resendState, revokeState, activeState, mfaState, sessionState].find((state) => state.error)?.error;
  const pending = invitePending || resendPending || revokePending || activePending || mfaPending || sessionPending;

  return <>
    <form action={invite} className="admin-form invitation-form" aria-busy={invitePending}>
      <Field label="Full name" id="displayName" error={inviteState.errors?.displayName?.[0]}>
        <Input id="displayName" name="displayName" defaultValue={inviteState.values?.displayName} placeholder="Dr Asel Yilmaz" maxLength={100} required /></Field>
      <Field label="Email address" id="email" error={inviteState.errors?.email?.[0]}>
        <Input id="email" name="email" type="email" defaultValue={inviteState.values?.email} placeholder="colleague@yourclinic.com" maxLength={254} required /></Field>
      <Field label="Role" id="role" error={inviteState.errors?.role?.[0]} hint="A public visitor can never choose a role or a clinic; only this screen can.">
        <select id="role" name="role" className="input" defaultValue={inviteState.values?.role ?? "clinician"}>
          <option value="clinician">Clinician</option><option value="staff">Front desk / staff</option>
        </select></Field>
      <div className="admin-form-actions">
        <Button type="submit" disabled={invitePending}>{invitePending ? <Loader2 /> : <MailPlus />}Send invitation</Button>
        <span className="field-hint">{mailConfigured ? "Invitations are emailed and expire in 7 days." : "No mail provider is configured, so the link is shown here instead. It expires in 7 days."}</span>
      </div>
    </form>
    {error ? <p className="field-error" role="alert" style={{ marginBottom: 16 }}>{error}</p> : null}
    <InvitationLink state={inviteState.link ? inviteState : resendState} />

    <div className="specimen" style={{ marginBottom: 22 }}>
      <div className="specimen-topline"><strong>Accounts</strong><span>{people.length} in this clinic</span></div>
      <div className="table-scroll">
        <table className="clinical-table">
          <caption className="sr-only">People with an account in this clinic</caption>
          <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Authenticator</th><th scope="col">State</th><th scope="col">Actions</th></tr></thead>
          <tbody>{people.map((person) => <tr key={person.id}>
            <td>{person.displayName}{person.id === self ? <span className="field-hint"> (you)</span> : null}</td>
            <td className="mono">{person.email}</td>
            <td>{person.role}</td>
            <td>{person.hasMfa ? <Badge tone="neutral">enrolled</Badge> : <Badge tone="high">not set up</Badge>}</td>
            <td>{person.active ? <Badge tone="accent">active</Badge> : <Badge tone="critical">deactivated</Badge>}</td>
            <td>{person.id === self ? <span className="field-hint">Your own account is managed elsewhere</span> : <div className="row-actions">
              <ConfirmForm action={setActive} title={`${person.active ? "Deactivate" : "Reactivate"} ${person.displayName}?`} description={person.active ? "This person will lose access and all their active sessions will end. Their records are retained." : "This person will be able to sign in to this clinic again."} confirmLabel={person.active ? "Deactivate account" : "Reactivate account"}><input type="hidden" name="userId" value={person.id} /><input type="hidden" name="active" value={person.active ? "false" : "true"} />
                <Button type="submit" size="small" variant={person.active ? "danger" : "secondary"} disabled={pending}>
                  {person.active ? <><UserX />Deactivate</> : <><UserCheck />Reactivate</>}</Button></ConfirmForm>
              <ConfirmForm action={resetMfa} title={`Reset the authenticator for ${person.displayName}?`} description={"Their sessions will end and they will need to set up an authenticator again. Confirm their identity before continuing."} confirmLabel={"Reset authenticator"}><input type="hidden" name="userId" value={person.id} />
                <Button type="submit" size="small" variant="ghost" disabled={pending || !person.hasMfa}><KeyRound />Reset authenticator</Button></ConfirmForm>
              <ConfirmForm action={revokeSessions} title={`End all sessions for ${person.displayName}?`} description={"This person will be signed out on every device. They can sign in again with their existing credentials."} confirmLabel={"End sessions"}><input type="hidden" name="userId" value={person.id} />
                <Button type="submit" size="small" variant="ghost" disabled={pending}><LogOut />End sessions</Button></ConfirmForm>
            </div>}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="queue-footer"><span>Deactivating an account and resetting an authenticator both end that person&rsquo;s sessions immediately.</span></div>
    </div>

    <div className="specimen">
      <div className="specimen-topline"><strong>Invitations</strong><span>{invitations.filter((invitation) => invitationState(invitation).label === "pending").length} pending</span></div>
      {!invitations.length ? <div className="state-panel" style={{ textAlign: "center", minHeight: 0, padding: "32px 24px" }}>
        <h3>No invitations yet</h3><p>Invite a clinician or a front-desk colleague above. Each link works once.</p></div>
        : <div className="table-scroll">
          <table className="clinical-table">
            <caption className="sr-only">Invitations issued by this clinic</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Expires</th><th scope="col">State</th><th scope="col">Actions</th></tr></thead>
            <tbody>{invitations.map((invitation) => {
              const state = invitationState(invitation);
              return <tr key={invitation.id}>
                <td>{invitation.displayName}</td>
                <td className="mono">{invitation.email}</td>
                <td>{invitation.role}</td>
                <td><time className="mono">{invitation.expiresAt.slice(0, 10)}</time></td>
                <td><Badge tone={state.tone}>{state.label}</Badge></td>
                <td>{state.label === "accepted" || state.label === "revoked" ? <span className="field-hint">—</span> : <div className="row-actions">
                  <form action={resend}><input type="hidden" name="invitationId" value={invitation.id} />
                    <Button type="submit" size="small" variant="secondary" disabled={pending}><MailPlus />New link</Button></form>
                  <ConfirmForm action={revokeInvitation} title={`Revoke the invitation for ${invitation.displayName}?`} description={`The link sent to ${invitation.email} will stop working immediately. You can send a new invitation later.`} confirmLabel="Revoke invitation"><input type="hidden" name="invitationId" value={invitation.id} />
                    <Button type="submit" size="small" variant="ghost" disabled={pending}><Trash2 />Revoke</Button></ConfirmForm>
                </div>}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
      <div className="queue-footer"><span>A new link replaces the previous one immediately: only the newest link for an invitation can be used.</span></div>
    </div>
  </>;
}
