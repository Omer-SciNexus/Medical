"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, CalendarX, Check, Loader2, TriangleAlert } from "lucide-react";
import { Button, Field, Textarea } from "@/components/ui/primitives";
import { idleAction } from "@/lib/action-state";
import { bookAppointmentAction } from "@/app/patient/actions";

type Slot = { id: string; startsAt: string; endsAt: string };

export function Booking({ providerId, providerName, slots, timeZone }: { providerId: string; providerName: string; slots: Slot[]; timeZone: string }) {
  const router = useRouter();
  const [state, book, pending] = useActionState(bookAppointmentAction, idleAction);
  const [slotId, setSlotId] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const taken = state.code === "slot_taken";

  // On a conflict the chosen provider and reason are kept; only the time is released and the
  // server's availability is re-fetched so the next choice is from a current list.
  React.useEffect(() => {
    if (!taken) return;
    setSlotId(null);
    router.refresh();
  }, [taken, state.savedAt, router]);
  React.useEffect(() => { if (state.values?.reason && !reason) setReason(state.values.reason); }, [state.values?.reason, reason]);

  const dayFormat = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" });
  const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const byDay = slots.reduce<Map<string, Slot[]>>((groups, slot) => {
    const key = dayFormat.format(new Date(slot.startsAt));
    groups.set(key, [...(groups.get(key) ?? []), slot]);
    return groups;
  }, new Map());
  const selected = slots.find((slot) => slot.id === slotId) ?? null;

  return <form action={book} className="booking-form">
    <input type="hidden" name="providerId" value={providerId} />
    <input type="hidden" name="slotId" value={slotId ?? ""} />

    <Field label="What would you like to be seen about?" id="reason" error={state.errors?.reason?.[0]} hint="A short description helps your clinician prepare. 3 to 200 characters.">
      <Textarea id="reason" name="reason" rows={3} required minLength={3} maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} />
    </Field>

    <div className="booking-times" role="radiogroup" aria-label="Available appointment times">
      <h3>Choose a time with {providerName}</h3>
      {taken ? <p className="booking-alert" role="alert"><TriangleAlert /> {state.error} Your reason has been kept.</p> : null}
      {!slots.length ? <p className="booking-empty"><CalendarX /> No times are open with this clinician in the next three weeks. Try another clinician.</p>
        : [...byDay.entries()].map(([day, daySlots]) => <div key={day} className="booking-day">
          <span className="eyebrow">{day}</span>
          <div className="time-options">
            {daySlots.map((slot) => <label key={slot.id} className="time-option" data-selected={slot.id === slotId}><input className="sr-only" type="radio" name="selectedTime" value={slot.id} checked={slot.id === slotId} onChange={() => setSlotId(slot.id)} aria-label={`${day} at ${timeFormat.format(new Date(slot.startsAt))}`} />{timeFormat.format(new Date(slot.startsAt))}</label>)}
          </div>
        </div>)}
    </div>

    <div className="booking-review">
      <span className="eyebrow">Review and confirm</span>
      {selected ? <>
        <h4>{dayFormat.format(new Date(selected.startsAt))} at {timeFormat.format(new Date(selected.startsAt))}</h4>
        <p>With {providerName}. Times are shown in {timeZone}.</p>
        <p className="booking-detail"><Check /> Nothing is booked until you confirm.</p>
      </> : <p>Pick a time above to see it here before anything is booked.</p>}
      {state.error && !taken ? <p className="field-error" role="alert">{state.error}</p> : null}
      <Button type="submit" disabled={!selected || pending || reason.trim().length < 3}>
        {pending ? <Loader2 /> : <CalendarCheck />} Confirm this appointment</Button>
    </div>
  </form>;
}
