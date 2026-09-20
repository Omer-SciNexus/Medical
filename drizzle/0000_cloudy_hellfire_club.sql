CREATE TYPE "public"."access_purpose" AS ENUM('patient.view', 'scheduling', 'clinical.read', 'clinical.write', 'prescribe');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('patient', 'clinician', 'staff', 'admin');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('booked', 'checked_in', 'rooming', 'ready', 'in_progress', 'done', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TABLE "charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "charge_nonnegative" CHECK ("charges"."amount_minor" >= 0),
	CONSTRAINT "charge_currency" CHECK ("charges"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "charge_status" CHECK ("charges"."status" IN ('pending', 'paid', 'void'))
);
--> statement-breakpoint
CREATE TABLE "allergies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"patient_id" uuid NOT NULL,
	"substance" text NOT NULL,
	"reaction" text NOT NULL,
	"severity" text NOT NULL,
	CONSTRAINT "allergy_severity" CHECK ("allergies"."severity" IN ('mild', 'moderate', 'severe'))
);
--> statement-breakpoint
CREATE TABLE "encounters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"clinician_id" uuid NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"summary" text,
	"published_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "encounter_status" CHECK ("encounters"."status" IN ('in_progress', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "medications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"ingredient" text NOT NULL,
	"form" text NOT NULL,
	"strength" text NOT NULL,
	"source" text DEFAULT 'synthetic-fixture' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"content" text NOT NULL,
	"template" text DEFAULT 'soap' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"amendment_reason" text,
	"previous_version_id" uuid,
	"signed_at" timestamp with time zone,
	"signed_by" uuid,
	CONSTRAINT "note_valid_version" CHECK ("note_versions"."version" > 0 AND "note_versions"."revision" > 0),
	CONSTRAINT "note_status" CHECK ("note_versions"."status" IN ('draft', 'signed', 'amended')),
	CONSTRAINT "amendment_reason_required" CHECK ("note_versions"."previous_version_id" IS NULL OR ("note_versions"."amendment_reason" IS NOT NULL AND length("note_versions"."amendment_reason") >= 10)),
	CONSTRAINT "signed_note_has_signature" CHECK ("note_versions"."status" = 'draft' OR ("note_versions"."signed_at" IS NOT NULL AND "note_versions"."signed_by" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"patient_id" uuid NOT NULL,
	"label" text NOT NULL,
	"value" numeric NOT NULL,
	"unit" text NOT NULL,
	"reference_low" numeric,
	"reference_high" numeric,
	"flag" text DEFAULT 'normal' NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "observation_flag" CHECK ("observations"."flag" IN ('normal', 'low', 'high', 'critical'))
);
--> statement-breakpoint
CREATE TABLE "prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"medication_id" uuid NOT NULL,
	"dose" numeric NOT NULL,
	"unit" text NOT NULL,
	"route" text NOT NULL,
	"frequency" text NOT NULL,
	"duration_days" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"safety_status" text DEFAULT 'unchecked' NOT NULL,
	"safety_source" text,
	"safety_checked_at" timestamp with time zone,
	"override_reason" text,
	"issued_at" timestamp with time zone,
	CONSTRAINT "positive_dose_duration" CHECK ("prescriptions"."dose" > 0 AND "prescriptions"."duration_days" > 0),
	CONSTRAINT "prescription_status" CHECK ("prescriptions"."status" IN ('draft', 'issued', 'cancelled')),
	CONSTRAINT "safety_status" CHECK ("prescriptions"."safety_status" IN ('unchecked', 'clear', 'warning', 'blocked', 'unavailable')),
	CONSTRAINT "issued_requires_safety" CHECK ("prescriptions"."status" <> 'issued' OR ("prescriptions"."issued_at" IS NOT NULL AND "prescriptions"."safety_checked_at" IS NOT NULL AND "prescriptions"."safety_source" IS NOT NULL AND "prescriptions"."safety_source" <> 'synthetic-fixture' AND ("prescriptions"."safety_status" = 'clear' OR ("prescriptions"."safety_status" = 'warning' AND "prescriptions"."override_reason" IS NOT NULL AND length("prescriptions"."override_reason") >= 20))))
);
--> statement-breakpoint
CREATE TABLE "problems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"patient_id" uuid NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "problem_status" CHECK ("problems"."status" IN ('active', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid,
	"actor_id" uuid,
	"patient_id" uuid,
	"action" text NOT NULL,
	"purpose" text NOT NULL,
	"outcome" text NOT NULL,
	"resource_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_outcome" CHECK ("audit_log"."outcome" IN ('allowed', 'denied', 'emergency'))
);
--> statement-breakpoint
CREATE TABLE "care_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"purpose" "access_purpose" NOT NULL,
	"emergency" boolean DEFAULT false NOT NULL,
	"reason" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "emergency_requires_reason_expiry" CHECK (NOT "care_relationships"."emergency" OR ("care_relationships"."reason" IS NOT NULL AND length("care_relationships"."reason") >= 20 AND "care_relationships"."expires_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "clinics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Europe/Istanbul' NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"patient_id" uuid,
	"password_hash" text NOT NULL,
	"mfa_secret" text,
	"recovery_hashes" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_link_role" CHECK (("users"."role" = 'patient' AND "users"."patient_id" IS NOT NULL) OR ("users"."role" <> 'patient' AND "users"."patient_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"patient_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"preparation" text DEFAULT '' NOT NULL,
	"status" "appointment_status" DEFAULT 'booked' NOT NULL,
	"checked_in_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"provider_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	CONSTRAINT "slot_positive_duration" CHECK ("availability_slots"."ends_at" > "availability_slots"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"given_name" text NOT NULL,
	"surname" text NOT NULL,
	"birth_date" date NOT NULL,
	"sex" text NOT NULL,
	"mrn" text NOT NULL,
	CONSTRAINT "patient_sex" CHECK ("patients"."sex" IN ('female', 'male', 'intersex', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_relationships" ADD CONSTRAINT "care_relationships_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_relationships" ADD CONSTRAINT "care_relationships_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_relationships" ADD CONSTRAINT "care_relationships_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "charge_encounter_unique" ON "charges" USING btree ("encounter_id");--> statement-breakpoint
CREATE INDEX "allergy_patient" ON "allergies" USING btree ("clinic_id","patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "encounters_clinic_id_unique" ON "encounters" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "encounter_appointment" ON "encounters" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "encounter_patient" ON "encounters" USING btree ("clinic_id","patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notes_clinic_id_unique" ON "note_versions" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "note_encounter_version" ON "note_versions" USING btree ("encounter_id","version");--> statement-breakpoint
CREATE INDEX "observation_patient_time" ON "observations" USING btree ("clinic_id","patient_id","observed_at");--> statement-breakpoint
CREATE INDEX "prescription_patient" ON "prescriptions" USING btree ("clinic_id","patient_id");--> statement-breakpoint
CREATE INDEX "problem_patient" ON "problems" USING btree ("clinic_id","patient_id");--> statement-breakpoint
CREATE INDEX "audit_clinic_time" ON "audit_log" USING btree ("clinic_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_patient_time" ON "audit_log" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_actor_time" ON "audit_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "care_access_lookup" ON "care_relationships" USING btree ("clinic_id","actor_id","patient_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "user_patient_unique" ON "users" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_clinic_id_unique" ON "users" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_clinic_id_unique" ON "appointments" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "active_slot_booking" ON "appointments" USING btree ("slot_id") WHERE "appointments"."deleted_at" IS NULL AND "appointments"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "patient_appointments" ON "appointments" USING btree ("clinic_id","patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slots_clinic_id_unique" ON "availability_slots" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE INDEX "slot_availability_lookup" ON "availability_slots" USING btree ("clinic_id","provider_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_clinic_mrn" ON "patients" USING btree ("clinic_id","mrn");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_clinic_id_unique" ON "patients" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE INDEX "patient_name_lookup" ON "patients" USING btree ("clinic_id","surname");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_idempotency" ON "outbox" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "outbox_pending" ON "outbox" USING btree ("dispatched_at","created_at");