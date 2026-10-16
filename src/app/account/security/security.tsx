"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { Check, Copy, KeyRound, Loader2, LogOut, MailCheck, MailWarning, RefreshCw, ShieldAlert } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { endOtherSessionsAction, reissueRecoveryCodesAction, resendVerificationAction, restartAuthenticatorAction, type SecurityState } from "@/app/account/actions";

export function Security({ email, verified, hasMfa, recoveryRemaining, canReissue, mailConfigured, usesAuthenticator }: {
  email: string; verified: boolean; hasMfa: boolean; recoveryRemaining: number; canReissue: boolean; mailConfigured: boolean; usesAuthenticator: boolean;
}) {
  const [verifyState, resend, verifyPending] = useActionState<SecurityState, FormData>(resendVerificationAction, {});
  const [mfaState, restart, mfaPending] = useActionState<SecurityState, FormData>(restartAuthenticatorAction, {});
  const [codeState, reissue, codePending] = useActionState<SecurityState, FormData>(reissueRecoveryCodesAction, {});
  const [sessionState, endSessions, sessionPending] = useActionState<SecurityState, FormData>(endOtherSessionsAction, {});
  const [copied, setCopied] = React.useState(false);
  const error = [verifyState, mfaState, codeState, sessionState].find((state) => state.error)?.error;
  const notice = [verifyState, sessionState].find((state) => state.notice)?.notice;

  // Restarting enrollment ends this session, so the setup key is the only way back in.
  if (mfaState.secret) return <div className="specimen">
    <div className="specimen-topline"><strong>Set up your new authenticator</strong><span>then verify to sign in</span></div>
    <div className="state-panel">
      <h3><KeyRound /> Add this key to your authenticator app</h3>
      <p>Your previous authenticator and recovery codes no longer work, and every session has been ended. Enter the key below in your app, then verify the six-digit code to sign back in.</p>
      <div className="auth-setup-key" style={{ marginTop: 14 }}>
        <code aria-label="Authenticator setup key">{mfaState.secret}</code>
        <button type="button" aria-label={copied ? "Setup key copied" : "Copy setup key"} onClick={() => navigator.clipboard.writeText(mfaState.secret ?? "").then(() => setCopied(true), () => setCopied(false))}>{copied ? <Check /> : <Copy />}</button>
      </div>
      <Link className="button button-primary" href="/sign-in" style={{ marginTop: 16 }}>Verify and sign in</Link>
    </div>
  </div>;

  return <>
    {error ? <p className="field-error" role="alert" style={{ marginBottom: 14 }}>{error}</p> : null}
    {notice ? <p className="field-hint" role="status" style={{ marginBottom: 14 }}>{notice}</p> : null}

    <div className="specimen" style={{ marginBottom: 20 }}>
      <div className="specimen-topline"><strong>Email address</strong>{verified ? <Badge tone="accent">confirmed</Badge> : <Badge tone="high">not confirmed</Badge>}</div>
      <div className="state-panel" style={{ minHeight: 0 }}>
        <h3>{verified ? <MailCheck /> : <MailWarning />} {email}</h3>
        <p>{verified
          ? "You have confirmed that you control this address, so mail sent in your clinic's name can come from your account."
          : "Confirm this address to finish setting up your account. Until then, invitations cannot be sent from your account, since they go out in your clinic's name."}</p>
        {!verified ? <form action={resend}><Button type="submit" variant="secondary" disabled={verifyPending}>{verifyPending ? <Loader2 /> : <MailCheck />}
          {mailConfigured ? "Send a confirmation link" : "Send a confirmation link (no mail provider configured)"}</Button></form> : null}
      </div>
    </div>

    {usesAuthenticator ? <div className="specimen" style={{ marginBottom: 20 }}>
      <div className="specimen-topline"><strong>Authenticator</strong><span>{hasMfa ? `${recoveryRemaining} recovery ${recoveryRemaining === 1 ? "code" : "codes"} left` : "not enrolled"}</span></div>
      <div className="state-panel" style={{ minHeight: 0 }}>
        <h3><ShieldAlert /> Lost or replacing your authenticator</h3>
        <p>Restarting enrollment removes the current authenticator and all recovery codes, ends every session, and gives you a new setup key immediately. It is available when you have just verified with your authenticator, or when you signed in with a recovery code.</p>
        {codeState.recoveryCodes?.length ? <>
          <div className="recovery-code-grid" style={{ marginTop: 14 }}>{codeState.recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div>
          <p className="field-hint">These replace every previous code. Save them before leaving this page.</p>
        </> : null}
        <div className="row-actions" style={{ marginTop: 16 }}>
          <form action={restart}><Button type="submit" variant="danger" disabled={mfaPending}>{mfaPending ? <Loader2 /> : <KeyRound />}Restart enrollment</Button></form>
          <form action={reissue}><Button type="submit" variant="secondary" disabled={codePending || !hasMfa || !canReissue}>{codePending ? <Loader2 /> : <RefreshCw />}Reissue recovery codes</Button></form>
        </div>
        {!canReissue ? <p className="field-hint">Reissuing recovery codes needs a fresh authenticator check. Sign in with your authenticator rather than a recovery code, then come back.</p> : null}
      </div>
    </div> : null}

    <div className="specimen">
      <div className="specimen-topline"><strong>Sessions</strong><span>idle 30 minutes, absolute 8 hours</span></div>
      <div className="state-panel" style={{ minHeight: 0 }}>
        <h3><LogOut /> End every session</h3>
        <p>Use this if you have signed in somewhere you no longer control. It ends this session too, so you will sign in again afterwards.</p>
        <form action={endSessions}><Button type="submit" variant="secondary" disabled={sessionPending}>{sessionPending ? <Loader2 /> : <LogOut />}End every session</Button></form>
      </div>
    </div>
  </>;
}
