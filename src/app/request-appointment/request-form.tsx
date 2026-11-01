"use client";

import { useActionState } from "react";
import { ArrowRight, CalendarPlus, LoaderCircle, MailCheck } from "lucide-react";
import { idleAction } from "@/lib/action-state";
import { submitAppointmentRequestAction } from "./actions";

type FieldProps = { name: string; label: string; error?: string; hint?: string; defaultValue?: string };
function Field({ name, label, error, hint, multiline, ...props }: FieldProps & { multiline?: boolean } & React.ComponentProps<"input"> & React.ComponentProps<"textarea">) {
  const shared = { id: name, name, className: "auth-input", "aria-invalid": Boolean(error) };
  return <div className="auth-field"><label htmlFor={name}>{label}</label>
    {multiline ? <textarea {...(props as React.ComponentProps<"textarea">)} {...shared} rows={3} /> : <input {...(props as React.ComponentProps<"input">)} {...shared} />}
    {error ? <p className="auth-field-error">{error}</p> : hint ? <p className="auth-field-hint">{hint}</p> : null}</div>;
}

export function RequestForm({ clinicId, clinicName }: { clinicId: string; clinicName: string }) {
  const [state, action, pending] = useActionState(submitAppointmentRequestAction, idleAction);
  const error = (name: string) => state.errors?.[name]?.[0];
  const value = (name: string) => state.values?.[name];

  if (state.ok) return <div className="auth-content">
    <div className="auth-title-icon"><MailCheck /></div>
    <span className="public-eyebrow">CHECK YOUR EMAIL</span>
    <h1>One more step.</h1>
    <p className="auth-description">We&rsquo;ve sent a link to the address you gave. Open it within 24 hours to send your request to {clinicName}. Until you do, the clinic doesn&rsquo;t receive it.</p>
  </div>;

  return <div className="auth-content">
    <div className="auth-title-icon"><CalendarPlus /></div>
    <span className="public-eyebrow">{clinicName.toUpperCase()}</span>
    <h1>Request an appointment.</h1>
    <p className="auth-description">Tell the clinic who you are and what you&rsquo;d like to be seen about. They&rsquo;ll set you up and send you a link to choose a time. Nothing is booked yet.</p>
    {state.error ? <div className="auth-error" role="alert">{state.error}</div> : null}
    <form action={action} noValidate aria-busy={pending} className="auth-form">
      <input type="hidden" name="clinicId" value={clinicId} />
      <div className="auth-field-row">
        <Field name="givenName" label="Given name" autoComplete="given-name" maxLength={80} required defaultValue={value("givenName")} error={error("givenName")} />
        <Field name="surname" label="Surname" autoComplete="family-name" maxLength={80} required defaultValue={value("surname")} error={error("surname")} />
      </div>
      <Field name="birthDate" label="Date of birth" type="date" autoComplete="bday" required defaultValue={value("birthDate")} error={error("birthDate")} hint="Helps the clinic find any record they already hold for you." />
      <Field name="contactEmail" label="Email address" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} required defaultValue={value("contactEmail")} error={error("contactEmail")} hint="We'll send a confirmation link here." />
      <Field name="contactPhone" label="Phone (optional)" type="tel" autoComplete="tel" maxLength={32} defaultValue={value("contactPhone")} error={error("contactPhone")} />
      <Field name="reason" label="What would you like to be seen about?" multiline maxLength={200} required defaultValue={value("reason")} error={error("reason")} hint="A short description, 3 to 200 characters." />
      <Field name="preferredTimes" label="When suits you? (optional)" multiline maxLength={300} placeholder="For example: weekday mornings, or after 5pm" defaultValue={value("preferredTimes")} error={error("preferredTimes")} />
      <button className="public-button auth-submit" type="submit" disabled={pending}>
        {pending ? <><LoaderCircle className="auth-spinner" /> Sending…</> : <>Send my request<ArrowRight /></>}</button>
    </form>
  </div>;
}
