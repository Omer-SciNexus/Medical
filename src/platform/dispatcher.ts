import "server-only";
import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { getDb } from "./db";
import { outbox } from "./schema";
import { getJobQueue } from "./queue";
import { logOperational } from "./log";

export const MAX_ATTEMPTS = 6;
const BACKOFF_SECONDS = [10, 60, 300, 1_800, 7_200, 21_600];
const backoffFor = (attempts: number) => BACKOFF_SECONDS[Math.min(attempts, BACKOFF_SECONDS.length - 1)];

/**
 * Drains one batch of outbox rows.
 *
 * Rows are claimed with FOR UPDATE SKIP LOCKED, so several dispatchers can run at once and
 * simply take different rows. Each row is enqueued with its own idempotency key as the job id
 * and marked dispatched in the same transaction: if the process dies after the enqueue and
 * before the commit, the row stays pending and the retry lands on the same job rather than a
 * second one. A row that keeps failing backs off, and after MAX_ATTEMPTS becomes a dead letter
 * an operator has to decide about.
 */
export async function dispatchOutboxBatch(limit = 20) {
  const queue = getJobQueue();
  const claimed: { id: string; topic: string; resourceId: string; clinicId: string; idempotencyKey: string; attempts: number }[] = [];
  let dispatched = 0;
  const failures: { id: string; attempts: number }[] = [];

  await getDb().transaction(async (tx) => {
    const rows = await tx.select({ id: outbox.id, topic: outbox.topic, resourceId: outbox.resourceId, clinicId: outbox.clinicId,
      idempotencyKey: outbox.idempotencyKey, attempts: outbox.attempts })
      .from(outbox)
      .where(and(isNull(outbox.dispatchedAt), isNull(outbox.failedAt), or(isNull(outbox.nextAttemptAt), lte(outbox.nextAttemptAt, new Date()))))
      .orderBy(asc(outbox.createdAt)).limit(limit).for("update", { skipLocked: true });
    claimed.push(...rows);
    const sent: string[] = [];
    for (const row of rows) {
      try {
        await queue.add(row.topic, row.idempotencyKey, { outboxId: row.id, clinicId: row.clinicId, resourceId: row.resourceId, topic: row.topic });
        sent.push(row.id);
      } catch {
        failures.push({ id: row.id, attempts: row.attempts });
      }
    }
    if (sent.length) await tx.update(outbox).set({ dispatchedAt: new Date(), nextAttemptAt: null, lastError: null }).where(inArray(outbox.id, sent));
    dispatched = sent.length;
  });

  // Failures are recorded outside the claiming transaction so a rollback cannot erase the
  // attempt count that drives backoff and dead-lettering.
  for (const failure of failures) {
    const attempts = failure.attempts + 1;
    const dead = attempts >= MAX_ATTEMPTS;
    await getDb().update(outbox)
      .set({ attempts, lastError: "QUEUE_ENQUEUE_FAILED", nextAttemptAt: dead ? null : new Date(Date.now() + backoffFor(attempts) * 1_000), failedAt: dead ? new Date() : null })
      .where(eq(outbox.id, failure.id));
    logOperational("job.failed", { code: dead ? "OUTBOX_DEAD_LETTER" : "OUTBOX_RETRY" });
  }
  return { claimed: claimed.length, dispatched, failed: failures.length };
}
