"use client";

import { useRef, useState } from "react";
import { ArrowRight, CalendarDays, ChevronRight, CircleCheck, Clock3, ShieldAlert, SlidersHorizontal } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { Badge, Button, Modal, Select } from "@/components/ui/primitives";

const patients = [
  { name: "YILMAZ, Aylin", given: "Aylin Yılmaz", time: "09:00", status: "In progress", reason: "Blood pressure review", age: "42", sex: "Female", mrn: "MR–02481", allergy: "Penicillin", reaction: "Urticaria · documented", bp: "142/88", pulse: "76", temp: "36.7", spo2: "98", high: true },
  { name: "DEMİR, Emre", given: "Emre Demir", time: "09:20", status: "Ready", reason: "Annual health review", age: "35", sex: "Male", mrn: "MR–02482", allergy: null, reaction: null, bp: "118/76", pulse: "68", temp: "36.5", spo2: "99", high: false },
  { name: "MORETTI, Sofia", given: "Sofia Moretti", time: "09:40", status: "Rooming", reason: "Thyroid follow-up", age: "51", sex: "Female", mrn: "MR–02483", allergy: "Latex", reaction: "Contact dermatitis", bp: "124/80", pulse: "72", temp: "36.6", spo2: "98", high: false },
  { name: "KAYA, Deniz", given: "Deniz Kaya", time: "10:00", status: "Checked in", reason: "Persistent cough", age: "29", sex: "Male", mrn: "MR–02484", allergy: null, reaction: null, bp: "116/74", pulse: "81", temp: "37.1", spo2: "98", high: false },
  { name: "RAHMAN, Nadia", given: "Nadia Rahman", time: "10:20", status: "Booked", reason: "Diabetes follow-up", age: "47", sex: "Female", mrn: "MR–02485", allergy: "Sulfonamides", reaction: "Rash · documented", bp: "128/82", pulse: "74", temp: "36.8", spo2: "99", high: false },
];

export function ClinicalSpecimen() {
  const [selected, setSelected] = useState(0);
  const [filter, setFilter] = useState("all");
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const visiblePatients = patients.map((patient, index) => ({ ...patient, index })).filter((patient) => filter !== "arrived" || patient.status !== "Booked");
  const patient = patients[selected];
  return <>
    <div className="specimen">
      <div className="specimen-topline"><span className="icon-label"><strong>Clinical workspace</strong><span className="caption-dot" />Component specimen</span><span className="mono">13px / 32px rows</span></div>
      <div className="specimen-body">
        <div className="clinical-toolbar"><div><h3>Morning clinic</h3><p><span className="mono">Mon, 21 Sep 2026</span> <span className="caption-dot" /> Internal medicine</p></div><div className="clinical-toolbar-actions"><Select id="queue-filter" label="Filter sample queue" value={filter} onValueChange={setFilter} options={[{ value: "all", label: "All appointments" }, { value: "arrived", label: "Arrived patients" }]} /><Popover.Root><Popover.Trigger asChild><Button variant="secondary" size="icon" aria-label="About this queue specimen"><SlidersHorizontal /></Button></Popover.Trigger><Popover.Portal><Popover.Content className="floating popover-content" sideOffset={6} align="end"><h3>A queue you can scan.</h3><p>Each row preserves the same rhythm: time, identity, reason, status. Select a patient to inspect the persistent context panel.</p><p>All records in this library are synthetic.</p></Popover.Content></Popover.Portal></Popover.Root></div></div>
        <div className="clinical-split">
          <div className="queue" onKeyDown={(event) => {
            if (!['j', 'k', 'ArrowDown', 'ArrowUp'].includes(event.key) || !(event.target instanceof HTMLButtonElement)) return;
            event.preventDefault();
            const position = visiblePatients.findIndex((item) => item.index === selected);
            const next = visiblePatients[(position + (event.key === 'j' || event.key === 'ArrowDown' ? 1 : -1) + visiblePatients.length) % visiblePatients.length].index;
            setSelected(next); rowRefs.current[next]?.focus();
          }}>
            <div className="table-scroll"><table className="clinical-table"><caption className="sr-only">Synthetic appointment queue. Select a patient to preview their context. Use j and k when a patient name is focused.</caption><thead><tr><th scope="col">Time</th><th scope="col">Patient</th><th scope="col" className="reason-column">Reason for visit</th><th scope="col">Status</th></tr></thead><tbody>{visiblePatients.map((item) => <tr key={item.mrn} data-selected={selected === item.index}><td className="mono muted">{item.time}</td><td><button ref={(element) => { rowRefs.current[item.index] = element; }} onClick={() => setSelected(item.index)} className="patient-row-button" aria-pressed={selected === item.index} aria-label={`Preview ${item.given}`}>{item.name}</button></td><td className="reason-column muted">{item.reason}</td><td><Badge tone={item.status === "In progress" ? "accent" : "neutral"}>{item.status}</Badge></td></tr>)}</tbody></table></div>
            <div className="queue-footer"><span><span className="mono">{visiblePatients.length}</span> appointments in this specimen</span><span><kbd>j</kbd> <kbd>k</kbd> to navigate</span></div>
          </div>
          <aside className="context-panel" aria-label="Selected synthetic patient" aria-live="polite"><span className="eyebrow">Patient context</span><h4 className="context-name">{patient.name}</h4><p className="context-meta"><span><span className="mono">{patient.age}</span> years · {patient.sex}</span><span className="mono">{patient.mrn}</span></p>{patient.allergy ? <div className="allergy-strip"><ShieldAlert /><div><strong>{patient.allergy} allergy</strong><span>{patient.reaction}</span></div></div> : <p className="context-normal"><CircleCheck />No known allergies recorded</p>}<dl className="context-observations"><div className="context-observation"><dt>Blood pressure</dt><dd className={patient.high ? "text-high" : undefined}>{patient.bp} <small>mmHg</small>{patient.high && <span className="sr-only">, high</span>}</dd></div><div className="context-observation"><dt>Heart rate</dt><dd>{patient.pulse} <small>bpm</small></dd></div><div className="context-observation"><dt>Temperature</dt><dd>{patient.temp} <small>°C</small></dd></div><div className="context-observation"><dt>SpO₂</dt><dd>{patient.spo2} <small>%</small></dd></div></dl><p className="context-footnote">{patient.high ? "↑ Blood pressure above the specimen reference." : "Synthetic observations for layout review."}</p></aside>
        </div>
      </div>
    </div>
    <div className="specimen-caption"><span>Compact by design. Context stays in view; the work stays in focus.</span><span className="mono">Density / clinical</span></div>
  </>;
}

