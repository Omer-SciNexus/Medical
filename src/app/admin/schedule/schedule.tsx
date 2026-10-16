"use client";

import * as React from "react";
import { useActionState } from "react";
import { CalendarOff, CalendarPlus, Clock, Loader2, Plus, Trash2, Wand2 } from "lucide-react";
import { Badge, Button, Field, Input } from "@/components/ui/primitives";
import { idleAction } from "@/lib/action-state";
import { addBlackoutAction, addTemplateAction, extendScheduleAction, removeBlackoutAction, removeTemplateAction } from "@/app/admin/actions";

type Provider = { id: string; displayName: string };
type Template = { id: string; providerId: string; weekday: number; startMinute: number; endMinute: number; slotMinutes: number };
type Blackout = { id: string; providerId: string | null; startsAt: string; endsAt: string; reason: string };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const slotCount = (template: Template) => (template.endMinute - template.startMinute) / template.slotMinutes;

export function Schedule({ providers, templates, blackouts, timeZone }: { providers: Provider[]; templates: Template[]; blackouts: Blackout[]; timeZone: string }) {
  const [selected, setSelected] = React.useState(providers[0]?.id ?? "");
  const [addState, addTemplate, addPending] = useActionState(addTemplateAction, idleAction);
  const [removeState, removeTemplate, removePending] = useActionState(removeTemplateAction, idleAction);
  const [extendState, extend, extendPending] = useActionState(extendScheduleAction, idleAction);
  const [blackoutState, addBlackout, blackoutPending] = useActionState(addBlackoutAction, idleAction);
  const [liftState, removeBlackout, liftPending] = useActionState(removeBlackoutAction, idleAction);
  const states = [addState, removeState, extendState, blackoutState, liftState];
  const error = states.find((state) => state.error)?.error;
  const notice = [extendState, blackoutState].find((state) => state.notice)?.notice;
  const pending = addPending || removePending || extendPending || blackoutPending || liftPending;
  const nameOf = (id: string | null) => id === null ? "Whole clinic" : providers.find((provider) => provider.id === id)?.displayName ?? "A former colleague";
  const mine = templates.filter((template) => template.providerId === selected);
  const weekly = mine.reduce((total, template) => total + slotCount(template), 0);

  return <>
    <div className="provider-tabs" role="tablist" aria-label="Clinicians">
      {providers.map((provider) => <button key={provider.id} role="tab" type="button" className="shortcut-button" aria-selected={provider.id === selected}
        data-active={provider.id === selected} onClick={() => setSelected(provider.id)}>{provider.displayName}</button>)}
    </div>
    {error ? <p className="field-error" role="alert" style={{ marginBottom: 14 }}>{error}</p> : null}
    {notice ? <p className="field-hint" role="status" style={{ marginBottom: 14 }}>{notice}</p> : null}

    <form action={addTemplate} className="admin-form schedule-form" aria-busy={addPending}>
      <input type="hidden" name="providerId" value={selected} />
      <Field label="Day" id="weekday" error={addState.errors?.weekday?.[0]}>
        <select id="weekday" name="weekday" className="input" defaultValue={addState.values?.weekday ?? "1"}>
          {WEEKDAYS.map((label, index) => <option key={label} value={index}>{label}</option>)}
        </select></Field>
      <Field label="From" id="start" error={addState.errors?.start?.[0]}><Input id="start" name="start" type="time" step={300} defaultValue={addState.values?.start ?? "09:00"} required /></Field>
      <Field label="To" id="end" error={addState.errors?.end?.[0]}><Input id="end" name="end" type="time" step={300} defaultValue={addState.values?.end ?? "12:00"} required /></Field>
      <Field label="Appointment length" id="slotMinutes" error={addState.errors?.slotMinutes?.[0]}>
        <select id="slotMinutes" name="slotMinutes" className="input" defaultValue={addState.values?.slotMinutes ?? "20"}>
          {[10, 15, 20, 30, 45, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
        </select></Field>
      <div className="admin-form-actions">
        <Button type="submit" disabled={pending || !selected}>{addPending ? <Loader2 /> : <Plus />}Add weekly session</Button>
        <span className="field-hint">Times are local to the clinic ({timeZone}). The session must divide evenly into appointments.</span>
      </div>
    </form>

    <div className="specimen" style={{ marginBottom: 22 }}>
      <div className="specimen-topline"><strong>Weekly pattern</strong><span>{mine.length ? `${weekly} appointments a week` : "Nothing scheduled yet"}</span></div>
      {!mine.length ? <div className="state-panel" style={{ textAlign: "center", minHeight: 0, padding: "32px 24px" }}>
        <p className="empty-state-icon"><Clock /></p><h3>No weekly sessions</h3><p>Add one above. Nothing can be booked until a session exists and has been opened into appointment times.</p>
      </div> : <div className="table-scroll">
        <table className="clinical-table">
          <caption className="sr-only">Weekly sessions for the selected clinician</caption>
          <thead><tr><th scope="col">Day</th><th scope="col">Session</th><th scope="col">Appointment length</th><th scope="col">Appointments</th><th scope="col">Actions</th></tr></thead>
          <tbody>{mine.map((template) => <tr key={template.id}>
            <td>{WEEKDAYS[template.weekday]}</td>
            <td className="mono">{clock(template.startMinute)}&ndash;{clock(template.endMinute)}</td>
            <td>{template.slotMinutes} min</td>
            <td className="numeric">{slotCount(template)}</td>
            <td><form action={removeTemplate}><input type="hidden" name="templateId" value={template.id} />
              <Button type="submit" size="small" variant="ghost" disabled={pending}><Trash2 />Remove</Button></form></td>
          </tr>)}</tbody>
        </table>
      </div>}
      <div className="queue-footer">
        <span>Removing a session stops future times being generated; times already open stay bookable until a blackout withdraws them.</span>
        <form action={extend}><input type="hidden" name="providerId" value={selected} /><input type="hidden" name="weeks" value="4" />
          <Button type="submit" variant="secondary" size="small" disabled={pending || !mine.length}>{extendPending ? <Loader2 /> : <Wand2 />}Open the next four weeks</Button></form>
      </div>
    </div>

    <form action={addBlackout} className="admin-form schedule-form" aria-busy={blackoutPending}>
      <Field label="Applies to" id="blackoutProvider">
        <select id="blackoutProvider" name="providerId" className="input" defaultValue={blackoutState.values?.providerId ?? ""}>
          <option value="">Whole clinic</option>
          {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName}</option>)}
        </select></Field>
      <Field label="First day" id="day" error={blackoutState.errors?.day?.[0]}><Input id="day" name="day" type="date" defaultValue={blackoutState.values?.day} required /></Field>
      <Field label="Last day" id="endDay" error={blackoutState.errors?.endDay?.[0]} hint="Leave empty for a single day."><Input id="endDay" name="endDay" type="date" defaultValue={blackoutState.values?.endDay} /></Field>
      <Field label="Reason" id="reason" error={blackoutState.errors?.reason?.[0]} className="field-full"><Input id="reason" name="reason" defaultValue={blackoutState.values?.reason} placeholder="Public holiday" maxLength={200} required /></Field>
      <div className="admin-form-actions">
        <Button type="submit" variant="secondary" disabled={pending}>{blackoutPending ? <Loader2 /> : <CalendarOff />}Close these days</Button>
        <span className="field-hint">Open times inside a blackout are withdrawn. A time with a booked appointment is kept and reported, so nobody is cancelled silently.</span>
      </div>
    </form>

    <div className="specimen">
      <div className="specimen-topline"><strong>Blackouts</strong><span>{blackouts.length} upcoming</span></div>
      {!blackouts.length ? <div className="state-panel" style={{ textAlign: "center", minHeight: 0, padding: "32px 24px" }}>
        <p className="empty-state-icon"><CalendarPlus /></p><h3>No blackouts</h3><p>Holidays and leave go here. Generating times skips anything inside a blackout.</p>
      </div> : <div className="table-scroll">
        <table className="clinical-table">
          <caption className="sr-only">Upcoming blackouts</caption>
          <thead><tr><th scope="col">Applies to</th><th scope="col">From</th><th scope="col">Until</th><th scope="col">Reason</th><th scope="col">Actions</th></tr></thead>
          <tbody>{blackouts.map((blackout) => <tr key={blackout.id}>
            <td>{blackout.providerId === null ? <Badge tone="accent">Whole clinic</Badge> : nameOf(blackout.providerId)}</td>
            <td><time className="mono">{blackout.startsAt.slice(0, 10)}</time></td>
            <td><time className="mono">{new Date(Date.parse(blackout.endsAt) - 1).toISOString().slice(0, 10)}</time></td>
            <td>{blackout.reason}</td>
            <td><form action={removeBlackout}><input type="hidden" name="blackoutId" value={blackout.id} />
              <Button type="submit" size="small" variant="ghost" disabled={pending}><Trash2 />Lift</Button></form></td>
          </tr>)}</tbody>
        </table>
      </div>}
      <div className="queue-footer"><span>Lifting a blackout does not restore withdrawn times; open them again from the weekly pattern above.</span></div>
    </div>
  </>;
}
