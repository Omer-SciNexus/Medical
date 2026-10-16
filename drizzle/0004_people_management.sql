CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "invitation_role" CHECK ("invitations"."role" IN ('clinician', 'staff'))
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_token_unique" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitation_clinic_lookup" ON "invitations" USING btree ("clinic_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_pending_email" ON "invitations" USING btree ("clinic_id","email") WHERE "invitations"."consumed_at" IS NULL AND "invitations"."revoked_at" IS NULL;
--> statement-breakpoint
-- Composite scope FK, matching the tenant-isolation pattern: an invitation cannot name an
-- inviter who belongs to a different clinic, even though invited_by alone already has a
-- (weaker) FK to users(id) from the declaration above.
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_scope_fk" FOREIGN KEY ("clinic_id", "invited_by") REFERENCES "users"("clinic_id", "id");
--> statement-breakpoint
-- 0001 granted the app role privileges on every table that existed at the time; nothing since
-- has granted them on a table created afterward. Default privileges close that gap for every
-- future migration, and this explicit grant covers the table this migration itself just created.
ALTER DEFAULT PRIVILEGES FOR ROLE meridian_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO meridian_app;
GRANT SELECT, INSERT, UPDATE ON "invitations" TO meridian_app;