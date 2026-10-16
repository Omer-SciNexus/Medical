import "server-only";
import { Queue } from "bullmq";
import Redis from "ioredis";

/**
 * The seam between the dispatcher and BullMQ. Job identity is the caller's business — the
 * dispatcher passes the outbox row's idempotency key — so enqueuing the same event twice after
 * a crash mid-dispatch lands on the same job rather than a second one.
 *
 * Kept narrow on purpose: the dispatcher's own rules (claiming, backoff, dead-lettering) are
 * what carry the risk, and they can then be exercised without a broker.
 */
export type JobOptions = { delayMs?: number; attempts?: number };
export type JobQueue = {
  add(name: string, jobId: string, data: Record<string, string>, options?: JobOptions): Promise<void>;
  remove(jobId: string): Promise<void>;
  close(): Promise<void>;
};
export const QUEUE_NAME = "meridian";

const globalQueue = globalThis as unknown as { meridianQueue?: JobQueue; meridianQueueConnection?: Redis };

/** BullMQ needs its own connection: a worker blocks on it, and it must never give up a command. */
export function getQueueConnection() {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL must be configured.");
  return globalQueue.meridianQueueConnection ??= new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
}
export function getJobQueue(): JobQueue {
  if (globalQueue.meridianQueue) return globalQueue.meridianQueue;
  const queue = new Queue(QUEUE_NAME, { connection: getQueueConnection() });
  return globalQueue.meridianQueue = {
    async add(name, jobId, data, options) {
      await queue.add(name, data, {
        jobId, delay: options?.delayMs, attempts: options?.attempts ?? 5,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { age: 86_400, count: 1_000 }, removeOnFail: { age: 7 * 86_400 },
      });
    },
    async remove(jobId) { await queue.remove(jobId).catch(() => undefined); },
    async close() { await queue.close(); },
  };
}
/** Replaces the queue for a test or a local run, mirroring how the pools and cache are held. */
export function setJobQueue(queue: JobQueue | undefined) { globalQueue.meridianQueue = queue; }
