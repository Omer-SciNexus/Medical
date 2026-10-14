import type { NoteStatus } from "./validators";

export const SOAP_TEMPLATE = "Subjective:\n\nObjective:\n\nAssessment:\n\nPlan:\n";
/** Consultation fee in integer minor units, so no rounding happens in money arithmetic. */
export const CONSULTATION_FEE_MINOR = 150_000;

export function noteIsEditable(status: NoteStatus) { return status === "draft"; }
export function noteIsSignable(status: NoteStatus, content: string) { return status === "draft" && content.trim().length >= 20; }
// A visit may only be completed from a signed note. An unsigned note means the clinician has
// not yet attested to the record, so nothing downstream may be billed. Note that an amendment
// does not inherit the previous signature: amending leaves the current version a draft, and
// 'amended' only ever marks a superseded version, never the current one.
export function encounterIsCompletable(encounterStatus: string, noteStatus: NoteStatus) {
  return encounterStatus === "in_progress" && noteStatus === "signed";
}
export function observationFlag(value: number, low: number | null, high: number | null): "normal" | "low" | "high" {
  if (low !== null && value < low) return "low";
  if (high !== null && value > high) return "high";
  return "normal";
}
export function patientAge(birthDate: string, now = new Date()) {
  const [year, month, day] = birthDate.split("-").map(Number);
  let age = now.getUTCFullYear() - year;
  const beforeBirthday = now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day);
  if (beforeBirthday) age -= 1;
  return age;
}
