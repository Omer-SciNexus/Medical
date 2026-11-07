"use client";

import { useActionState } from "react";
import Link from "next/link";
import { CalendarClock, CalendarPlus, Check, Hourglass, Loader2, Sparkles, X } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { idleAction } from "@/lib/action-state";
import { acceptOfferAction, leaveWaitlistAction } from "@/app/patient/actions";

export type OpenOffer = { id: string; providerName: string; day: string; time: string; movesVisit: boolean };
export type PlannedFollowUp = { id: string; providerId: string; providerName: string; due: string; overdue: boolean; note: string | null };
export type WaitingPlace = { id: string; providerName: string; reason: string; movesVisit: boolean };

/** Everything the clinic is waiting on this patient for, above the list of what is already booked. */
export function NextSteps({ offers, followUps, waiting }: { offers: OpenOffer[]; followUps: PlannedFollowUp[]; waiting: WaitingPlace[] }) {
  const [acceptState, accept, acceptPending] = useActionState(acceptOfferAction, idleAction);
  const [leaveState, leave, leavePending] = useActionState(leaveWaitlistAction, idleAction);
  const error = acceptState.error ?? leaveState.error;
  return <>
    {error ? <p className="field-error" role="alert" style={{ marginBottom: 14 }}>{error}</p> : null}
    {acceptState.ok && acceptState.notice ? <div className="booking-confirmed" role="status" style={{ marginTop: 0, marginBottom: 18 }}><Check /><div><strong>{acceptState.notice}</strong></div></div> : null}

    {offers.length ? <section className="section">
      <div className="section-header"><div className="section-heading"><div>
        <span className="eyebrow icon-label"><Sparkles /> Good news</span>
        <h2 style={{ marginTop: 6 }}>A time has opened up</h2>
        <p className="section-description">Someone else&rsquo;s plans changed. Each time goes to the first person to accept it.</p></div></div></div>
      <ul className="appointment-list">{offers.map((offer) => <li key={offer.id}>
        <div className="appointment-head">
          <div><strong>{offer.day} at {offer.time}</strong>
            <p className="appointment-meta">{offer.providerName}{offer.movesVisit ? " · This replaces your later visit, and frees that time for someone else." : ""}</p></div>
          <form action={accept}><input type="hidden" name="offerId" value={offer.id} />
            <Button type="submit" size="small" disabled={acceptPending}>{acceptPending ? <Loader2 /> : <Check />}Take this time</Button></form>
        </div>
      </li>)}</ul>
    </section> : null}

    {followUps.length ? <section className="section">
      <div className="section-header"><div className="section-heading"><div>
        <span className="eyebrow icon-label"><CalendarClock /> From your clinician</span>
        <h2 style={{ marginTop: 6 }}>Time to book your follow-up</h2></div></div></div>
      <ul className="appointment-list">{followUps.map((followUp) => <li key={followUp.id}>
        <div className="appointment-head">
          <div><strong>{followUp.providerName} would like to see you again</strong>
            <p className="appointment-meta">By {followUp.due}</p>
            {followUp.note ? <p className="appointment-meta">About: {followUp.note}</p> : null}</div>
          {followUp.overdue ? <Badge tone="high">Overdue</Badge> : null}
        </div>
        <div className="row-actions" style={{ marginTop: 10 }}>
          <Link className="button button-primary button-small" href={`/patient/book?providerId=${followUp.providerId}&followUp=${followUp.id}`}><CalendarPlus />Choose a time</Link>
        </div>
      </li>)}</ul>
    </section> : null}

    {waiting.length ? <section className="section">
      <div className="section-header"><div className="section-heading"><div>
        <span className="eyebrow icon-label"><Hourglass /> Waiting list</span>
        <h2 style={{ marginTop: 6 }}>You are on the waiting list</h2>
        <p className="section-description">When a time opens up we will email you and show it here.</p></div></div></div>
      <ul className="appointment-list">{waiting.map((place) => <li key={place.id}>
        <div className="appointment-head">
          <div><strong>{place.providerName}</strong>
            <p className="appointment-meta">{place.movesVisit ? "Looking for an earlier time for your visit" : "Looking for a first time"} · {place.reason}</p></div>
          <form action={leave}><input type="hidden" name="entryId" value={place.id} />
            <Button type="submit" size="small" variant="ghost" disabled={leavePending}><X />Leave the list</Button></form>
        </div>
      </li>)}</ul>
    </section> : null}
  </>;
}
