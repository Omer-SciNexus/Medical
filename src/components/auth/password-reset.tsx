"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Eye, EyeOff, KeyRound, LoaderCircle, MailCheck } from "lucide-react";
import { completeResetAction, requestResetAction, type ResetState } from "@/app/(auth)/actions";

function Field({ name, label, error, hint, ...props }: React.ComponentProps<"input"> & { name: string; label: string; error?: string; hint?: string }) {
  const [visible, setVisible] = useState(false);
  const password = props.type === "password";
  return <div className="auth-field"><label htmlFor={name}>{label}</label><div className="auth-input-wrap">
    <input {...props} id={name} name={name} type={password && visible ? "text" : props.type} className={password ? "auth-input auth-password-input" : "auth-input"} aria-invalid={Boolean(error)} />
    {password && <button className="password-toggle" type="button" onClick={() => setVisible(!visible)} aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`} aria-pressed={visible}>{visible ? <EyeOff /> : <Eye />}</button>}
  </div>{error ? <p className="auth-field-error">{error}</p> : hint ? <p className="auth-field-hint">{hint}</p> : null}</div>;
}

export function PasswordReset({ mode, configured, token }: { mode: "request" | "complete"; configured: boolean; token?: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(mode === "request" ? requestResetAction : completeResetAction, {});

  if (state.sent) return <div className="auth-content">
    <div className="auth-title-icon"><MailCheck /></div>
    <span className="public-eyebrow">CHECK YOUR EMAIL</span>
    <h1>If that address has an account, a link is on its way.</h1>
    {/* Deliberately the same answer either way: who holds an account here is not public. */}
    <p className="auth-description">The link works once and expires in 30 minutes. Using it ends every signed-in session on the account, so sign in again afterwards.</p>
    <p className="auth-switch"><Link href="/sign-in">Back to sign-in <ArrowRight /></Link></p>
  </div>;

  if (state.done) return <div className="auth-content">
    <div className="auth-title-icon"><Check /></div>
    <span className="public-eyebrow">PASSWORD CHANGED</span>
    <h1>That&rsquo;s done.</h1>
    <p className="auth-description">Your new password is active and every previous session has been ended. Sign in with it now.</p>
    <p className="auth-switch"><Link href="/sign-in">Sign in <ArrowRight /></Link></p>
  </div>;

  if (mode === "complete" && !token) return <div className="auth-content">
    <div className="auth-title-icon"><KeyRound /></div>
    <span className="public-eyebrow">RESET LINK</span>
    <h1>This link cannot be used.</h1>
    <p className="auth-description">It may have expired, or already been used. Reset links work once and last 30 minutes.</p>
    <p className="auth-switch"><Link href="/forgot-password">Request a new link <ArrowRight /></Link></p>
  </div>;

  return <div className="auth-content">
    <div className="auth-title-icon"><KeyRound /></div>
    <span className="public-eyebrow">{mode === "request" ? "FORGOTTEN PASSWORD" : "CHOOSE A NEW PASSWORD"}</span>
    <h1>{mode === "request" ? "It happens." : "Pick something you'll remember."}</h1>
    <p className="auth-description">{mode === "request"
      ? "Enter the address you sign in with and we'll send a single-use link."
      : "Your new password takes effect immediately, and every session already signed in will be ended."}</p>
    {!configured && <div className="auth-availability" role="status">Account services are being connected. Password reset is unavailable right now.</div>}
    {state.error && <div className="auth-error" role="alert">{state.error}</div>}
    <form action={action} noValidate aria-busy={pending} className="auth-form">
      {mode === "request"
        ? <Field name="email" label="Email address" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="you@yourclinic.com" maxLength={254} required error={state.errors?.email?.[0]} />
        : <>
          <input type="hidden" name="token" value={token} />
          <Field name="password" label="New password" type="password" autoComplete="new-password" minLength={15} maxLength={128} required error={state.errors?.password?.[0]} hint="Use 15 or more characters." />
          <Field name="confirmPassword" label="Confirm new password" type="password" autoComplete="new-password" maxLength={128} required error={state.errors?.confirmPassword?.[0]} />
        </>}
      <button className="public-button auth-submit" type="submit" disabled={pending}>
        {pending ? <><LoaderCircle className="auth-spinner" /> Working…</> : <>{mode === "request" ? "Send the link" : "Set my new password"}<ArrowRight /></>}</button>
    </form>
    <p className="auth-switch"><Link href="/sign-in">Back to sign-in <ArrowRight /></Link></p>
  </div>;
}
