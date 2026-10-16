-- Verifying the chain meant rehashing every row, which is linear in the size of the log and
-- was being paid on every page view. A checkpoint records a position the chain was known good
-- at, so the ordinary check only has to walk what has arrived since.
--
-- A checkpoint is only as good as the pass that wrote it: an alteration before one is invisible
-- to an incremental check. The scheduled full pass is what covers that, and both results are
-- kept here so a reader can see when the whole chain was last walked.
CREATE TABLE audit_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  seq bigint NOT NULL,
  hash text NOT NULL,
  checked bigint NOT NULL,
  full_pass boolean NOT NULL DEFAULT false,
  verified_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX audit_checkpoint_position ON audit_checkpoints (seq DESC);
CREATE INDEX audit_checkpoint_full ON audit_checkpoints (full_pass, verified_at DESC);
--> statement-breakpoint
-- Walks the chain from a known-good position rather than from the beginning. The caller passes
-- the checkpoint it trusts; passing 0 and NULL is a full pass and is what the schedule runs.
CREATE FUNCTION verify_audit_chain_from(from_seq bigint, from_hash text)
RETURNS TABLE (checked bigint, broken_seq bigint, last_seq bigint, last_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE previous text := from_hash; entry audit_log; total bigint := 0;
BEGIN
  broken_seq := NULL; last_seq := from_seq; last_hash := from_hash;
  FOR entry IN SELECT * FROM audit_log WHERE seq > from_seq ORDER BY seq LOOP
    total := total + 1;
    IF entry.prev_hash IS DISTINCT FROM previous OR entry.hash IS DISTINCT FROM audit_event_hash(previous, entry) THEN
      checked := total; broken_seq := entry.seq; RETURN NEXT; RETURN;
    END IF;
    previous := entry.hash; last_seq := entry.seq; last_hash := entry.hash;
  END LOOP;
  checked := total; RETURN NEXT;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION verify_audit_chain_from(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_audit_chain_from(bigint, text) TO meridian_auditor;
-- The auditor credential owns verification, so it is the only role that may read or add a
-- checkpoint. The runtime role is left with nothing here, as it has nothing on the log itself.
REVOKE ALL ON audit_checkpoints FROM meridian_app;
GRANT SELECT, INSERT ON audit_checkpoints TO meridian_auditor;
