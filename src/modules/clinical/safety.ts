import "server-only";
import { logOperational } from "@/platform/log";

/**
 * The prescribing safety boundary. A provider returns a verdict and names itself, and that name
 * is stored with the prescription.
 *
 * The default provider is a fixture: it reasons only over the patient's own chart and calls
 * itself `synthetic-fixture`, which the `issued_requires_safety` constraint refuses to accept
 * behind an issued prescription. So this build can draft and check, and cannot issue — not
 * because the application declines to, but because the database will not have it. Configuring
 * a real service is what makes issuing possible, which is what makes the seam honest.
 */
export const FIXTURE_SOURCE = "synthetic-fixture";
export type SafetyStatus = "clear" | "warning" | "blocked" | "unavailable";
export type SafetyVerdict = { status: SafetyStatus; source: string; findings: string[] };
export type SafetyRequest = {
  ingredient: string; name: string; dose: number; unit: string; route: string; frequency: string; durationDays: number;
  allergies: { substance: string; severity: string }[];
  current: { ingredient: string; name: string }[];
};

export function safetyProviderName() { return process.env.SAFETY_PROVIDER_NAME || FIXTURE_SOURCE; }
export function safetyProviderIsFixture() { return safetyProviderName() === FIXTURE_SOURCE; }

/** Allergy match is a hard stop; the same ingredient already running is a warning. */
function fixtureVerdict(request: SafetyRequest): SafetyVerdict {
  const findings: string[] = [];
  const ingredient = request.ingredient.toLowerCase();
  const allergy = request.allergies.find((entry) => ingredient.includes(entry.substance.toLowerCase()) || entry.substance.toLowerCase().includes(ingredient));
  if (allergy) findings.push(`Recorded allergy to ${allergy.substance} (${allergy.severity}) matches ${request.name}.`);
  const duplicate = request.current.find((entry) => entry.ingredient.toLowerCase() === ingredient);
  if (duplicate) findings.push(`${duplicate.name} with the same ingredient is already prescribed in this visit.`);
  if (request.durationDays > 90) findings.push(`A ${request.durationDays}-day course is longer than this check will clear without review.`);
  if (allergy) return { status: "blocked", source: FIXTURE_SOURCE, findings };
  if (findings.length) return { status: "warning", source: FIXTURE_SOURCE, findings };
  return { status: "clear", source: FIXTURE_SOURCE, findings: ["No allergy match, duplicate ingredient or course-length concern found on this chart."] };
}

export async function checkPrescribingSafety(request: SafetyRequest): Promise<SafetyVerdict> {
  const url = process.env.SAFETY_API_URL;
  if (!url) return fixtureVerdict(request);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.SAFETY_API_KEY ? { authorization: `Bearer ${process.env.SAFETY_API_KEY}` } : {}) },
      // Clinical facts only: no name, no record number, no internal identifier.
      body: JSON.stringify({ ingredient: request.ingredient, dose: request.dose, unit: request.unit, route: request.route, frequency: request.frequency,
        durationDays: request.durationDays, allergies: request.allergies.map((entry) => entry.substance), current: request.current.map((entry) => entry.ingredient) }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      logOperational("job.failed", { code: `SAFETY_HTTP_${response.status}` });
      return { status: "unavailable", source: safetyProviderName(), findings: ["The safety service could not be reached, so nothing was checked."] };
    }
    const body = await response.json() as { status?: string; findings?: unknown };
    const status = ["clear", "warning", "blocked"].includes(String(body.status)) ? body.status as SafetyStatus : "unavailable";
    const findings = Array.isArray(body.findings) ? body.findings.filter((entry): entry is string => typeof entry === "string").slice(0, 20) : [];
    return { status, source: safetyProviderName(), findings };
  } catch {
    logOperational("job.failed", { code: "SAFETY_UNREACHABLE" });
    return { status: "unavailable", source: safetyProviderName(), findings: ["The safety service could not be reached, so nothing was checked."] };
  }
}
