"use client";

import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { ArrowLeft, ArrowRight, CalendarCheck, ClipboardCheck, FileText, UserCheck } from "lucide-react";

const stages = [
  { id: "book", label: "Book", icon: CalendarCheck, status: "Appointment booked", title: "A clear next step for the patient.", text: "Choose a clinician, describe the reason for the visit, and review the time before confirming.", rows: [["Patient", "Alex Morgan · sample patient"], ["Visit", "Routine follow-up"], ["Time", "Tuesday · 09:30"]] },
  { id: "arrive", label: "Arrive", icon: UserCheck, status: "Ready for consultation", title: "Keep the whole team in the picture.", text: "Reception checks the patient in. The waiting room and clinical queue follow the visit as it moves forward.", rows: [["Arrival", "Checked in"], ["Rooming", "Complete"], ["Next step", "Consultation"]] },
  { id: "document", label: "Document", icon: FileText, status: "Note ready for review", title: "The right context, close at hand.", text: "Review the patient record, record observations, and prepare the visit note. Signing preserves the reviewed version.", rows: [["Patient context", "Reviewed"], ["Visit note", "Draft saved"], ["Next step", "Review and sign"]] },
  { id: "follow-up", label: "Follow up", icon: ClipboardCheck, status: "Summary published", title: "Clarity that continues after the visit.", text: "Complete the visit with a plain-language summary. The patient can return to their portal to read the published next steps.", rows: [["Visit", "Completed"], ["Patient summary", "Available in the portal"], ["Next step", "Review the care plan"]] },
];

export function WorkflowTour() {
  const [active, setActive] = useState("book");
  const index = stages.findIndex((stage) => stage.id === active);
  return <section className="workflow-tour" id="experience" aria-labelledby="tour-heading"><div className="public-container">
    <div className="marketing-section-heading"><div><span className="public-eyebrow">FROM FIRST HELLO TO FOLLOW-UP</span><h2 id="tour-heading">One visit. A connected journey.</h2></div><p>Walk through a sample clinic visit.<br />This demonstration uses fictional data.</p></div>
    <Tabs.Root value={active} onValueChange={setActive} className="tour-frame">
      <Tabs.List className="tour-tabs" aria-label="Sample visit stages">{stages.map((stage, i) => <Tabs.Trigger key={stage.id} value={stage.id}><span>{String(i + 1).padStart(2,"0")}</span>{stage.label}</Tabs.Trigger>)}</Tabs.List>
      {stages.map((stage) => <Tabs.Content value={stage.id} key={stage.id} className="tour-panel">
        <div className="tour-copy"><stage.icon aria-hidden="true" /><h3>{stage.title}</h3><p>{stage.text}</p></div>
        <div className="tour-record"><div className="tour-record-header"><span>EXAMPLE VISIT</span><span>{stage.status}</span></div><dl>{stage.rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div>
      </Tabs.Content>)}
      <div className="tour-controls"><span>Preview only · no appointments or records are changed</span><div><button type="button" aria-label="Previous sample stage" disabled={index === 0} onClick={() => setActive(stages[index - 1].id)}><ArrowLeft aria-hidden="true" /></button><button type="button" aria-label={index === stages.length-1 ? "Restart the sample visit" : "Next sample stage"} onClick={() => setActive(stages[(index + 1) % stages.length].id)}>{index === stages.length-1 ? "Start again" : "Next step"}<ArrowRight aria-hidden="true" /></button></div></div>
    </Tabs.Root>
  </div></section>;
}
