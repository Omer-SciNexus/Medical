CREATE TYPE "public"."appointment_request_status" AS ENUM('pending', 'resolved', 'declined');--> statement-breakpoint
CREATE TABLE "appointment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "appointment_request_status" DEFAULT 'pending' NOT NULL,
	"given_name" text NOT NULL,
	"surname" text NOT NULL,
	"birth_date" date NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text,
	"reason" text NOT NULL,
	"preferred_times" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution" text,
	"linked_patient_id" uuid,
	CONSTRAINT "appointment_request_settled" CHECK (("appointment_requests"."status" = 'pending') = ("appointment_requests"."resolved_at" IS NULL AND "appointment_requests"."resolved_by" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "appointment_request_queue" ON "appointment_requests" USING btree ("clinic_id","status","created_at");--> statement-breakpoint
-- The same tenant-scoped references the rest of the schema carries: whoever settles a request,
-- and the patient it was linked to, belong to the clinic the request was sent to.
ALTER TABLE appointment_requests ADD CONSTRAINT appointment_requests_clinic_fk FOREIGN KEY (clinic_id) REFERENCES clinics(id);
ALTER TABLE appointment_requests ADD CONSTRAINT appointment_requests_resolver_scope_fk FOREIGN KEY (clinic_id, resolved_by) REFERENCES users(clinic_id, id);
ALTER TABLE appointment_requests ADD CONSTRAINT appointment_requests_patient_scope_fk FOREIGN KEY (clinic_id, linked_patient_id) REFERENCES patients(clinic_id, id);
