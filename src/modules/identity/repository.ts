import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, or, gt, sql } from "drizzle-orm";
import { getDb, getAuditDb, type Transaction } from "@/platform/db";
import { auditLog, careRelationships, clinics, invitations, users } from "./schema";
import type { Actor, AccessPurpose } from "./validators";

export type AuditEvent = {
  clinicId: string | null; actorId: string | null; patientId?: string | null;
  action: string; purpose: string; outcome: "allowed" | "denied" | "emergency";
  resourceId?: string; reason?: string;
};
export async function appendAudit(event: AuditEvent, tx?: Transaction) {
  await (tx ?? getDb()).insert(auditLog).values(event);
}
export async function findUserByEmail(email: string) {
  const [user] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  return user;
}
export async function findUserById(id: string, tx?: Transaction) {
  const [user] = await (tx ?? getDb()).select().from(users).where(eq(users.id, id)).limit(1);
  return user;
}
export async function createClinicOwner(input: { clinicName: string; displayName: string; email: string; passwordHash: string }) {
  return getDb().transaction(async (tx) => {
    const [clinic] = await tx.insert(clinics).values({ name: input.clinicName }).returning();
    // Public registration always owns a NEW clinic. Never accept a clinic ID or role from the client.
    const [user] = await tx.insert(users).values({ clinicId: clinic.id, displayName: input.displayName, email: input.email, passwordHash: input.passwordHash, role: "admin", patientId: null }).returning();
    await appendAudit({ clinicId: clinic.id, actorId: user.id, action: "identity.workspace_created", purpose: "registration", outcome: "allowed", resourceId: clinic.id }, tx);
    return user;
  });
}
export async function findAccountSummary(actor: Actor) {
  const [account] = await getDb().select({ displayName: users.displayName, clinicName: clinics.name }).from(users).innerJoin(clinics, eq(users.clinicId, clinics.id)).where(and(eq(users.id, actor.id), eq(clinics.id, actor.clinicId))).limit(1);
  return account;
}
export async function hasCareRelationship(actor: Actor, patientId: string, purpose: AccessPurpose, tx?: Transaction) {
  const [relationship] = await (tx ?? getDb()).select({ id: careRelationships.id }).from(careRelationships).where(and(
    eq(careRelationships.clinicId, actor.clinicId), eq(careRelationships.actorId, actor.id), eq(careRelationships.patientId, patientId),
    eq(careRelationships.purpose, purpose), isNull(careRelationships.revokedAt),
    or(isNull(careRelationships.expiresAt), gt(careRelationships.expiresAt, new Date())),
  )).limit(1);
  return Boolean(relationship);
}
export async function createEmergencyRelationship(actor: Actor, patientId: string, reason: string, tx: Transaction) {
  // Emergency chart review only. Prescribing and changes need normal care authority.
  await tx.insert(careRelationships).values({ clinicId: actor.clinicId, actorId: actor.id, patientId, purpose: "clinical.read", emergency: true, reason, expiresAt: new Date(Date.now() + 15 * 60_000), createdBy: actor.id });
  await appendAudit({ clinicId: actor.clinicId, actorId: actor.id, patientId, action: "access.break_glass", purpose: "clinical.read", outcome: "emergency", reason }, tx);
}
export async function enrollMfa(userId: string, encrypted: string, recoveryHashes: string[]) {
  return getDb().transaction(async (tx) => {
    const [user] = await tx.update(users).set({ mfaSecret: encrypted, recoveryHashes, updatedAt: new Date() }).where(and(eq(users.id, userId), isNull(users.mfaSecret), eq(users.active, true))).returning();
    if (!user) throw new Error("MFA enrollment is no longer available.");
    await appendAudit({ clinicId: user.clinicId, actorId: user.id, action: "identity.mfa_enrolled", purpose: "authentication", outcome: "allowed" }, tx);
    return user;
  });
}
export async function listClinicians(clinicId: string) {
  return getDb().select({ id: users.id, displayName: users.displayName }).from(users)
    .where(and(eq(users.clinicId, clinicId), eq(users.role, "clinician"), eq(users.active, true))).orderBy(asc(users.displayName)).limit(100);
}
export async function findClinicSettings(clinicId: string) {
  const [clinic] = await getDb().select({ id: clinics.id, name: clinics.name, timezone: clinics.timezone, currency: clinics.currency }).from(clinics).where(eq(clinics.id, clinicId)).limit(1);
  return clinic;
}
export type AuditFilters = { actorId?: string; patientId?: string; action?: string; from?: Date; to?: Date; before?: number; limit: number };
// Reads use the auditor credential and return identifiers only; it holds no grant on
// users or patients, so no name can be resolved here even by an authorized viewer.
export async function listAuditEvents(clinicId: string, filters: AuditFilters) {
  return getAuditDb().select({ seq: auditLog.seq, id: auditLog.id, actorId: auditLog.actorId, patientId: auditLog.patientId, action: auditLog.action,
    purpose: auditLog.purpose, outcome: auditLog.outcome, resourceId: auditLog.resourceId, reason: auditLog.reason, createdAt: auditLog.createdAt, hash: auditLog.hash })
    .from(auditLog).where(and(eq(auditLog.clinicId, clinicId),
      filters.actorId ? eq(auditLog.actorId, filters.actorId) : undefined,
      filters.patientId ? eq(auditLog.patientId, filters.patientId) : undefined,
      filters.action ? eq(auditLog.action, filters.action) : undefined,
      filters.from ? gte(auditLog.createdAt, filters.from) : undefined,
      filters.to ? lte(auditLog.createdAt, filters.to) : undefined,
      filters.before ? lt(auditLog.seq, filters.before) : undefined))
    .orderBy(desc(auditLog.seq)).limit(filters.limit);
}
export async function verifyAuditChain() {
  const rows = await getAuditDb().execute<{ checked: string | number; broken_seq: string | number | null }>(sql`SELECT * FROM verify_audit_chain()`);
  const [result] = "rows" in rows ? rows.rows : (rows as unknown as { checked: string | number; broken_seq: string | number | null }[]);
  return { checked: Number(result?.checked ?? 0), brokenSeq: result?.broken_seq == null ? null : Number(result.broken_seq) };
}
export async function consumeRecoveryCode(userId: string, codeHash: string) {
  const result = await getDb().transaction(async (tx) => {
    const [user] = await tx.update(users).set({ recoveryHashes: sql`array_remove(${users.recoveryHashes}, ${codeHash})`, updatedAt: new Date() }).where(and(eq(users.id, userId), eq(users.active, true), sql`${codeHash} = ANY(${users.recoveryHashes})`)).returning();
    if (user) await appendAudit({ clinicId: user.clinicId, actorId: user.id, action: "identity.recovery_used", purpose: "authentication", outcome: "allowed" }, tx);
    return user;
  });
  return result;
}
// People a clinic's administrator can see and manage. Patient-linked accounts are managed
// through patient registration, not this list.
export async function listClinicPeople(clinicId: string) {
  return getDb().select({ id: users.id, email: users.email, displayName: users.displayName, role: users.role, active: users.active, hasMfa: sql<boolean>`${users.mfaSecret} IS NOT NULL`, createdAt: users.createdAt })
    .from(users).where(and(eq(users.clinicId, clinicId), ne(users.role, "patient"))).orderBy(asc(users.displayName)).limit(500);
}
export async function findClinicUser(clinicId: string, userId: string, tx?: Transaction) {
  const [user] = await (tx ?? getDb()).select().from(users).where(and(eq(users.id, userId), eq(users.clinicId, clinicId))).limit(1);
  return user;
}
export async function setUserActive(clinicId: string, userId: string, active: boolean, updatedBy: string) {
  const [user] = await getDb().update(users).set({ active, updatedAt: new Date() }).where(and(eq(users.id, userId), eq(users.clinicId, clinicId))).returning();
  if (user) await appendAudit({ clinicId, actorId: updatedBy, action: active ? "identity.person_reactivated" : "identity.person_deactivated", purpose: "administration", outcome: "allowed", resourceId: userId });
  return user;
}
export async function clearMfaEnrollment(clinicId: string, userId: string, updatedBy: string) {
  const [user] = await getDb().update(users).set({ mfaSecret: null, recoveryHashes: [], updatedAt: new Date() }).where(and(eq(users.id, userId), eq(users.clinicId, clinicId))).returning();
  if (user) await appendAudit({ clinicId, actorId: updatedBy, action: "identity.mfa_reset", purpose: "administration", outcome: "allowed", resourceId: userId });
  return user;
}
export async function createInvitation(input: { clinicId: string; email: string; displayName: string; role: "clinician" | "staff" | "patient"; patientId?: string | null; tokenHash: string; invitedBy: string; expiresAt: Date }) {
  const [invitation] = await getDb().insert(invitations).values(input).returning({ id: invitations.id, expiresAt: invitations.expiresAt });
  await appendAudit({ clinicId: input.clinicId, actorId: input.invitedBy, patientId: input.patientId ?? null, action: "identity.invitation_created", purpose: input.role === "patient" ? "patient.view" : "administration", outcome: "allowed", resourceId: invitation.id });
  return invitation;
}
export async function findPortalAccount(clinicId: string, patientId: string) {
  const [user] = await getDb().select({ id: users.id, email: users.email, active: users.active })
    .from(users).where(and(eq(users.clinicId, clinicId), eq(users.patientId, patientId))).limit(1);
  return user;
}
export async function listPortalAccountsFor(clinicId: string, patientIds: string[]) {
  if (!patientIds.length) return [];
  return getDb().select({ patientId: users.patientId, id: users.id, active: users.active })
    .from(users).where(and(eq(users.clinicId, clinicId), inArray(users.patientId, patientIds))).limit(100);
}
export async function listPendingPatientInvitations(clinicId: string, patientIds: string[]) {
  if (!patientIds.length) return [];
  return getDb().select({ id: invitations.id, patientId: invitations.patientId, email: invitations.email, expiresAt: invitations.expiresAt })
    .from(invitations).where(and(eq(invitations.clinicId, clinicId), inArray(invitations.patientId, patientIds), isNull(invitations.consumedAt), isNull(invitations.revokedAt))).limit(100);
}
export async function listInvitations(clinicId: string) {
  return getDb().select({ id: invitations.id, email: invitations.email, displayName: invitations.displayName, role: invitations.role,
    createdAt: invitations.createdAt, expiresAt: invitations.expiresAt, consumedAt: invitations.consumedAt, revokedAt: invitations.revokedAt })
    .from(invitations).where(eq(invitations.clinicId, clinicId)).orderBy(desc(invitations.createdAt)).limit(200);
}
const pendingInvitation = (clinicId: string, invitationId: string) =>
  and(eq(invitations.id, invitationId), eq(invitations.clinicId, clinicId), isNull(invitations.consumedAt), isNull(invitations.revokedAt));
