import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { logOperational } from "@/platform/log";
import { SOAP_TEMPLATE } from "./policy";

export function assistConfigured() { return Boolean(process.env.ANTHROPIC_API_KEY); }

const SYSTEM = `You draft outpatient visit notes for a clinician who will read, edit and sign them.

Rules you must follow:
- Use exactly the four headings Subjective, Objective, Assessment, Plan.
- Use only the information given to you. Never invent symptoms, findings, measurements, diagnoses or medications.
- Put the clinician's own wording under Subjective and Plan. Put supplied measurements under Objective.
- Where a section has no supplied information, write "Not recorded this visit." Do not infer it.
- Do not state a diagnosis the clinician has not written. Describe what is recorded instead.
- Do not recommend treatment, doses or prescriptions.
- Write plain clinical prose. No bullet characters, no headings other than the four, no closing commentary.`;

type DraftInput = {
  reason: string; age: number; sex: string;
  allergies: { substance: string; reaction: string; severity: string }[];
  problems: { description: string; status: string }[];
  observations: { label: string; value: string; unit: string; flag: string }[];
  clinicianNotes: string;
};
export class AssistUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = "AssistUnavailableError"; }
}
// Only the clinical facts the draft needs are sent. Name, MRN, date of birth and every
// internal identifier stay inside this system.
function buildPrompt(input: DraftInput) {
  const lines = [
    `Reason for visit: ${input.reason}`,
    `Patient: ${input.age}-year-old, sex recorded as ${input.sex}`,
    `Allergies: ${input.allergies.length ? input.allergies.map((a) => `${a.substance} (${a.reaction}, ${a.severity})`).join("; ") : "none recorded"}`,
    `Active problems: ${input.problems.filter((p) => p.status === "active").map((p) => p.description).join("; ") || "none recorded"}`,
    `Observations this visit: ${input.observations.length ? input.observations.map((o) => `${o.label} ${o.value} ${o.unit}${o.flag !== "normal" ? ` (${o.flag})` : ""}`).join("; ") : "none recorded"}`,
    "",
    "Clinician's notes to work from:",
    input.clinicianNotes.trim() || "(none supplied)",
  ];
  return lines.join("\n");
}
export async function draftVisitNote(input: DraftInput) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AssistUnavailableError("Drafting assistance is not configured for this deployment.");
  const client = new Anthropic({ apiKey });
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 8_000,
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: "claude-opus-4-8" }],
      system: SYSTEM,
      // A structured rewrite of supplied facts, so depth of reasoning is not the constraint.
      output_config: { effort: "low" },
      messages: [{ role: "user", content: buildPrompt(input) }],
    });
    if (response.stop_reason === "refusal") throw new AssistUnavailableError("The drafting assistant declined this request. Write the note directly.");
    const text = response.content.filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
    if (!text) throw new AssistUnavailableError("The drafting assistant returned nothing. Write the note directly.");
    return text.startsWith("Subjective") ? text : `${SOAP_TEMPLATE}\n${text}`;
  } catch (error) {
    if (error instanceof AssistUnavailableError) throw error;
    // Never log the prompt or the response; both contain patient information.
    if (error instanceof Anthropic.RateLimitError) { logOperational("request.failed", { code: "ASSIST_RATE_LIMIT" }); throw new AssistUnavailableError("Drafting assistance is busy. Try again shortly, or write the note directly."); }
    if (error instanceof Anthropic.APIError) { logOperational("request.failed", { code: "ASSIST_API_ERROR" }); throw new AssistUnavailableError("Drafting assistance is unavailable. Write the note directly."); }
    logOperational("request.failed", { code: "ASSIST_FAILED" });
    throw new AssistUnavailableError("Drafting assistance is unavailable. Write the note directly.");
  }
}
