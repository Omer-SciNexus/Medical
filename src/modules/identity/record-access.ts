/** How many log rows one page of a patient's access history reads before grouping them. */
export const RECORD_ACCESS_PAGE_EVENTS = 300;
/** Rows this close together by one person are one sitting: opening a chart writes several. */
const SITTING_GAP_MS = 30 * 60_000;

const ACTIVITIES: Record<string, string> = {
  "access.break_glass": "Used emergency access to read your chart",
  "access.denied": "Tried to open your record and was refused",
  "access.granted": "Gave your care team access to your record",
  "access.revoked": "Ended someone's access to your record",
  "audit.viewed": "Reviewed the access log for your record",
  "billing.charge_line_added": "Added an item to your invoice",
  "billing.charge_line_removed": "Removed an item from your invoice",
  "billing.charge_paid": "Recorded your payment",
  "billing.charge_recorded": "Recorded the charge for your visit",
  "billing.charge_voided": "Cancelled your invoice",
  "billing.invoices_read": "Looked at your invoices",
  "clinical.allergy_recorded": "Recorded an allergy",
  "clinical.chart_read": "Opened your chart",
  "clinical.chart_visits_read": "Looked at your past visits",
  "clinical.document_opened": "Opened one of your documents",
  "clinical.document_registered": "Added a document to your chart",
  "clinical.document_stored": "Added a document to your chart",
  "clinical.documents_read": "Looked at your documents",
  "clinical.encounter_completed": "Completed your visit",
  "clinical.encounter_opened": "Started your visit",
  "clinical.note_amended": "Corrected your visit note",
  "clinical.note_saved": "Wrote your visit note",
  "clinical.note_signed": "Signed your visit note",
  "clinical.observations_recorded": "Recorded your measurements",
  "clinical.prescription_cancelled": "Cancelled a prescription",
  "clinical.prescription_checked": "Checked a prescription for safety",
  "clinical.prescription_drafted": "Drafted a prescription",
  "clinical.prescription_issued": "Issued a prescription",
  "clinical.problem_added": "Added a health problem to your chart",
  "clinical.visit_summary_read": "Read your visit summary",
  "clinical.visits_read": "Looked at your past visits",
  "scheduling.appointment_cancelled": "Cancelled an appointment",
  "scheduling.appointment_checked_in": "Checked you in",
  "scheduling.appointment_no_show": "Marked an appointment as missed",
  "scheduling.appointment_ready": "Marked you ready to be seen",
  "scheduling.appointment_rooming": "Took you to a room",
  "scheduling.appointments_read": "Looked at your appointments",
  "scheduling.follow_up_closed": "Closed your follow-up",
  "scheduling.follow_up_planned": "Asked to see you again",
  "scheduling.follow_up_reminder_requested": "Sent you a follow-up reminder",
  "scheduling.patient_corrected": "Corrected your registration details",
  "scheduling.patient_details_read": "Looked up your registration details",
  "scheduling.patient_identity_read": "Looked up your name and date of birth",
  "scheduling.patient_registered": "Registered you as a patient",
  "scheduling.request_resolved": "Handled your appointment request",
};
const REASONS: Record<string, string> = {
  administration: "Clinic administration", audit: "Reviewing access to your record", billing: "Billing",
  "break_glass": "Emergency care", "clinical.read": "Your care", "clinical.write": "Your care", prescribe: "Your care", scheduling: "Your appointments",
};
const ROLES: Record<string, string> = { admin: "Administrator", clinician: "Clinician", patient: "Patient", staff: "Front desk" };

export type RecordAccessEvent = { seq: number; actorId: string | null; action: string; purpose: string; outcome: string; reason: string | null; createdAt: Date };
export type RecordAccessEntry = { id: number; person: string; role: string; kind: "routine" | "emergency" | "refused"; activities: string[]; reasons: string[]; note: string | null; firstAt: Date; lastAt: Date };
const kindOf = (outcome: string): RecordAccessEntry["kind"] => outcome === "emergency" ? "emergency" : outcome === "denied" ? "refused" : "routine";
const including = (list: string[], value: string) => list.includes(value) ? list : [...list, value];

/**
 * Turns log rows, newest first, into what a person can read: one entry per sitting, in plain words.
 * An action with no wording here still appears, because leaving a row out of this view would make
 * it claim less than happened. Emergencies and refusals always stand alone, and only an emergency
 * carries its reason: other reasons in the log are operational and may name other people.
 */
export function summariseRecordAccess(events: RecordAccessEvent[], people: { id: string; displayName: string; role: string }[]): RecordAccessEntry[] {
  const entries: RecordAccessEntry[] = [];
  const actors = new Map<RecordAccessEntry, string | null>();
  for (const event of events) {
    const kind = kindOf(event.outcome);
    const activity = ACTIVITIES[event.action] ?? "Worked with your record";
    const why = REASONS[event.purpose] ?? "Clinic work";
    const current = entries[entries.length - 1];
    if (current && kind === "routine" && current.kind === "routine" && actors.get(current) === event.actorId && current.firstAt.getTime() - event.createdAt.getTime() <= SITTING_GAP_MS) {
      current.activities = including(current.activities, activity);
      current.reasons = including(current.reasons, why);
      current.firstAt = event.createdAt;
      continue;
    }
    const person = people.find((candidate) => candidate.id === event.actorId);
    const entry: RecordAccessEntry = { id: event.seq, person: person?.displayName ?? "A former colleague", role: person ? ROLES[person.role] ?? "Staff" : "Staff", kind, activities: [activity], reasons: [why],
      note: kind === "emergency" ? event.reason : null, firstAt: event.createdAt, lastAt: event.createdAt };
    entries.push(entry);
    actors.set(entry, event.actorId);
  }
  // Read newest first, so each sitting's activities are put back into the order they happened.
  return entries.map((entry) => ({ ...entry, activities: [...entry.activities].reverse() }));
}