export async function revokeInvitation(clinicId: string, invitationId: string, revokedBy: string) {
  const [invitation] = await getDb().update(invitations).set({ revokedAt: new Date() }).where(pendingInvitation(clinicId, invitationId)).returning({ id: invitations.id });
  if (invitation) await appendAudit({ clinicId, actorId: revokedBy, action: "identity.invitation_revoked", purpose: "administration", outcome: "allowed", resourceId: invitationId });
  return invitation;
}
export async function rotateInvitation(clinicId: string, invitationId: string, tokenHash: string, expiresAt: Date, resentBy: string) {
  const [invitation] = await getDb().update(invitations).set({ tokenHash, expiresAt }).where(pendingInvitation(clinicId, invitationId)).returning({ id: invitations.id, email: invitations.email });
  if (invitation) await appendAudit({ clinicId, actorId: resentBy, action: "identity.invitation_resent", purpose: "administration", outcome: "allowed", resourceId: invitationId });
  return invitation;
}
export async function findInvitationByTokenHash(tokenHash: string) {
  const [invitation] = await getDb().select().from(invitations).where(and(eq(invitations.tokenHash, tokenHash), isNull(invitations.consumedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date()))).limit(1);
  return invitation;
}
// Consumes the invitation and creates the account in one transaction, so a token can never
// back two accounts and a crash mid-way can never leave a consumed invitation without a user.
export async function consumeInvitation(invitationId: string, input: { clinicId: string; email: string; displayName: string; role: "clinician" | "staff" | "patient"; patientId: string | null; passwordHash: string }) {
  return getDb().transaction(async (tx) => {
    const [consumed] = await tx.update(invitations).set({ consumedAt: new Date() })
      .where(and(eq(invitations.id, invitationId), isNull(invitations.consumedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date()))).returning({ id: invitations.id });
    if (!consumed) return undefined;
    const [user] = await tx.insert(users).values({ clinicId: input.clinicId, email: input.email, displayName: input.displayName, role: input.role, passwordHash: input.passwordHash, patientId: input.patientId }).returning();
    await appendAudit({ clinicId: input.clinicId, actorId: user.id, patientId: input.patientId, action: "identity.invitation_accepted", purpose: input.role === "patient" ? "patient.view" : "administration", outcome: "allowed", resourceId: invitationId }, tx);
    return user;
  });
}
