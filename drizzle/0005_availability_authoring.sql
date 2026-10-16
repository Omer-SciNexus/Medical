CREATE TABLE "availability_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"provider_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"slot_minutes" integer NOT NULL,
	CONSTRAINT "template_weekday" CHECK ("availability_templates"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "template_window" CHECK ("availability_templates"."start_minute" >= 0 AND "availability_templates"."end_minute" > "availability_templates"."start_minute" AND "availability_templates"."end_minute" <= 1440),
	CONSTRAINT "template_divides_evenly" CHECK ("availability_templates"."slot_minutes" BETWEEN 5 AND 240 AND ("availability_templates"."end_minute" - "availability_templates"."start_minute") % "availability_templates"."slot_minutes" = 0)
);
--> statement-breakpoint
CREATE TABLE "schedule_blackouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"provider_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "blackout_positive_duration" CHECK ("schedule_blackouts"."ends_at" > "schedule_blackouts"."starts_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "templates_clinic_id_unique" ON "availability_templates" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE INDEX "template_provider_lookup" ON "availability_templates" USING btree ("clinic_id","provider_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "blackouts_clinic_id_unique" ON "schedule_blackouts" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE INDEX "blackout_lookup" ON "schedule_blackouts" USING btree ("clinic_id","starts_at");
--> statement-breakpoint
-- Same tenant-isolation and provenance rules every other record table carries, which the
-- Drizzle schema cannot express: composite keys, exclusion over a range, and the trigger.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['availability_templates','schedule_blackouts'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (clinic_id) REFERENCES clinics(id)', table_name, table_name || '_clinic_fk');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (clinic_id, created_by) REFERENCES users(clinic_id, id)', table_name, table_name || '_creator_scope_fk');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (clinic_id, updated_by) REFERENCES users(clinic_id, id)', table_name, table_name || '_updater_scope_fk');
    -- provider_id is nullable on blackouts; a composite foreign key is skipped when any part is null.
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (clinic_id, provider_id) REFERENCES users(clinic_id, id)', table_name, table_name || '_provider_scope_fk');
    EXECUTE format('CREATE TRIGGER protect_provenance BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION protect_clinical_provenance()', table_name);
  END LOOP;
END $$;
--> statement-breakpoint
-- Two patterns for one provider on one weekday may not overlap, so a clash is reported by the
-- database rather than searched for in application code.
ALTER TABLE availability_templates ADD CONSTRAINT no_template_overlap
  EXCLUDE USING gist (clinic_id WITH =, provider_id WITH =, weekday WITH =, int4range(start_minute, end_minute, '[)') WITH &&)
  WHERE (deleted_at IS NULL);