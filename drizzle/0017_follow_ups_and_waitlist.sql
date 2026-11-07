CREATE TYPE "public"."follow_up_status" AS ENUM('pending', 'booked', 'closed');--> statement-breakpoint
CREATE TYPE "public"."waitlist_status" AS ENUM('waiting', 'booked', 'left');--> statement-breakpoint
CREATE TABLE "follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"patient_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"note" text,
	"status" "follow_up_status" DEFAULT 'pending' NOT NULL,
	"appointment_id" uuid,
	"reminded_at" timestamp with time zone,
	"closed_reason" text,
	CONSTRAINT "follow_up_booking" CHECK (("follow_ups"."status" = 'booked') = ("follow_ups"."appointment_id" IS NOT NULL)),
	CONSTRAINT "follow_up_closed_reason" CHECK (("follow_ups"."status" = 'closed') = ("follow_ups"."closed_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"patient_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"appointment_id" uuid,
	"reason" text NOT NULL,
	"status" "waitlist_status" DEFAULT 'waiting' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waitlist_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "follow_up_encounter" ON "follow_ups" USING btree ("encounter_id");--> statement-breakpoint
CREATE INDEX "follow_up_worklist" ON "follow_ups" USING btree ("clinic_id","status","due_on");--> statement-breakpoint
CREATE INDEX "follow_up_patient" ON "follow_ups" USING btree ("clinic_id","patient_id","status");--> statement-breakpoint
CREATE INDEX "follow_up_appointment" ON "follow_ups" USING btree ("appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_entries_clinic_id_unique" ON "waitlist_entries" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_one_active" ON "waitlist_entries" USING btree ("clinic_id","patient_id","provider_id") WHERE "waitlist_entries"."status" = 'waiting' AND "waitlist_entries"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "waitlist_queue" ON "waitlist_entries" USING btree ("clinic_id","provider_id","status","created_at");--> statement-breakpoint
CREATE INDEX "waitlist_appointment" ON "waitlist_entries" USING btree ("appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_offer_once" ON "waitlist_offers" USING btree ("entry_id","slot_id");--> statement-breakpoint
CREATE INDEX "waitlist_offer_report" ON "waitlist_offers" USING btree ("clinic_id","accepted_at");--> statement-breakpoint
CREATE INDEX "waitlist_offer_slot" ON "waitlist_offers" USING btree ("slot_id");--> statement-breakpoint
-- The same tenant-isolation and provenance rules the rest of the schema carries.
ALTER TABLE follow_ups ADD CONSTRAINT follow_ups_clinic_fk FOREIGN KEY (clinic_id) REFERENCES clinics(id);
ALTER TABLE follow_ups ADD CONSTRAINT follow_ups_creator_scope_fk FOREIGN KEY (clinic_id, created_by) REFERENCES users(clinic_id, id);
ALTER TABLE follow_ups ADD CONSTRAINT follow_ups_updater_scope_fk FOREIGN KEY (clinic_id, updated_by) REFERENCES users(clinic_id, id);
ALTER TABLE follow_ups ADD CONSTRAINT follow_ups_provider_scope_fk FOREIGN KEY (clinic_id, provider_id) REFERENCES users(clinic_id, id);
ALTER TABLE follow_ups ADD CONSTRAINT follow_ups_patient_scope_fk FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id);
ALTER TABLE follow_ups ADD CONSTRAINT follow_ups_encounter_patient_fk FOREIGN KEY (clinic_id, encounter_id, patient_id) REFERENCES encounters(clinic_id, id, patient_id);
ALTER TABLE follow_ups ADD CONSTRAINT follow_ups_appointment_scope_fk FOREIGN KEY (clinic_id, appointment_id) REFERENCES appointments(clinic_id, id);
CREATE TRIGGER protect_provenance BEFORE UPDATE ON follow_ups FOR EACH ROW EXECUTE FUNCTION protect_clinical_provenance();
--> statement-breakpoint
ALTER TABLE waitlist_entries ADD CONSTRAINT waitlist_entries_clinic_fk FOREIGN KEY (clinic_id) REFERENCES clinics(id);
ALTER TABLE waitlist_entries ADD CONSTRAINT waitlist_entries_creator_scope_fk FOREIGN KEY (clinic_id, created_by) REFERENCES users(clinic_id, id);
ALTER TABLE waitlist_entries ADD CONSTRAINT waitlist_entries_updater_scope_fk FOREIGN KEY (clinic_id, updated_by) REFERENCES users(clinic_id, id);
ALTER TABLE waitlist_entries ADD CONSTRAINT waitlist_entries_provider_scope_fk FOREIGN KEY (clinic_id, provider_id) REFERENCES users(clinic_id, id);
ALTER TABLE waitlist_entries ADD CONSTRAINT waitlist_entries_patient_scope_fk FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id);
ALTER TABLE waitlist_entries ADD CONSTRAINT waitlist_entries_appointment_scope_fk FOREIGN KEY (clinic_id, appointment_id) REFERENCES appointments(clinic_id, id);
CREATE TRIGGER protect_provenance BEFORE UPDATE ON waitlist_entries FOR EACH ROW EXECUTE FUNCTION protect_clinical_provenance();
--> statement-breakpoint
ALTER TABLE waitlist_offers ADD CONSTRAINT waitlist_offers_entry_scope_fk FOREIGN KEY (clinic_id, entry_id) REFERENCES waitlist_entries(clinic_id, id);
ALTER TABLE waitlist_offers ADD CONSTRAINT waitlist_offers_slot_scope_fk FOREIGN KEY (clinic_id, slot_id) REFERENCES availability_slots(clinic_id, id);
