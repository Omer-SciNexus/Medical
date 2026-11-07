"use client";

import Link from "next/link";
import { CalendarClock, CalendarPlus } from "lucide-react";
import { Badge } from "@/components/ui/primitives";

export type PlannedFollowUp = { id: string; providerId: string; providerName: string; due: string; overdue: boolean; note: string | null };

/** Everything the clinic is waiting on this patient for, above the list of what is already booked. */
export function NextSteps({ followUps }: { followUps: PlannedFollowUp[] }) {
  return <>
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
  </>;
}
