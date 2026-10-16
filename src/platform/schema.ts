import { pgTable, uuid, text, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";

// Outbox payloads consist of IDs only. Workers load authorized data when needed.
export const outbox = pgTable("outbox", {
  id: uuid("id").defaultRandom().primaryKey(), clinicId: uuid("clinic_id").notNull(),
  topic: text("topic").notNull(), resourceId: uuid("resource_id").notNull(),
  idempotencyKey: uuid("idempotency_key").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  /** When this row may next be attempted, which is how backoff is expressed. */
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  /** Set once a row has exhausted its attempts: the dead letter an operator has to decide on. */
  failedAt: timestamp("failed_at", { withTimezone: true }),
  lastError: text("last_error"),
}, (t) => [uniqueIndex("outbox_idempotency").on(t.idempotencyKey), index("outbox_pending").on(t.dispatchedAt, t.createdAt),
  index("outbox_claimable").on(t.dispatchedAt, t.failedAt, t.nextAttemptAt)]);
