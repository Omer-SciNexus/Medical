import "server-only";
import { z } from "zod";
import { getDb, type Transaction } from "@/platform/db";
import { sendMail } from "@/platform/mailer";
import { logOperational } from "@/platform/log";
import { isUniqueViolation } from "@/platform/errors";
import { resolveImminentVisit, resolvePatientScope } from "@/modules/scheduling";
import { actorSchema, auditFilterSchema, emergencySchema, invitationIdSchema, inviteSchema, portalInviteSchema, purposeSchema, relationshipIdSchema, userIdSchema, type Actor, type AccessPurpose } from "./validators";
import { roleAllowsPurpose, hasFreshTotp } from "./policy";
import { digest, newToken } from "./crypto";
import { revokeAllSessions } from "./sessions";
import { appendAudit, clearMfaEnrollment, createEmergencyRelationship, createInvitation, findClinicSettings, findClinicUser, findPortalAccount, findUserByEmail, findUserById, hasCareRelationship, insertCareRelationships, listAuditEvents, listClinicians, listClinicPeople, listInvitations, listLiveRelationships, listPendingPatientInvitations, listPortalAccountsFor, revokeInvitation, revokeRelationship, rotateInvitation, setUserActive, verifyAuditChainFrom, latestCheckpoint, summariseAuditOutcomes, exportAuditEvents } from "./repository";

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
  // The front desk is authorized by the visit, not by a standing grant on every patient in the
  // clinic: a receptionist who joins today can run today's waiting room, and only scheduling
  // work, for patients who are actually coming in. Clinical purposes always need a relationship.
  if (actor.role === "staff" && purpose === "scheduling" && await resolveImminentVisit(actor, patientId, tx)) return;
  if (!await hasCareRelationship(actor, patientId, purpose, tx)) return deny(actor, patientId, purpose);
}
export async function requestBreakGlass(inputActor: Actor, input: unknown) {
  const actor = actorSchema.parse(inputActor);
  const { patientId, reason } = emergencySchema.parse(input);
  if (actor.role !== "clinician" || !hasFreshTotp(actor) || !await currentActorIsValid(actor) || !await resolvePatientScope(actor, patientId)) return deny(actor, patientId, "break_glass");
  await getDb().transaction((tx) => createEmergencyRelationship(actor, patientId, reason, tx));
}
/**
 * Called by the scheduling workflow inside its own transaction: booking grants scheduling
 * authority to the provider, and arrival grants the attending clinical authority. A grant is
 * an ordinary, visible, revocable row — the same rows the administrator's access list shows.
 */
export async function grantWorkflowAccess(tx: Transaction, input: { clinicId: string; actorId: string; patientId: string; purposes: AccessPurpose[]; grantedBy: string; reason: string }) {
  const purposes = z.array(purposeSchema).min(1).parse(input.purposes);
  return insertCareRelationships(tx, { clinicId: z.uuid().parse(input.clinicId), actorId: z.uuid().parse(input.actorId), patientId: z.uuid().parse(input.patientId),
    purposes, createdBy: z.uuid().parse(input.grantedBy), reason: input.reason });
}
export async function listAccessGrants(inputActor: Actor) {
  const actor = actorSchema.parse(inputActor);
  await requireAdmin(actor);
  await appendAudit({ clinicId: actor.clinicId, actorId: actor.id, action: "access.registry_viewed", purpose: "administration", outcome: "allowed" });
  return listLiveRelationships(actor.clinicId);
}
export async function revokeAccessGrant(inputActor: Actor, input: unknown) {
  const actor = actorSchema.parse(inputActor);
  await requireAdmin(actor);
  const { relationshipId } = relationshipIdSchema.parse(input);
  if (!await revokeRelationship(actor.clinicId, relationshipId, actor.id)) throw new PersonAdminError("That access has already ended.");
}
// Called by patient-data repositories inside their existing transaction.
// This function intentionally couples access checks and durable read/write audit.
export async function auditedPatientOperation<T>(tx: Transaction, actor: Actor, patientId: string, purpose: AccessPurpose, action: string, operation: () => Promise<T>): Promise<T> {
  await assertCanAccessPatient(actor, patientId, purpose, tx);
  const result = await operation();
  await appendAudit({ clinicId: actor.clinicId, actorId: actor.id, patientId, action, purpose, outcome: "allowed" }, tx);
  return result;
}
/**
 * Audit for clinic-scoped work, such as a queue read. `patientId` is for the one case that
 * cannot pass through patient authorization — creating the patient record itself — and never
 * a way around assertCanAccessPatient for reading one.
 */
