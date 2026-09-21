import "server-only";
import { and, eq, isNull, or, gt, sql } from "drizzle-orm";
import { getDb, type Transaction } from "@/platform/db";
import { auditLog, careRelationships, clinics, users } from "./schema";
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
export async function consumeRecoveryCode(userId: string, codeHash: string) {
  const result = await getDb().transaction(async (tx) => {
    const [user] = await tx.update(users).set({ recoveryHashes: sql`array_remove(${users.recoveryHashes}, ${codeHash})`, updatedAt: new Date() }).where(and(eq(users.id, userId), eq(users.active, true), sql`${codeHash} = ANY(${users.recoveryHashes})`)).returning();
    if (user) await appendAudit({ clinicId: user.clinicId, actorId: user.id, action: "identity.recovery_used", purpose: "authentication", outcome: "allowed" }, tx);
    return user;
  });
  return result;
}
