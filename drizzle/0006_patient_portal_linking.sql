ALTER TABLE "invitations" DROP CONSTRAINT "invitation_role";--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "patient_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_pending_patient" ON "invitations" USING btree ("clinic_id","patient_id") WHERE "invitations"."consumed_at" IS NULL AND "invitations"."revoked_at" IS NULL AND "invitations"."patient_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitation_patient_link_role" CHECK (("invitations"."role" = 'patient' AND "invitations"."patient_id" IS NOT NULL) OR ("invitations"."role" <> 'patient' AND "invitations"."patient_id" IS NULL));--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitation_role" CHECK ("invitations"."role" IN ('clinician', 'staff', 'patient'));--> statement-breakpoint
-- A portal invitation cannot name a patient from another clinic. patient_id is nullable, and a
-- composite foreign key is not checked when any part of it is null, so staff invitations pass.
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_patient_scope_fk" FOREIGN KEY ("clinic_id", "patient_id") REFERENCES "patients"("clinic_id", "id");