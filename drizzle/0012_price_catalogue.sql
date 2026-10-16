CREATE TABLE "charge_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"charge_id" uuid NOT NULL,
	"service_id" uuid,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_amount_minor" integer NOT NULL,
	"amount_minor" integer NOT NULL,
	CONSTRAINT "line_positive_quantity" CHECK ("charge_lines"."quantity" > 0),
	CONSTRAINT "line_nonnegative" CHECK ("charge_lines"."unit_amount_minor" >= 0),
	CONSTRAINT "line_amount_is_quantity_times_unit" CHECK ("charge_lines"."amount_minor" = "charge_lines"."quantity" * "charge_lines"."unit_amount_minor")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "service_nonnegative" CHECK ("services"."amount_minor" >= 0),
	CONSTRAINT "service_currency" CHECK ("services"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "paid_method" text;--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "void_reason" text;--> statement-breakpoint
CREATE INDEX "charge_line_charge" ON "charge_lines" USING btree ("clinic_id","charge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "services_clinic_id_unique" ON "services" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_clinic_code" ON "services" USING btree ("clinic_id","code") WHERE "services"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "service_clinic_default" ON "services" USING btree ("clinic_id") WHERE "services"."is_default" AND "services"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "charges_clinic_id_unique" ON "charges" USING btree ("clinic_id","id");--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charge_paid_detail" CHECK ("charges"."status" <> 'paid' OR ("charges"."paid_at" IS NOT NULL AND "charges"."paid_method" IN ('cash', 'card', 'transfer', 'insurance')));--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charge_void_detail" CHECK ("charges"."status" <> 'void' OR ("charges"."void_reason" IS NOT NULL AND length("charges"."void_reason") >= 5));
--> statement-breakpoint
-- The tenant-isolation and provenance rules every record table carries.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['services','charge_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (clinic_id) REFERENCES clinics(id)', table_name, table_name || '_clinic_fk');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (clinic_id, created_by) REFERENCES users(clinic_id, id)', table_name, table_name || '_creator_scope_fk');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (clinic_id, updated_by) REFERENCES users(clinic_id, id)', table_name, table_name || '_updater_scope_fk');
    EXECUTE format('CREATE TRIGGER protect_provenance BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION protect_clinical_provenance()', table_name);
  END LOOP;
END $$;
--> statement-breakpoint
-- A line belongs to an invoice in the same clinic, and names a service from the same clinic.
ALTER TABLE charge_lines ADD CONSTRAINT charge_line_charge_scope_fk FOREIGN KEY (clinic_id, charge_id) REFERENCES charges(clinic_id, id);
ALTER TABLE charge_lines ADD CONSTRAINT charge_line_service_scope_fk FOREIGN KEY (clinic_id, service_id) REFERENCES services(clinic_id, id);
--> statement-breakpoint
-- The invoice total is the sum of its live lines, maintained here rather than by whoever
-- happens to write a line. Nothing can leave the two disagreeing.
CREATE FUNCTION recompute_charge_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid := coalesce(NEW.charge_id, OLD.charge_id);
BEGIN
  UPDATE charges SET amount_minor = (
    SELECT coalesce(sum(line.amount_minor), 0) FROM charge_lines line WHERE line.charge_id = target AND line.deleted_at IS NULL
  ) WHERE id = target;
  RETURN NULL;
END $$;
CREATE TRIGGER charge_total_from_lines AFTER INSERT OR UPDATE OR DELETE ON charge_lines
  FOR EACH ROW EXECUTE FUNCTION recompute_charge_total();
