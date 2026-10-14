ALTER TABLE "audit_log" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "prev_hash" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_seq_unique" ON "audit_log" USING btree ("seq");--> statement-breakpoint
-- Append-only grants make the log tamper-resistant. Chaining each row into the previous
-- one makes it tamper-evident: altering any earlier row invalidates every later hash.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
-- One definition, shared by the insert trigger and the verifier, so they cannot drift.
CREATE FUNCTION audit_event_hash(previous text, entry audit_log) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(digest(concat_ws('|', coalesce(previous, ''), entry.seq::text, entry.id::text,
    coalesce(entry.clinic_id::text, ''), coalesce(entry.actor_id::text, ''), coalesce(entry.patient_id::text, ''),
    entry.action, entry.purpose, entry.outcome, coalesce(entry.resource_id::text, ''), coalesce(entry.reason, ''),
    to_char(entry.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')), 'sha256'), 'hex')
$$;
--> statement-breakpoint
-- SECURITY DEFINER: the runtime role has no SELECT on audit_log and so cannot read the
-- previous hash itself. Any prev_hash or hash supplied by the caller is discarded.
CREATE FUNCTION chain_audit_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE previous text;
BEGIN
  -- Serializes appends so two concurrent inserts cannot chain onto the same predecessor.
  PERFORM pg_advisory_xact_lock(71422003);
  SELECT entry.hash INTO previous FROM audit_log entry ORDER BY entry.seq DESC LIMIT 1;
  NEW.prev_hash := previous;
  NEW.hash := audit_event_hash(previous, NEW);
  RETURN NEW;
END $$;
CREATE TRIGGER audit_chain BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION chain_audit_event();
--> statement-breakpoint
CREATE FUNCTION verify_audit_chain() RETURNS TABLE (checked bigint, broken_seq bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE previous text := NULL; entry audit_log; total bigint := 0;
BEGIN
  broken_seq := NULL;
  FOR entry IN SELECT * FROM audit_log ORDER BY seq LOOP
    total := total + 1;
    IF entry.prev_hash IS DISTINCT FROM previous OR entry.hash IS DISTINCT FROM audit_event_hash(previous, entry) THEN
      checked := total; broken_seq := entry.seq; RETURN NEXT; RETURN;
    END IF;
    previous := entry.hash;
  END LOOP;
  checked := total; RETURN NEXT;
END $$;
--> statement-breakpoint
-- Rows written before this migration are chained once, with the append-only guard lifted
-- for the duration. A fresh database reaches this with nothing to backfill.
ALTER TABLE audit_log DISABLE TRIGGER audit_no_mutation;
DO $$
DECLARE previous text := NULL; entry audit_log; computed text;
BEGIN
  FOR entry IN SELECT * FROM audit_log ORDER BY seq LOOP
    computed := audit_event_hash(previous, entry);
    UPDATE audit_log SET prev_hash = previous, hash = computed WHERE seq = entry.seq;
    previous := computed;
  END LOOP;
END $$;
ALTER TABLE audit_log ENABLE TRIGGER audit_no_mutation;
--> statement-breakpoint
-- bigserial needs its sequence; without this grant every audit append fails.
GRANT USAGE ON SEQUENCE audit_log_seq_seq TO meridian_app;
REVOKE ALL ON FUNCTION verify_audit_chain() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_audit_chain() TO meridian_auditor;