export function PatientSpecimen() {
  const [selectedTime, setSelectedTime] = useState("09:20");
  const [open, setOpen] = useState(false);
  const timeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const times = ["09:20", "10:40", "11:20", "14:00"];
  return <>
    <div className="specimen"><div className="specimen-topline"><span className="icon-label"><strong>Patient experience</strong><span className="caption-dot" />Component specimen</span><span className="mono">17px / comfortable spacing</span></div>
      <div className="patient-preview patient-register"><div><div className="patient-steps" aria-label="Example booking steps"><span>1. Your visit</span><ChevronRight /><span className="current">2. A time for you</span><ChevronRight /><span>3. Confirm</span></div><span className="eyebrow">Your next appointment</span><h3>Let’s find a time<br />that works for you.</h3><p>Choose a time for your follow-up with Dr. Selin Arslan. Your visit will take about <span className="mono">20</span> minutes.</p><div className="time-options" role="radiogroup" aria-label="Example available appointment times" onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp"].includes(event.key)) return;
        event.preventDefault(); const index = times.indexOf(selectedTime); const next = (index + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + times.length) % times.length; setSelectedTime(times[next]); timeRefs.current[next]?.focus();
      }}>{times.map((time, index) => <button key={time} ref={(element) => { timeRefs.current[index] = element; }} className="time-option mono" role="radio" aria-checked={selectedTime === time} tabIndex={selectedTime === time ? 0 : -1} onClick={() => setSelectedTime(time)}>{time}</button>)}</div></div><div className="patient-booking-summary"><span className="eyebrow">Your care team</span><h4>Dr. Selin Arslan</h4><p>Internal medicine</p><div className="appointment-detail"><CalendarDays /><div><span>Monday, <span className="mono">21</span> September</span><br /><span className="muted mono">{selectedTime} · 20 minutes</span></div></div><Modal open={open} onOpenChange={setOpen} title="Your selected appointment" description="This is an interaction preview. No appointment will be booked." trigger={<Button>Review appointment <ArrowRight /></Button>}><div className="review-record"><h3>Dr. Selin Arslan</h3><p>Monday, <span className="mono">21 September 2026, {selectedTime}</span></p><p>Internal medicine · Follow-up visit</p></div><Button onClick={() => setOpen(false)} variant="secondary">Back to the preview</Button></Modal></div></div>
    </div><div className="specimen-caption"><span>One decision at a time. Plain language, larger type, a clear next step.</span><span className="mono">Density / patient</span></div>
  </>;
}

export function Foundations() {
  return <>
    <div className="foundations-grid"><div className="foundation-block"><span className="eyebrow">Typography with a purpose</span><div className="type-pair"><div><div className="type-sample">Aa</div><div className="type-description"><strong>IBM Plex Sans</strong>Interface & language</div></div><div><div className="type-sample mono">0123</div><div className="type-description"><strong>IBM Plex Mono</strong>Values & identifiers</div></div></div><p className="type-description">Weight sets the hierarchy. Tabular numerals keep data aligned.</p></div><div className="foundation-block"><span className="eyebrow">Warm neutrals. One accent.</span><div className="swatch-grid" aria-label="Palette: paper, surface, line, muted ink, primary ink, petrol accent">{["--paper", "--surface", "--line", "--ink-600", "--ink-900", "--accent"].map((token) => <div className="swatch" key={token} style={{ background: `var(${token})` }} title={token} />)}</div><div className="swatch-labels"><span>Paper</span><span>Ink</span><span>Petrol</span></div><p className="type-description" style={{ marginTop: 16 }}>Quiet surfaces and fine rules. Color carries meaning.</p></div></div>
    <div className="semantic-row">{[{ name: "Normal", meaning: "No exception", token: "--ink-900" }, { name: "Low", meaning: "Below reference", token: "--low" }, { name: "High", meaning: "Above reference", token: "--high" }, { name: "Critical", meaning: "Requires attention", token: "--critical" }, { name: "Allergy", meaning: "Safety information", token: "--allergy" }].map((item) => <div className="semantic-item" key={item.name}><div className="semantic-indicator" style={{ background: `var(${item.token})` }} /><div><p>{item.name}</p><span>{item.meaning}</span></div></div>)}</div>
  </>;
}

export function KeyboardGuide() {
  return <><div className="keyboard-grid">{[{ label: "Open the command palette", keys: "⌘ / Ctrl K" }, { label: "Move through a focused queue", keys: "j / k" }, { label: "Close a dialog or popover", keys: "Esc" }, { label: "Move between controls", keys: "Tab / ⇧ Tab" }].map((item) => <div className="keyboard-row" key={item.label}><span>{item.label}</span><kbd>{item.keys}</kbd></div>)}</div><p className="keyboard-note"><Clock3 />Shortcuts work where they belong. Typing in a field never moves the queue. Motion respects your device’s reduced-motion setting.</p></>;
}
