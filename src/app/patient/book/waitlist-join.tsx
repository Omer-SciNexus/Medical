"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Check, Hourglass, Loader2 } from "lucide-react";
import { Button, Field, Textarea } from "@/components/ui/primitives";
import { idleAction } from "@/lib/action-state";
import { joinWaitlistAction } from "@/app/patient/actions";

/** Opens by itself when there are no times to choose from, since it is then the only way forward. */
export function WaitlistJoin({ providerId, providerName, noTimes, initialReason }: { providerId: string; providerName: string; noTimes: boolean; initialReason: string }) {
  const [state, join, pending] = useActionState(joinWaitlistAction, idleAction);
  if (state.ok) return <div className="booking-confirmed" role="status"><Check /><div>
    <strong>You are on the waiting list for {providerName}</strong>
    <p>If a time opens up we will email you and show it on your appointments page. The first person to accept gets it.</p>
    <Link className="public-inline-link" href="/patient/appointments">See your appointments</Link></div></div>;
  return <details className="waitlist-join" open={noTimes}>
    <summary><Hourglass /> {noTimes ? "Join the waiting list" : "None of these times suit you? Join the waiting list"}</summary>
    <form action={join}>
      <input type="hidden" name="providerId" value={providerId} />
      <Field label="What would you like to be seen about?" id="waitlist-reason" error={state.errors?.reason?.[0]} hint="If someone cancels, we will offer you their time.">
        <Textarea id="waitlist-reason" name="reason" rows={2} required minLength={3} maxLength={200} defaultValue={state.values?.reason ?? initialReason} />
      </Field>
      {state.error ? <p className="field-error" role="alert">{state.error}</p> : null}
      <Button type="submit" variant="secondary" size="small" disabled={pending}>{pending ? <Loader2 /> : <Hourglass />}Tell me when a time opens</Button>
    </form>
  </details>;
}
