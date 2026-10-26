"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, CheckCheck, Copy, Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import { acceptInviteAction, signInAction, signUpAction, verifyAction } from "@/app/(auth)/actions";
import { AuthenticatorQr } from "./authenticator-qr";
import { initialAuthState, type AuthFormState } from "@/lib/auth-form-state";

export type AuthMode = "sign-in" | "sign-up" | "accept-invite";
export type Invitation = { displayName: string; email: string; role: string; token: string };

function FormField({ name, label, error, hint, ...props }: React.ComponentProps<"input"> & { name: string; label: string; error?: string; hint?: string }) {
  const [visible, setVisible] = useState(false);
  const password = props.type === "password";
  return <div className="auth-field"><label htmlFor={name}>{label}</label><div className="auth-input-wrap"><input {...props} id={name} name={name} type={password && visible ? "text" : props.type} className={password ? "auth-input auth-password-input" : "auth-input"} aria-invalid={Boolean(error)} aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined} />{password && <button className="password-toggle" type="button" onClick={() => setVisible(!visible)} aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`} aria-pressed={visible}>{visible ? <EyeOff /> : <Eye />}</button>}</div>{error ? <p className="auth-field-error" id={`${name}-error`}>{error}</p> : hint ? <p className="auth-field-hint" id={`${name}-hint`}>{hint}</p> : null}</div>;
}

function CredentialFields({ mode, errors, pending, invitation }: { mode: AuthMode; errors: AuthFormState["errors"]; pending: boolean; invitation?: Invitation }) {
  const [values, setValues] = useState<Record<string, string>>({});
  function field(name: string) { return { name, value: values[name] ?? "", onChange: (event: React.ChangeEvent<HTMLInputElement>) => setValues({ ...values, [name]: event.target.value }), error: errors?.[name]?.[0], disabled: pending }; }
  const signup = mode === "sign-up";
  const invited = mode === "accept-invite";
  // On an invitation the clinic, role, name and address come from the invitation record alone:
  // they are shown for confirmation and never submitted back.
  const newPassword = signup || invited;
  return <>{invited && invitation ? <><input type="hidden" name="token" value={invitation.token} />
    <dl className="auth-invitation"><div><dt>Name</dt><dd>{invitation.displayName}</dd></div><div><dt>Email</dt><dd>{invitation.email}</dd></div><div><dt>Role</dt><dd>{invitation.role}</dd></div></dl></> : null}
    {signup && <><FormField {...field("displayName")} label="Full name" type="text" autoComplete="name" placeholder="Alex Morgan" required maxLength={100} /><FormField {...field("clinicName")} label="Clinic name" type="text" autoComplete="organization" placeholder="Your clinic or practice" required maxLength={120} /></>}
    {!invited && <FormField {...field("email")} label="Email address" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="you@yourclinic.com" maxLength={254} required />}
    <FormField {...field("password")} label="Password" type="password" autoComplete={newPassword ? "new-password" : "current-password"} placeholder={newPassword ? "Create a strong password" : "Enter your password"} minLength={newPassword ? 15 : 1} maxLength={newPassword ? 128 : 256} required hint={newPassword ? "Use 15 or more characters. A memorable passphrase works well." : undefined} />
    {mode === "sign-in" && <Link href="/forgot-password" prefetch={false} className="auth-forgot-link">Forgot password?</Link>}
    {newPassword && <FormField {...field("confirmPassword")} label="Confirm password" type="password" autoComplete="new-password" placeholder="Enter your password again" maxLength={128} required />}</>;
}

export function AuthForm({ mode, configured, invitation }: { mode: AuthMode; configured: boolean; invitation?: Invitation }) {
  const [state, action, pending] = useActionState(async (previous: AuthFormState, data: FormData): Promise<AuthFormState> => {
    const credentialAction = mode === "sign-up" ? signUpAction : mode === "accept-invite" ? acceptInviteAction : signInAction;
    const result = previous.step === "credentials" ? await credentialAction(previous, data) : await verifyAction(previous, data);
    const enrolling = result.step === "enroll_mfa";
    return { ...result, secret: enrolling ? result.secret ?? previous.secret : undefined, provisioningUri: enrolling ? result.provisioningUri ?? previous.provisioningUri : undefined };
  }, initialAuthState);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [code, setCode] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const previousStep = useRef(state.step);
  useEffect(() => {
    if (state.errors) { const first = Object.keys(state.errors)[0]; document.getElementById(first)?.focus(); }
    else if (state.error) feedback.current?.focus();
    else if (previousStep.current !== state.step) heading.current?.focus();
    previousStep.current = state.step;
  }, [state]);
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setCopied(true); } catch { setCopied(false); }
  }
  const signup = mode === "sign-up";
  const invited = mode === "accept-invite";
  const credentials = state.step === "credentials";
  const enrolling = state.step === "enroll_mfa";
  const recovery = state.step === "recovery_codes";
  const title = recovery ? "Keep these somewhere safe." : enrolling ? "A little extra protection." : !credentials ? "One more step. It’s you."
    : invited ? "Set up your account." : signup ? "A fresh start for your clinic." : "Good to have you back.";
  return <div className="auth-content">
    <div className="auth-title-icon">{recovery ? <CheckCheck /> : credentials ? <LockKeyhole /> : <ShieldCheck />}</div>
    <span className="public-eyebrow">{recovery ? "RECOVERY CODES / YOUR BACKUP PLAN" : !credentials ? "ACCOUNT SECURITY / VERIFY YOUR IDENTITY" : invited ? "JOIN YOUR CLINIC WORKSPACE" : signup ? "CREATE YOUR WORKSPACE" : "WELCOME TO MERIDIAN"}</span>
    <h1 ref={heading} tabIndex={-1}>{title}</h1>
    <p className="auth-description">{recovery ? "Each recovery code works once. Save them in your password manager before you continue." : enrolling ? "Connect an authenticator app to keep your clinic workspace protected." : !credentials ? "Enter the code from your authenticator app to open your workspace." : invited ? "Your administrator has already set your name and role. Choose a password, then connect an authenticator." : signup ? "Start with your details. Then secure your account and make yourself at home." : "Sign in to your account and pick up where you left off."}</p>
    {credentials && signup && <div className="auth-entry-note"><strong>For clinic owners and administrators</strong><p>Joining an existing clinic? <Link href="/sign-in" prefetch={false}>Sign in to your clinic</Link> or ask your clinic for an invitation.</p></div>}
    {(signup || invited || enrolling || recovery) && <ol className="auth-steps" aria-label="Account setup steps"><li aria-current={credentials ? "step" : undefined}><span>1</span> {invited ? "Your password" : "Your details"}</li><li aria-current={!credentials && !recovery ? "step" : undefined}><span>2</span> Secure account</li><li aria-current={recovery ? "step" : undefined}><span>3</span> Save recovery codes</li></ol>}
    {credentials && !configured && <div className="auth-availability" role="status">Account services are being connected. You can explore the preview while sign-in and registration are unavailable.</div>}
    {state.error && <div className="auth-error" role="alert" tabIndex={-1} ref={feedback}>{state.error}</div>}
    {recovery ? <div className="auth-recovery"><div className="recovery-code-grid">{state.recoveryCodes?.map((value) => <code key={value}>{value}</code>)}</div><button type="button" className="auth-copy-button" onClick={() => copy(state.recoveryCodes?.join("\n") ?? "")}>{copied ? <Check /> : <Copy />}{copied ? "Copied to clipboard" : "Copy recovery codes"}</button><label className="auth-checkbox"><input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />I’ve saved my recovery codes somewhere safe.</label>{saved ? <Link className="public-button auth-submit" href="/dashboard">Open your workspace <ArrowRight /></Link> : <button className="public-button auth-submit" disabled>Open your workspace <ArrowRight /></button>}</div> : <form action={action} noValidate aria-busy={pending} className="auth-form">
      {credentials ? <CredentialFields mode={mode} errors={state.errors} pending={pending} invitation={invitation} /> : <>
        {enrolling && <div className="auth-setup"><h2><KeyRound /> Connect your authenticator</h2><AuthenticatorQr uri={state.provisioningUri} /><ol><li>Open your authenticator app and add an account.</li><li>Scan the QR code, or enter the setup key manually. Name it <strong>Meridian</strong>, paste this key, and select <strong>time-based</strong>.</li></ol><div className="auth-setup-key"><code aria-label="Authenticator setup key">{state.secret}</code><button type="button" aria-label={copied ? "Setup key copied" : "Copy setup key"} onClick={() => copy(state.secret ?? "")}>{copied ? <Check /> : <Copy />}</button></div><p>Then enter the six-digit code shown in your app.</p></div>}
        <FormField name="code" label={recoveryMode ? "Recovery code" : "Authenticator code"} type="text" inputMode={recoveryMode ? "text" : "numeric"} autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder={recoveryMode ? "XXXXXXXX-XXXXXXXX" : "000000"} maxLength={recoveryMode ? 17 : 6} disabled={pending} required hint={recoveryMode ? "Each recovery code can only be used once." : "Codes refresh every 30 seconds. This verification step lasts 5 minutes."} />
        {!enrolling && <button type="button" className="auth-small-link" onClick={() => { setRecoveryMode(!recoveryMode); setCode(""); }}>{recoveryMode ? "Use my authenticator app instead" : "Use a recovery code instead"}</button>}
      </>}
      <button className="public-button auth-submit" type="submit" disabled={pending}>{pending ? <><LoaderCircle className="auth-spinner" /> {credentials ? invited ? "Creating your account…" : signup ? "Creating your workspace…" : "Signing you in…" : "Verifying…"}</> : <>{credentials ? invited ? "Create my account" : signup ? "Create your workspace" : "Sign in" : enrolling ? "Verify & secure account" : "Verify & sign in"}<ArrowRight /></>}</button>
      {credentials && signup && <p className="auth-form-note"><ShieldCheck /> Your new workspace is separate from other clinics. Authenticator setup is required next.</p>}
      {credentials && invited && <p className="auth-form-note"><ShieldCheck /> This link works once and expires on its own. Authenticator setup is required next.</p>}
    </form>}
    {credentials && invited ? <details className="auth-help"><summary>Not expecting this invitation?</summary><p>Close this page and tell the person who sent it. The link is single-use, expires on its own, and nothing is created until you choose a password.</p></details>
      : credentials ? <><p className="auth-switch">{signup ? "Already have an account?" : "New to Meridian?"} <Link href={signup ? "/sign-in" : "/sign-up"}>{signup ? "Sign in" : "Create a workspace"} <ArrowRight /></Link></p><details className="auth-help"><summary>{signup ? "Joining an existing clinic?" : "Need help signing in?"}</summary><p>{signup ? "Use your existing clinic account to sign in. Creating a new workspace does not give you access to another clinic’s patient records." : <>If you’ve lost access to your authenticator, use a saved recovery code after entering your password, then restart enrolment from your account&rsquo;s security page. Forgotten your password? <Link href="/forgot-password" prefetch={false}>Reset it by email</Link>. For a missing account, contact your clinic administrator.</>}</p></details></> : !recovery ? <p className="auth-switch"><a href="/sign-in">Start again with sign-in</a></p> : null}
    <span className="auth-copy-status" role="status">{copied ? "Copied to clipboard." : ""}</span>
  </div>;
}
