import { sql } from "drizzle-orm";
import { pgTable, pgEnum, uuid, text, timestamp, boolean, bigserial, index, uniqueIndex, check } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("user_role", ["patient", "clinician", "staff", "admin"]);
export const purposeEnum = pgEnum("access_purpose", ["patient.view", "scheduling", "clinical.read", "clinical.write", "prescribe"]);

export const clinics = pgTable("clinics", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").default("Europe/Istanbul").notNull(),
  currency: text("currency").default("TRY").notNull(),
});

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  clinicId: uuid("clinic_id").notNull().references(() => clinics.id),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  role: roleEnum("role").notNull(),
  patientId: uuid("patient_id"),
  passwordHash: text("password_hash").notNull(),
  mfaSecret: text("mfa_secret"),
  recoveryHashes: text("recovery_hashes").array().default(sql`'{}'::text[]`).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("user_email_unique").on(t.email), uniqueIndex("user_patient_unique").on(t.patientId),
  uniqueIndex("users_clinic_id_unique").on(t.clinicId, t.id),
  check("patient_link_role", sql`(${t.role} = 'patient' AND ${t.patientId} IS NOT NULL) OR (${t.role} <> 'patient' AND ${t.patientId} IS NULL)`)]);

export const careRelationships = pgTable("care_relationships", {
  id: uuid("id").defaultRandom().primaryKey(),
  clinicId: uuid("clinic_id").notNull().references(() => clinics.id),
  actorId: uuid("actor_id").notNull().references(() => users.id),
  patientId: uuid("patient_id").notNull(),
  purpose: purposeEnum("purpose").notNull(),
  emergency: boolean("emergency").default(false).notNull(),
  reason: text("reason"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
}, (t) => [index("care_access_lookup").on(t.clinicId, t.actorId, t.patientId, t.purpose),
  check("emergency_requires_reason_expiry", sql`NOT ${t.emergency} OR (${t.reason} IS NOT NULL AND length(${t.reason}) >= 20 AND ${t.expiresAt} IS NOT NULL)`)]);

export const invitations = pgTable("invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  clinicId: uuid("clinic_id").notNull().references(() => clinics.id),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  role: roleEnum("role").notNull(),
  /** Set only for a portal invitation, naming the patient record the account will link to. */
  patientId: uuid("patient_id"),
  tokenHash: text("token_hash").notNull(),
  invitedBy: uuid("invited_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [uniqueIndex("invitation_token_unique").on(t.tokenHash), index("invitation_clinic_lookup").on(t.clinicId, t.createdAt),
  uniqueIndex("invitation_pending_email").on(t.clinicId, t.email).where(sql`${t.consumedAt} IS NULL AND ${t.revokedAt} IS NULL`),
  uniqueIndex("invitation_pending_patient").on(t.clinicId, t.patientId).where(sql`${t.consumedAt} IS NULL AND ${t.revokedAt} IS NULL AND ${t.patientId} IS NOT NULL`),
  check("invitation_role", sql`${t.role} IN ('clinician', 'staff', 'patient')`),
  // Mirrors users.patient_link_role: a patient invitation names a patient, and no other does.
  check("invitation_patient_link_role", sql`(${t.role} = 'patient' AND ${t.patientId} IS NOT NULL) OR (${t.role} <> 'patient' AND ${t.patientId} IS NULL)`)]);

export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  clinicId: uuid("clinic_id"),
  actorId: uuid("actor_id"),
  patientId: uuid("patient_id"),
  action: text("action").notNull(),
  purpose: text("purpose").notNull(),
  outcome: text("outcome").notNull(),
  resourceId: uuid("resource_id"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  // All three are assigned by the chaining trigger, which overwrites whatever the caller
  // supplied. seq comes from the highest committed row inside the trigger's lock rather than
  // from the sequence default, so seq order and chain order cannot diverge.
  seq: bigserial("seq", { mode: "number" }).notNull(),
  prevHash: text("prev_hash"),
  hash: text("hash"),
}, (t) => [index("audit_clinic_time").on(t.clinicId, t.createdAt), index("audit_patient_time").on(t.patientId, t.createdAt), index("audit_actor_time").on(t.actorId, t.createdAt),
  uniqueIndex("audit_seq_unique").on(t.seq),
  check("audit_outcome", sql`${t.outcome} IN ('allowed', 'denied', 'emergency')`)]);
