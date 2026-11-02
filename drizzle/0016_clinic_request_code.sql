-- A clinic's short request code: eight characters from an alphabet without look-alikes (0/O, 1/I/L),
-- drawn from gen_random_uuid() so one code says nothing about the next. Bytes 6 and 8 carry the
-- UUID version and variant, so they are skipped.
CREATE FUNCTION new_request_code() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + get_byte(r.b, i) % 31, 1), '' ORDER BY i)
  FROM (SELECT uuid_send(gen_random_uuid()) AS b) AS r, unnest(ARRAY[0, 1, 2, 3, 4, 5, 10, 11]) AS i
$$;
--> statement-breakpoint
-- A volatile default is evaluated per row, so every existing clinic receives its own code here.
ALTER TABLE "clinics" ADD COLUMN "request_code" text DEFAULT new_request_code() NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_request_code_unique" UNIQUE("request_code");
