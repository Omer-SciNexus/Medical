import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb, type Transaction } from "./db";
import { outbox } from "./schema";

/** Derived from the event itself, so a retried transaction enqueues it exactly once. */
export function outboxKey(identity: string) {
  const hex = createHash("sha256").update(identity).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
/**
 * Payloads carry identifiers only; a worker re-reads authorized data when it dispatches.
 *
 * One row per event identity, which by default is the topic and the resource: enqueuing the
 * same event twice is then a no-op. An event that can legitimately recur for one resource —
 * rescheduling the same appointment, say — passes `uniqueBy` including what changed, so the
 * second occurrence is its own row rather than being swallowed as a duplicate.
 */
export async function enqueueOutbox(tx: Transaction, event: { clinicId: string; topic: string; resourceId: string; uniqueBy?: string }) {
  await tx.insert(outbox).values({ clinicId: event.clinicId, topic: event.topic, resourceId: event.resourceId,
    idempotencyKey: outboxKey(event.uniqueBy ?? `${event.topic}:${event.resourceId}`) })
    .onConflictDoNothing({ target: outbox.idempotencyKey });
}

// Read side of the outbox, kept clear of the queue so an operator screen needs no broker.
export async function outboxBacklog() {
  const [row] = await getDb().select({
    pending: sql<number>`count(*) FILTER (WHERE ${outbox.dispatchedAt} IS NULL AND ${outbox.failedAt} IS NULL)::int`,
    dead: sql<number>`count(*) FILTER (WHERE ${outbox.failedAt} IS NOT NULL)::int`,
    dispatched: sql<number>`count(*) FILTER (WHERE ${outbox.dispatchedAt} IS NOT NULL)::int`,
  }).from(outbox);
  return { pending: row?.pending ?? 0, dead: row?.dead ?? 0, dispatched: row?.dispatched ?? 0 };
}
export async function listOutboxRows(clinicId: string, scope: "pending" | "dead" | "dispatched") {
  const condition = scope === "dead" ? sql`${outbox.failedAt} IS NOT NULL`
    : scope === "dispatched" ? sql`${outbox.dispatchedAt} IS NOT NULL`
    : sql`${outbox.dispatchedAt} IS NULL AND ${outbox.failedAt} IS NULL`;
  return getDb().select({ id: outbox.id, topic: outbox.topic, resourceId: outbox.resourceId, attempts: outbox.attempts, createdAt: outbox.createdAt,
    dispatchedAt: outbox.dispatchedAt, nextAttemptAt: outbox.nextAttemptAt, failedAt: outbox.failedAt, lastError: outbox.lastError })
    .from(outbox).where(and(eq(outbox.clinicId, clinicId), condition)).orderBy(asc(outbox.createdAt)).limit(200);
}
/** Puts a dead letter back in the queue for another try, from this clinic only. */
export async function retryOutboxRow(clinicId: string, outboxId: string) {
  const [row] = await getDb().update(outbox).set({ failedAt: null, attempts: 0, nextAttemptAt: null, lastError: null })
    .where(and(eq(outbox.id, outboxId), eq(outbox.clinicId, clinicId), isNull(outbox.dispatchedAt)))
    .returning({ id: outbox.id, topic: outbox.topic });
  return row;
}
