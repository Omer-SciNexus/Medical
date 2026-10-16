import "server-only";
import { z } from "zod";
import { getDb, type Transaction } from "@/platform/db";
import { getRedis } from "@/platform/redis";
import { sendMail } from "@/platform/mailer";
import { isUniqueViolation } from "@/platform/errors";
import { resolvePatientScope } from "@/modules/scheduling";
import { actorSchema, auditFilterSchema, emergencySchema, invitationIdSchema, inviteSchema, purposeSchema, userIdSchema, type Actor, type AccessPurpose } from "./validators";
import { roleAllowsPurpose, hasFreshTotp } from "./policy";
import { digest, newToken } from "./crypto";
import { revokeAllSessions } from "./sessions";
import { appendAudit, clearMfaEnrollment, createEmergencyRelationship, createInvitation, findClinicSettings, findClinicUser, findUserByEmail, findUserById, hasCareRelationship, listAuditEvents, listClinicians, listClinicPeople, listInvitations, revokeInvitation, rotateInvitation, setUserActive, verifyAuditChain } from "./repository";

export class AccessDeniedError extends Error {
  constructor() { super("You do not have permission to access this record."); this.name = "AccessDeniedError"; }
}
async function currentActorIsValid(actor: Actor, tx?: Transaction) {
  const user = await findUserById(actor.id, tx);
  return Boolean(user?.active && user.clinicId === actor.clinicId && user.role === actor.role && user.patientId === actor.patientId && (user.role === "patient" || (user.mfaSecret && actor.mfaVerified)));
}
async function deny(actor: Actor, patientId: string, purpose: string): Promise<never> {
  // Separate transaction: a denied operation must not roll back its denial evidence.
  await appendAudit({ clinicId: actor.clinicId, actorId: actor.id, patientId, action: "access.denied", purpose, outcome: "denied" });
  throw new AccessDeniedError();
}
export async function assertCanAccessPatient(inputActor: Actor, inputPatientId: string, inputPurpose: AccessPurpose, tx?: Transaction) {
  const actor = actorSchema.parse(inputActor);
  const patientId = z.uuid().parse(inputPatientId);
  const purpose = purposeSchema.parse(inputPurpose);
  if (!await currentActorIsValid(actor, tx) || !roleAllowsPurpose(actor, purpose) || !await resolvePatientScope(actor, patientId, tx)) return deny(actor, patientId, purpose);
  if (actor.role === "patient") {
    if (actor.patientId !== patientId) return deny(actor, patientId, purpose);
    return;
  }
  if (!await hasCareRelationship(actor, patientId, purpose, tx)) return deny(actor, patientId, purpose);
}
export async function requestBreakGlass(inputActor: Actor, input: unknown) {
  const actor = actorSchema.parse(inputActor);
  const { patientId, reason } = emergencySchema.parse(input);
  if (actor.role !== "clinician" || !hasFreshTotp(actor) || !await currentActorIsValid(actor) || !await resolvePatientScope(actor, patientId)) return deny(actor, patientId, "break_glass");
  await getDb().transaction((tx) => createEmergencyRelationship(actor, patientId, reason, tx));
}
// Called by patient-data repositories inside their existing transaction.
// This function intentionally couples access checks and durable read/write audit.
export async function auditedPatientOperation<T>(tx: Transaction, actor: Actor, patientId: string, purpose: AccessPurpose, action: string, operation: () => Promise<T>): Promise<T> {
  await assertCanAccessPatient(actor, patientId, purpose, tx);
  const result = await operation();
  await appendAudit({ clinicId: actor.clinicId, actorId: actor.id, patientId, action, purpose, outcome: "allowed" }, tx);
  return result;
}
/** Audit for clinic-scoped work that resolves no single patient, such as a queue read. */
export async function recordScopedEvent(inputActor: Actor, event: { action: string; purpose: string; resourceId?: string; reason?: string }, tx?: Transaction) {
  const actor = actorSchema.parse(inputActor);
  await appendAudit({ clinicId: actor.clinicId, actorId: actor.id, action: event.action, purpose: event.purpose, outcome: "allowed", resourceId: event.resourceId, reason: event.reason }, tx);
}
export async function listCareProviders(inputActor: Actor) {
  const actor = actorSchema.parse(inputActor);
  if (!await currentActorIsValid(actor)) throw new AccessDeniedError();
  return listClinicians(actor.clinicId);
}
export async function getClinicSettings(inputActor: Actor) {
  const actor = actorSchema.parse(inputActor);
  if (!await currentActorIsValid(actor)) throw new AccessDeniedError();
  return findClinicSettings(actor.clinicId);
}
// Administration of people is privileged but grants no chart access, and every change is
// recorded. A denied attempt is recorded too, in its own transaction.
async function requireAdmin(actor: Actor) {
  if (actor.role !== "admin" || !actor.mfaVerified || !await currentActorIsValid(actor)) {
    await appendAudit({ clinicId: actor.clinicId, actorId: actor.id, action: "administration.denied", purpose: "administration", outcome: "denied" });
    throw new AccessDeniedError();
  }
}
export class PersonAdminError extends Error {
  constructor(message: string) { super(message); this.name = "PersonAdminError"; }
}
const INVITATION_DAYS = 7;
const invitationLink = (origin: string, token: string) => `${origin}/accept-invite?token=${token}`;
export async function listPeople(inputActor: Actor) {
  const actor = actorSchema.parse(inputActor);
  await requireAdmin(actor);
  const [people, pending] = await Promise.all([listClinicPeople(actor.clinicId), listInvitations(actor.clinicId)]);
  return { people, invitations: pending };
}
/** The raw token exists only in the returned link: the table stores its peppered hash. */
export async function invitePerson(inputActor: Actor, input: unknown, origin: string) {
  const actor = actorSchema.parse(inputActor);
  await requireAdmin(actor);
  const { email, displayName, role } = inviteSchema.parse(input);
  if (await findUserByEmail(email)) throw new PersonAdminError("Someone with that email address already has an account.");
  const token = newToken();
  let invitation: Awaited<ReturnType<typeof createInvitation>>;
  try {
    invitation = await createInvitation({ clinicId: actor.clinicId, email, displayName, role, tokenHash: digest(token), invitedBy: actor.id, expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000) });
  } catch (error) {
    if (isUniqueViolation(error)) throw new PersonAdminError("That email address already has an invitation waiting. Revoke it first, or resend it.");
    throw error;
  }
  const link = invitationLink(origin, token);
  const delivery = await sendMail({ to: email, subject: "You have been invited to a Meridian workspace",
    text: `${displayName},\n\nYou have been invited to join a clinic workspace as ${role}. Open the link below within ${INVITATION_DAYS} days to set your password and enrol an authenticator.\n\n${link}\n\nIf you were not expecting this, ignore this message: the link is single-use and expires on its own.` });
  return { id: invitation.id, email, role, expiresAt: invitation.expiresAt, link, delivered: delivery.delivered };
}
export async function resendPersonInvitation(inputActor: Actor, input: unknown, origin: string) {
  const actor = actorSchema.parse(inputActor);
  await requireAdmin(actor);
  const { invitationId } = invitationIdSchema.parse(input);
  const token = newToken();
  // Rotating the hash is what invalidates the previous link: the old token was never stored.
  const invitation = await rotateInvitation(actor.clinicId, invitationId, digest(token), new Date(Date.now() + INVITATION_DAYS * 86_400_000), actor.id);
  if (!invitation) throw new PersonAdminError("That invitation is no longer pending.");
  const link = invitationLink(origin, token);
  const delivery = await sendMail({ to: invitation.email, subject: "Your Meridian invitation link",
    text: `Your previous invitation link has been replaced. Open the link below within ${INVITATION_DAYS} days to set your password.\n\n${link}` });
  return { link, delivered: delivery.delivered };
}
export async function revokePersonInvitation(inputActor: Actor, input: unknown) {
  const actor = actorSchema.parse(inputActor);
  await requireAdmin(actor);
  const { invitationId } = invitationIdSchema.parse(input);
  if (!await revokeInvitation(actor.clinicId, invitationId, actor.id)) throw new PersonAdminError("That invitation is no longer pending.");
}
// An administrator never acts on their own account here, which is also what keeps a clinic
// from losing its last active administrator: the actor is always one that stays.
async function manageablePerson(actor: Actor, input: unknown) {
  const { userId } = userIdSchema.parse(input);
  if (userId === actor.id) throw new PersonAdminError("You cannot change your own account from this screen.");
  const person = await findClinicUser(actor.clinicId, userId);
  if (!person || person.role === "patient") throw new PersonAdminError("That account could not be found in this clinic.");
  return person;
}
export async function setPersonActive(inputActor: Actor, input: unknown, active: boolean) {
  const actor = actorSchema.parse(inputActor);
  await requireAdmin(actor);
  const person = await manageablePerson(actor, input);
  await setUserActive(actor.clinicId, person.id, active, actor.id);
  // resolveSession re-reads the user on every request, so an existing session dies anyway.
  // Revoking is still explicit here rather than relying on that.
  if (!active) await revokeAllSessions(person.id);
}
export async function resetPersonMfa(inputActor: Actor, input: unknown) {
  const actor = actorSchema.parse(inputActor);
  await requireAdmin(actor);
  const person = await manageablePerson(actor, input);
  await clearMfaEnrollment(actor.clinicId, person.id, actor.id);
  // Their sessions were authenticated by the authenticator just removed.
  await revokeAllSessions(person.id);
}
export async function revokePersonSessions(inputActor: Actor, input: unknown) {
  const actor = actorSchema.parse(inputActor);
  await requireAdmin(actor);
  const person = await manageablePerson(actor, input);
  await revokeAllSessions(person.id);
  await appendAudit({ clinicId: actor.clinicId, actorId: actor.id, action: "identity.sessions_revoked", purpose: "administration", outcome: "allowed", resourceId: person.id });
}
export const CHAIN_INTEGRITY_CACHE_KEY = "audit:chain_integrity";
const CHAIN_INTEGRITY_CACHE_SECONDS = 30;
// verify_audit_chain() walks and rehashes the entire log; it is too expensive to run on every
// page view. A short cache is a stand-in for the real fix (periodic checkpointed verification)
// and bounds staleness to this TTL rather than recomputing on every click through the log.
async function cachedChainIntegrity() {
  const redis = getRedis();
  const cached = await redis.get(CHAIN_INTEGRITY_CACHE_KEY);
  if (cached) return JSON.parse(cached) as { checked: number; brokenSeq: number | null };
  const result = await verifyAuditChain();
  await redis.set(CHAIN_INTEGRITY_CACHE_KEY, JSON.stringify(result), "EX", CHAIN_INTEGRITY_CACHE_SECONDS);
  return result;
}
// Administrators may read the audit log. That privilege grants no chart access, and
// reading the log is itself an audited event.
export async function readAuditLog(inputActor: Actor, input: unknown) {
  const actor = actorSchema.parse(inputActor);
  const filters = auditFilterSchema.parse(input);
  if (actor.role !== "admin" || !actor.mfaVerified || !await currentActorIsValid(actor)) {
    await appendAudit({ clinicId: actor.clinicId, actorId: actor.id, action: "audit.denied", purpose: "audit", outcome: "denied" });
    throw new AccessDeniedError();
  }
  await appendAudit({ clinicId: actor.clinicId, actorId: actor.id, patientId: filters.patientId ?? null, action: "audit.viewed", purpose: "audit", outcome: "allowed" });
  const [events, integrity] = await Promise.all([listAuditEvents(actor.clinicId, filters), cachedChainIntegrity()]);
  return { events, integrity };
}
