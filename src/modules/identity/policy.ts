import type { Actor, AccessPurpose } from "./validators";

// Pure decision function. The service verifies current DB state before applying it.
export function roleAllowsPurpose(actor: Actor, purpose: AccessPurpose): boolean {
  if (actor.role === "patient") return purpose === "patient.view" || purpose === "scheduling";
  if (!actor.mfaVerified) return false;
  if (actor.role === "staff") return purpose === "scheduling";
  if (actor.role === "clinician") return ["clinical.read", "clinical.write", "prescribe", "scheduling"].includes(purpose);
  return false;
}
export function hasFreshTotp(actor: Actor, now = Date.now()) {
  return actor.mfaVerified && actor.mfaVerifiedAt !== null && now >= actor.mfaVerifiedAt && now - actor.mfaVerifiedAt <= 5 * 60_000;
}
