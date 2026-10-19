ALTER TABLE "observations" ADD COLUMN "encounter_id" uuid;
--> statement-breakpoint
-- Legacy observations retain unknown visit provenance rather than guessing a visit.
ALTER TABLE observations ADD CONSTRAINT observation_encounter_patient_fk
  FOREIGN KEY (clinic_id, encounter_id, patient_id) REFERENCES encounters(clinic_id, id, patient_id);

--> statement-breakpoint
-- Record mutation time after lock waits, rather than the transaction start time.
CREATE OR REPLACE FUNCTION protect_clinical_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.clinic_id IS DISTINCT FROM OLD.clinic_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR (to_jsonb(NEW)->'patient_id') IS DISTINCT FROM (to_jsonb(OLD)->'patient_id') THEN
    RAISE EXCEPTION 'Clinical record identity and provenance are immutable';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
