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
/**
 * What may be recorded at the bedside, with the reference range each value is read against.
 * Plausible bounds are the entry guard: a typed value outside them is a slip, not a reading.
 */
export const VITALS = [
  { key: "systolic", label: "Systolic blood pressure", unit: "mmHg", low: 90, high: 139, criticalLow: 80, criticalHigh: 180, min: 40, max: 300, step: 1 },
  { key: "diastolic", label: "Diastolic blood pressure", unit: "mmHg", low: 60, high: 89, criticalLow: 50, criticalHigh: 120, min: 20, max: 200, step: 1 },
  { key: "heart_rate", label: "Heart rate", unit: "bpm", low: 60, high: 100, criticalLow: 40, criticalHigh: 130, min: 20, max: 300, step: 1 },
  { key: "respiratory_rate", label: "Respiratory rate", unit: "/min", low: 12, high: 20, criticalLow: 8, criticalHigh: 30, min: 4, max: 80, step: 1 },
  { key: "temperature", label: "Temperature", unit: "°C", low: 36.1, high: 37.5, criticalLow: 35, criticalHigh: 39.5, min: 30, max: 45, step: 0.1 },
  { key: "oxygen_saturation", label: "Oxygen saturation", unit: "%", low: 94, high: 100, criticalLow: 90, criticalHigh: null, min: 50, max: 100, step: 1 },
  { key: "weight", label: "Weight", unit: "kg", low: null, high: null, criticalLow: null, criticalHigh: null, min: 0.5, max: 500, step: 0.1 },
  { key: "height", label: "Height", unit: "cm", low: null, high: null, criticalLow: null, criticalHigh: null, min: 20, max: 250, step: 0.5 },
] as const;
export type VitalKey = (typeof VITALS)[number]["key"];
export const vitalByKey = (key: string) => VITALS.find((vital) => vital.key === key);
/** The stored flag: the reference range decides low or high, and critical bounds escalate it. */
export function observationSeverity(value: number, range: { low: number | null; high: number | null; criticalLow: number | null; criticalHigh: number | null }) {
  if ((range.criticalLow !== null && value < range.criticalLow) || (range.criticalHigh !== null && value > range.criticalHigh)) return "critical" as const;
  return observationFlag(value, range.low, range.high);
}
export function patientAge(birthDate: string, now = new Date()) {
  const [year, month, day] = birthDate.split("-").map(Number);
  let age = now.getUTCFullYear() - year;
  const beforeBirthday = now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day);
  if (beforeBirthday) age -= 1;
  return age;
}