export async function recordScopedEvent(inputActor: Actor, event: { action: string; purpose: string; patientId?: string; resourceId?: string; reason?: string }, tx?: Transaction) {
  const actor = actorSchema.parse(inputActor);
  await appendAudit({ clinicId: actor.clinicId, actorId: actor.id, patientId: event.patientId ?? null, action: event.action, purpose: event.purpose, outcome: "allowed", resourceId: event.resourceId, reason: event.reason }, tx);
}
/**
 * Audit for work no person asked for. The actor is null because the system did it, which is a
 * state the log already allows and is more honest than attributing it to whoever happened to
 * trigger the event hours earlier.
 */
export async function recordSystemEvent(event: { clinicId: string; patientId?: string; action: string; purpose: string; resourceId?: string; reason?: string }) {
  await appendAudit({ clinicId: z.uuid().parse(event.clinicId), actorId: null, patientId: event.patientId ?? null,
    action: event.action, purpose: event.purpose, outcome: "allowed", resourceId: event.resourceId, reason: event.reason });
}
/** The address a notification goes to, if this patient has claimed a portal account. */
export async function findPortalContact(clinicId: string, patientId: string) {
  const account = await findPortalAccount(z.uuid().parse(clinicId), z.uuid().parse(patientId));
  return account?.active ? { email: account.email } : undefined;
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
  // Mail goes out in this clinic's name, so the person sending it proves their own address first.
  const inviter = await findUserById(actor.id);
  if (!inviter?.emailVerifiedAt) throw new PersonAdminError("Confirm your own email address before inviting colleagues.");
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
// A portal invitation is issued by the front desk against a patient record that already
// exists. The clinic, the role and the patient link all come from here, never from the caller.
export async function invitePatientPortal(inputActor: Actor, input: unknown, origin: string) {
  const actor = actorSchema.parse(inputActor);
  if ((actor.role !== "staff" && actor.role !== "admin") || !actor.mfaVerified || !await currentActorIsValid(actor)) {
    await appendAudit({ clinicId: actor.clinicId, actorId: actor.id, action: "administration.denied", purpose: "administration", outcome: "denied" });
    throw new AccessDeniedError();
  }
  const { patientId, email, displayName } = portalInviteSchema.parse(input);
  if (!await resolvePatientScope(actor, patientId)) throw new PersonAdminError("That patient could not be found in this clinic.");
  if (await findPortalAccount(actor.clinicId, patientId)) throw new PersonAdminError("That patient already has a portal account.");
  if (await findUserByEmail(email)) throw new PersonAdminError("Someone with that email address already has an account.");
  const token = newToken();
  let invitation: Awaited<ReturnType<typeof createInvitation>>;
  try {
    invitation = await createInvitation({ clinicId: actor.clinicId, email, displayName, role: "patient", patientId, tokenHash: digest(token), invitedBy: actor.id, expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000) });
  } catch (error) {
    if (isUniqueViolation(error)) throw new PersonAdminError("An invitation for that patient or address is already waiting. Revoke it first, or send a new link.");
    throw error;
  }
  const link = invitationLink(origin, token);
  const delivery = await sendMail({ to: email, subject: "Your clinic portal invitation",
    text: `${displayName},\n\nYour clinic has set up a portal account for you. Open the link below within ${INVITATION_DAYS} days to choose a password and see your appointments and visit summaries.\n\n${link}\n\nIf this was not expected, ignore this message: the link is single-use and expires on its own.` });
  return { id: invitation.id, link, delivered: delivery.delivered };
}
/** Which of these patients already hold a portal account, or have a link waiting. */
export async function listPortalLinks(inputActor: Actor, patientIds: string[]) {
  const actor = actorSchema.parse(inputActor);
  if ((actor.role !== "staff" && actor.role !== "admin") || !actor.mfaVerified) throw new AccessDeniedError();
  const ids = z.array(z.uuid()).max(100).parse(patientIds);
  const [accounts, pending] = await Promise.all([listPortalAccountsFor(actor.clinicId, ids), listPendingPatientInvitations(actor.clinicId, ids)]);
  return { accounts, pending };
}
export async function revokePersonSessions(inputActor: Actor, input: unknown) {
  const actor = actorSchema.parse(inputActor);
  await requireAdmin(actor);
  const person = await manageablePerson(actor, input);
  await revokeAllSessions(person.id);
  await appendAudit({ clinicId: actor.clinicId, actorId: actor.id, action: "identity.sessions_revoked", purpose: "administration", outcome: "allowed", resourceId: person.id });
}
/**
 * Integrity as the audit screen reports it: how much of the chain has been walked since the
 * last checkpoint, and when the whole chain was last walked. The incremental check costs only
 * the rows that have arrived since, which is what makes it affordable on a page view; the
 * scheduled full pass is what can see an alteration made before a checkpoint.
 */
