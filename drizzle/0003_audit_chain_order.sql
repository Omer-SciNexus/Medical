-- The seq column's sequence default is evaluated before a BEFORE INSERT trigger fires, so
-- nextval ran outside the chaining lock. Two concurrent writers could therefore take seq
-- values in one order and acquire the lock in the other: the row with the lower seq chained
-- onto the row with the higher one. The chain was built in lock order but verified in seq
-- order, so verification failed under concurrency even though no row had been tampered with.
--
-- seq is now assigned inside the lock, from the highest committed value, which makes seq
-- order and chain order the same thing by construction. It is also gap-free: a rolled-back
-- transaction consumes no value, because the number comes from committed rows rather than
-- from a sequence. The column default remains but is always overwritten here.
CREATE OR REPLACE FUNCTION chain_audit_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE previous text; last_seq bigint;
BEGIN
  -- Serializes appends so two concurrent inserts cannot chain onto the same predecessor.
  PERFORM pg_advisory_xact_lock(71422003);
  SELECT entry.seq, entry.hash INTO last_seq, previous FROM audit_log entry ORDER BY entry.seq DESC LIMIT 1;
  NEW.seq := coalesce(last_seq, 0) + 1;
  NEW.prev_hash := previous;
  NEW.hash := audit_event_hash(previous, NEW);
  RETURN NEW;
END $$;
