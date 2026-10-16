ALTER TABLE "outbox" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "last_error" text;--> statement-breakpoint
CREATE INDEX "outbox_claimable" ON "outbox" USING btree ("dispatched_at","failed_at","next_attempt_at");