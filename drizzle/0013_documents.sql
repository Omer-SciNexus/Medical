CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"object_key" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "document_kind" CHECK ("documents"."kind" IN ('result', 'consent', 'referral', 'letter', 'other')),
	CONSTRAINT "document_size" CHECK ("documents"."byte_size" > 0 AND "documents"."byte_size" <= 26214400),
	CONSTRAINT "document_content_type" CHECK ("documents"."content_type" IN ('application/pdf', 'image/png', 'image/jpeg', 'image/tiff'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "documents_clinic_id_unique" ON "documents" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_object_key" ON "documents" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "document_patient" ON "documents" USING btree ("clinic_id","patient_id");--> statement-breakpoint
-- The same tenant-isolation and provenance rules the rest of the chart carries.
ALTER TABLE documents ADD CONSTRAINT documents_clinic_fk FOREIGN KEY (clinic_id) REFERENCES clinics(id);
ALTER TABLE documents ADD CONSTRAINT documents_creator_scope_fk FOREIGN KEY (clinic_id, created_by) REFERENCES users(clinic_id, id);
ALTER TABLE documents ADD CONSTRAINT documents_updater_scope_fk FOREIGN KEY (clinic_id, updated_by) REFERENCES users(clinic_id, id);
ALTER TABLE documents ADD CONSTRAINT documents_patient_scope_fk FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id);
ALTER TABLE documents ADD CONSTRAINT document_encounter_patient_fk FOREIGN KEY (clinic_id, encounter_id, patient_id) REFERENCES encounters(clinic_id, id, patient_id);
CREATE TRIGGER protect_provenance BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION protect_clinical_provenance();
