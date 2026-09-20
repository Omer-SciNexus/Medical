import { sql } from "drizzle-orm";
import { pgTable, text, uuid, timestamp, integer, numeric, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { recordColumns } from "@/platform/columns";

export const encounters = pgTable("encounters", {
  ...recordColumns(), patientId: uuid("patient_id").notNull(), appointmentId: uuid("appointment_id").notNull(),
  clinicianId: uuid("clinician_id").notNull(), status: text("status").default("in_progress").notNull(),
  summary: text("summary"), publishedAt: timestamp("published_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [uniqueIndex("encounters_clinic_id_unique").on(t.clinicId, t.id), uniqueIndex("encounter_appointment").on(t.appointmentId), index("encounter_patient").on(t.clinicId, t.patientId), check("encounter_status", sql`${t.status} IN ('in_progress', 'completed', 'cancelled')`)]);

export const allergies = pgTable("allergies", {
  ...recordColumns(), patientId: uuid("patient_id").notNull(), substance: text("substance").notNull(),
  reaction: text("reaction").notNull(), severity: text("severity").notNull(),
}, (t) => [index("allergy_patient").on(t.clinicId, t.patientId), check("allergy_severity", sql`${t.severity} IN ('mild', 'moderate', 'severe')`)]);

export const problems = pgTable("problems", {
  ...recordColumns(), patientId: uuid("patient_id").notNull(), description: text("description").notNull(),
  status: text("status").default("active").notNull(),
}, (t) => [index("problem_patient").on(t.clinicId, t.patientId), check("problem_status", sql`${t.status} IN ('active', 'resolved')`)]);

export const observations = pgTable("observations", {
  ...recordColumns(), patientId: uuid("patient_id").notNull(), label: text("label").notNull(),
  value: numeric("value").notNull(), unit: text("unit").notNull(),
  referenceLow: numeric("reference_low"), referenceHigh: numeric("reference_high"),
  flag: text("flag").default("normal").notNull(), observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
}, (t) => [index("observation_patient_time").on(t.clinicId, t.patientId, t.observedAt), check("observation_flag", sql`${t.flag} IN ('normal', 'low', 'high', 'critical')`)]);

export const noteVersions = pgTable("note_versions", {
  ...recordColumns(), patientId: uuid("patient_id").notNull(), encounterId: uuid("encounter_id").notNull(),
  version: integer("version").notNull(), revision: integer("revision").default(1).notNull(),
  content: text("content").notNull(), template: text("template").default("soap").notNull(),
  status: text("status").default("draft").notNull(), amendmentReason: text("amendment_reason"),
  previousVersionId: uuid("previous_version_id"), signedAt: timestamp("signed_at", { withTimezone: true }), signedBy: uuid("signed_by"),
}, (t) => [uniqueIndex("notes_clinic_id_unique").on(t.clinicId, t.id), uniqueIndex("note_encounter_version").on(t.encounterId, t.version),
  check("note_valid_version", sql`${t.version} > 0 AND ${t.revision} > 0`), check("note_status", sql`${t.status} IN ('draft', 'signed', 'amended')`),
  check("amendment_reason_required", sql`${t.previousVersionId} IS NULL OR (${t.amendmentReason} IS NOT NULL AND length(${t.amendmentReason}) >= 10)`),
  check("signed_note_has_signature", sql`${t.status} = 'draft' OR (${t.signedAt} IS NOT NULL AND ${t.signedBy} IS NOT NULL)`)]);

export const medications = pgTable("medications", {
  id: uuid("id").defaultRandom().primaryKey(), name: text("name").notNull(), ingredient: text("ingredient").notNull(),
  form: text("form").notNull(), strength: text("strength").notNull(),
  source: text("source").default("synthetic-fixture").notNull(),
});

export const prescriptions = pgTable("prescriptions", {
  ...recordColumns(), patientId: uuid("patient_id").notNull(), encounterId: uuid("encounter_id").notNull(),
  medicationId: uuid("medication_id").notNull().references(() => medications.id),
  dose: numeric("dose").notNull(), unit: text("unit").notNull(), route: text("route").notNull(),
  frequency: text("frequency").notNull(), durationDays: integer("duration_days").notNull(),
  status: text("status").default("draft").notNull(), safetyStatus: text("safety_status").default("unchecked").notNull(),
  safetySource: text("safety_source"), safetyCheckedAt: timestamp("safety_checked_at", { withTimezone: true }),
  overrideReason: text("override_reason"), issuedAt: timestamp("issued_at", { withTimezone: true }),
}, (t) => [index("prescription_patient").on(t.clinicId, t.patientId), check("positive_dose_duration", sql`${t.dose} > 0 AND ${t.durationDays} > 0`),
  check("prescription_status", sql`${t.status} IN ('draft', 'issued', 'cancelled')`), check("safety_status", sql`${t.safetyStatus} IN ('unchecked', 'clear', 'warning', 'blocked', 'unavailable')`),
  check("issued_requires_safety", sql`${t.status} <> 'issued' OR (${t.issuedAt} IS NOT NULL AND ${t.safetyCheckedAt} IS NOT NULL AND ${t.safetySource} IS NOT NULL AND ${t.safetySource} <> 'synthetic-fixture' AND (${t.safetyStatus} = 'clear' OR (${t.safetyStatus} = 'warning' AND ${t.overrideReason} IS NOT NULL AND length(${t.overrideReason}) >= 20)))`)]);
