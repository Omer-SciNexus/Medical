-- Cross-domain integrity is owned by migrations, not private schema imports.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE availability_slots ADD CONSTRAINT no_provider_slot_overlap
  EXCLUDE USING gist (clinic_id WITH =, provider_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (deleted_at IS NULL);
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['patients','availability_slots','appointments','encounters','allergies','problems','observations','note_versions','prescriptions','charges'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (clinic_id) REFERENCES clinics(id)', table_name, table_name || '_clinic_fk');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (clinic_id, created_by) REFERENCES users(clinic_id, id)', table_name, table_name || '_creator_scope_fk');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (clinic_id, updated_by) REFERENCES users(clinic_id, id)', table_name, table_name || '_updater_scope_fk');
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['appointments','encounters','allergies','problems','observations','note_versions','prescriptions','charges','care_relationships'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id)', table_name, table_name || '_patient_scope_fk');
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT user_patient_scope_fk FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id);
ALTER TABLE care_relationships ADD CONSTRAINT relationship_actor_scope_fk FOREIGN KEY (clinic_id, actor_id) REFERENCES users(clinic_id, id);
ALTER TABLE care_relationships ADD CONSTRAINT relationship_creator_scope_fk FOREIGN KEY (clinic_id, created_by) REFERENCES users(clinic_id, id);
ALTER TABLE availability_slots ADD CONSTRAINT slot_provider_scope_fk FOREIGN KEY (clinic_id, provider_id) REFERENCES users(clinic_id, id);
ALTER TABLE appointments ADD CONSTRAINT appointment_slot_scope_fk FOREIGN KEY (clinic_id, slot_id) REFERENCES availability_slots(clinic_id, id);
CREATE UNIQUE INDEX appointment_patient_identity ON appointments (clinic_id, id, patient_id);
ALTER TABLE encounters ADD CONSTRAINT encounter_appointment_patient_fk FOREIGN KEY (clinic_id, appointment_id, patient_id) REFERENCES appointments(clinic_id, id, patient_id);
ALTER TABLE encounters ADD CONSTRAINT encounter_clinician_scope_fk FOREIGN KEY (clinic_id, clinician_id) REFERENCES users(clinic_id, id);
CREATE UNIQUE INDEX encounter_patient_identity ON encounters (clinic_id, id, patient_id);
ALTER TABLE note_versions ADD CONSTRAINT note_encounter_patient_fk FOREIGN KEY (clinic_id, encounter_id, patient_id) REFERENCES encounters(clinic_id, id, patient_id);
ALTER TABLE prescriptions ADD CONSTRAINT prescription_encounter_patient_fk FOREIGN KEY (clinic_id, encounter_id, patient_id) REFERENCES encounters(clinic_id, id, patient_id);
ALTER TABLE charges ADD CONSTRAINT charge_encounter_patient_fk FOREIGN KEY (clinic_id, encounter_id, patient_id) REFERENCES encounters(clinic_id, id, patient_id);
CREATE UNIQUE INDEX note_encounter_identity ON note_versions (clinic_id, encounter_id, id);
ALTER TABLE note_versions ADD CONSTRAINT note_previous_version_fk FOREIGN KEY (clinic_id, encounter_id, previous_version_id) REFERENCES note_versions(clinic_id, encounter_id, id);
ALTER TABLE note_versions ADD CONSTRAINT note_signer_scope_fk FOREIGN KEY (clinic_id, signed_by) REFERENCES users(clinic_id, id);
ALTER TABLE outbox ADD CONSTRAINT outbox_clinic_fk FOREIGN KEY (clinic_id) REFERENCES clinics(id);
--> statement-breakpoint
CREATE FUNCTION protect_clinical_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.clinic_id IS DISTINCT FROM OLD.clinic_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR (to_jsonb(NEW)->'patient_id') IS DISTINCT FROM (to_jsonb(OLD)->'patient_id') THEN
    RAISE EXCEPTION 'Clinical record identity and provenance are immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['patients','availability_slots','appointments','encounters','allergies','problems','observations','note_versions','prescriptions','charges'] LOOP
    EXECUTE format('CREATE TRIGGER protect_provenance BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION protect_clinical_provenance()', table_name);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION preserve_signed_note() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('signed', 'amended') THEN
    IF OLD.status = 'signed' AND NEW.status = 'amended'
       AND (to_jsonb(NEW) - ARRAY['status','updated_at','updated_by']) = (to_jsonb(OLD) - ARRAY['status','updated_at','updated_by']) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Signed notes are immutable; create an amendment version';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preserve_signed_note BEFORE UPDATE ON note_versions FOR EACH ROW EXECUTE FUNCTION preserve_signed_note();
--> statement-breakpoint
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit records are append-only';
END $$;
CREATE TRIGGER audit_no_mutation BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM meridian_app;
GRANT USAGE ON SCHEMA public TO meridian_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO meridian_app;
REVOKE SELECT, UPDATE ON audit_log FROM meridian_app;
GRANT USAGE ON SCHEMA public TO meridian_auditor;
GRANT SELECT ON audit_log TO meridian_auditor;
-- There is intentionally no DELETE or TRUNCATE grant and no migration-schema grant.