export async function readChainIntegrity() {
  const [incremental, lastFull] = await Promise.all([verifyAuditChainFrom(), latestCheckpoint(true)]);
  return {
    checked: incremental.checked, brokenSeq: incremental.brokenSeq, fromSeq: incremental.fromSeq,
    lastFullPassAt: lastFull?.verifiedAt ?? null, lastFullPassChecked: lastFull?.checked ?? 0,
  };
}
/** The scheduled pass. Walks everything and records what it found, clean or not. */
export async function verifyChainFully() {
  const result = await verifyAuditChainFrom({ full: true });
  await appendAudit({ clinicId: null, actorId: null, action: "audit.chain_verified", purpose: "audit",
    // A broken chain is recorded as a refusal: it is the one audit outcome that is not "fine".
    outcome: result.brokenSeq === null ? "allowed" : "denied",
    reason: result.brokenSeq === null ? `clean:${result.checked}` : `broken:${result.brokenSeq}` });
  if (result.brokenSeq !== null) logOperational("job.failed", { code: "AUDIT_CHAIN_BROKEN" });
  return result;
}
// Administrators may read the audit log. That privilege grants no chart access, and
// reading the log is itself an audited event.
export async function exportAuditLog(inputActor: Actor, input: unknown) {
  const actor = actorSchema.parse(inputActor);
  const filters = auditFilterSchema.parse(input);
  await requireAdmin(actor);
  const rows = await exportAuditEvents(actor.clinicId, { ...filters, limit: 5_000 });
  await appendAudit({ clinicId: actor.clinicId, actorId: actor.id, action: "audit.exported", purpose: "audit", outcome: "allowed", reason: `${rows.length}` });
  return rows;
}
export async function readAuditLog(inputActor: Actor, input: unknown) {
  const actor = actorSchema.parse(inputActor);
  const filters = auditFilterSchema.parse(input);
  if (actor.role !== "admin" || !actor.mfaVerified || !await currentActorIsValid(actor)) {
    await appendAudit({ clinicId: actor.clinicId, actorId: actor.id, action: "audit.denied", purpose: "audit", outcome: "denied" });
    throw new AccessDeniedError();
  }
  await appendAudit({ clinicId: actor.clinicId, actorId: actor.id, patientId: filters.patientId ?? null, action: "audit.viewed", purpose: "audit", outcome: "allowed" });
  const [events, integrity, outcomes] = await Promise.all([
    listAuditEvents(actor.clinicId, filters), readChainIntegrity(),
    summariseAuditOutcomes(actor.clinicId, new Date(Date.now() - 30 * 86_400_000)),
  ]);
  return { events, integrity, outcomes };
}
