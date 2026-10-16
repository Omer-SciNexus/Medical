"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { CalendarCheck, CalendarX, Clock, Info, Loader2, UserRound } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { idleAction } from "@/lib/action-state";
import { cancelAppointmentAction, rescheduleAppointmentAction } from "@/app/patient/actions";

type Appointment = { id: string; reason: string; preparation: string; status: string; revision: number; providerId: string; startsAt: string; endsAt: string };
type Slot = { id: string; startsAt: string; endsAt: string };

const statusTone = (status: string) => status === "cancelled" || status === "no_show" ? "critical" : status === "done" ? "neutral" : "accent";
const dayLabel = (iso: string, timeZone: string) => new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
const timeLabel = (iso: string, timeZone: string) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

export function Appointments({ appointments, providers, moving, options, timeZone }: {
  appointments: Appointment[]; providers: { id: string; displayName: string }[];
  moving: { id: string; revision: number; providerId: string } | null; options: Slot[]; timeZone: string;
}) {
  const [cancelState, cancel, cancelPending] = useActionState(cancelAppointmentAction, idleAction);
  const [moveState, reschedule, movePending] = useActionState(rescheduleAppointmentAction, idleAction);
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const error = [cancelState, moveState].find((state) => state.error)?.error;
  const nameOf = (providerId: string) => providers.find((provider) => provider.id === providerId)?.displayName ?? "Your clinician";
  const now = Date.now();
  const upcoming = appointments.filter((appointment) => Date.parse(appointment.startsAt) > now && appointment.status !== "cancelled" && appointment.status !== "done");
  const past = appointments.filter((appointment) => !upcoming.includes(appointment));

  return <>
    {error ? <p className="field-error" role="alert" style={{ marginBottom: 14 }}>{error}</p> : null}

    <section className="section">
      <div className="section-header"><div className="section-heading"><div>
        <span className="eyebrow icon-label"><CalendarCheck /> Coming up</span>
        <h2 style={{ marginTop: 6 }}>{upcoming.length ? `${upcoming.length} upcoming ${upcoming.length === 1 ? "visit" : "visits"}` : "Nothing booked"}</h2></div></div></div>
      {!upcoming.length ? <p className="booking-empty"><Info /> You have no upcoming appointments. <Link href="/patient/book">Book a visit</Link>.</p>
        : <ul className="appointment-list">{upcoming.map((appointment) => <li key={appointment.id}>
          <div className="appointment-head">
            <div>
              <strong>{dayLabel(appointment.startsAt, timeZone)}</strong>
              <p className="appointment-time"><Clock /> {timeLabel(appointment.startsAt, timeZone)}&ndash;{timeLabel(appointment.endsAt, timeZone)} · {timeZone}</p>
              <p className="appointment-meta"><UserRound /> {nameOf(appointment.providerId)} · {appointment.reason}</p>
            </div>
            <Badge tone={statusTone(appointment.status)}>{appointment.status.replace("_", " ")}</Badge>
          </div>
          {appointment.preparation ? <p className="appointment-prep"><Info /> {appointment.preparation}</p> : null}
          {appointment.status === "booked" ? <div className="row-actions">
            {moving?.id === appointment.id
              ? <span className="field-hint">Choose a new time below.</span>
              : <Link className="button button-secondary button-small" href={`/patient/appointments?move=${appointment.id}`}><CalendarCheck />Move this visit</Link>}
            {/* Two steps on purpose: cancelling frees the time for someone else immediately. */}
            {confirming === appointment.id ? <form action={cancel} className="row-actions">
              <input type="hidden" name="appointmentId" value={appointment.id} /><input type="hidden" name="revision" value={appointment.revision} />
              <Button type="submit" size="small" variant="danger" disabled={cancelPending}>{cancelPending ? <Loader2 /> : <CalendarX />}Yes, cancel it</Button>
              <Button type="button" size="small" variant="ghost" onClick={() => setConfirming(null)}>Keep it</Button>
            </form> : <Button type="button" size="small" variant="ghost" onClick={() => setConfirming(appointment.id)}><CalendarX />Cancel</Button>}
          </div> : null}
        </li>)}</ul>}
    </section>

    {moving ? <section className="section">
      <div className="section-header"><div className="section-heading"><div>
        <span className="eyebrow icon-label"><Clock /> New time</span>
        <h2 style={{ marginTop: 6 }}>Pick a new time with {nameOf(moving.providerId)}</h2>
        <p className="section-description">Your old time is released the moment the new one is taken, in a single step, so you can never lose both.</p></div></div></div>
      {!options.length ? <p className="booking-empty"><Info /> {nameOf(moving.providerId)} has no other open times at the moment. <Link href="/patient/book">Book with someone else</Link>.</p>
        : <div className="booking-times">{options.map((slot) => <form key={slot.id} action={reschedule}>
          <input type="hidden" name="appointmentId" value={moving.id} /><input type="hidden" name="revision" value={moving.revision} /><input type="hidden" name="slotId" value={slot.id} />
          <button type="submit" className="slot-button" disabled={movePending}>
            <span>{dayLabel(slot.startsAt, timeZone)}</span><strong>{timeLabel(slot.startsAt, timeZone)}</strong>
          </button>
        </form>)}</div>}
      <p className="account-preview-note"><Link href="/patient/appointments">Keep my current time</Link></p>
    </section> : null}

    {past.length ? <section className="section">
      <div className="section-header"><div className="section-heading"><div>
        <span className="eyebrow icon-label"><Clock /> Already happened</span><h2 style={{ marginTop: 6 }}>Past visits</h2></div></div></div>
      <ul className="appointment-list appointment-list-past">{past.map((appointment) => <li key={appointment.id}>
        <div className="appointment-head">
          <div><strong>{dayLabel(appointment.startsAt, timeZone)}</strong>
            <p className="appointment-meta">{timeLabel(appointment.startsAt, timeZone)} · {nameOf(appointment.providerId)} · {appointment.reason}</p></div>
          <Badge tone={statusTone(appointment.status)}>{appointment.status.replace("_", " ")}</Badge>
        </div>
      </li>)}</ul>
    </section> : null}
  </>;
}
