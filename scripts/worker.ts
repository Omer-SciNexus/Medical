import { Worker } from "bullmq";
import { getJobQueue } from "../src/platform/queue";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { QUEUE_NAME, getQueueConnection } from "../src/platform/queue";
import { dispatchOutboxBatch } from "../src/platform/dispatcher";
import { outboxBacklog } from "../src/platform/outbox";
import { handlerFor, handledTopics } from "../src/jobs/registry";
import { scheduleUpcomingReminders } from "../src/jobs/reminders";
import { logOperational } from "../src/platform/log";
import { closeRuntimeConnections, validateRuntime } from "../src/platform/runtime";

const DISPATCH_INTERVAL_MS = Number(process.env.OUTBOX_INTERVAL_MS ?? 5_000);
const AUDIT_PASS_INTERVAL_MS = Number(process.env.AUDIT_FULL_PASS_MS ?? 24 * 3_600_000);

/**
 * The process the outbox has always been written for. Two halves:
 *
 *  - a dispatcher loop that drains outbox rows into the queue, which is where ordering,
 *    backoff and dead-lettering are decided;
 *  - a BullMQ worker that runs the handler for each job, re-reading authorized data by id
 *    because the payload carries nothing but identifiers.
 *
 * Both are safe to run several times over: rows are claimed with SKIP LOCKED and jobs are
 * keyed by the row's idempotency key.
 */
export async function startWorker() {
  const worker = new Worker(QUEUE_NAME, async (job) => {
    const handler = handlerFor(job.name);
    // An unknown topic is not a failure: a row may name a topic this deployment has retired.
    if (!handler) return { skipped: job.name };
    return handler(job.data as Record<string, string>);
  }, { connection: getQueueConnection(), concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4) });

  worker.on("failed", () => logOperational("job.failed", { code: "JOB_ATTEMPT_FAILED" }));

  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      try {
        await dispatchOutboxBatch();
      } catch {
        logOperational("job.failed", { code: "DISPATCH_LOOP_FAILED" });
      }
      await new Promise((done) => setTimeout(done, DISPATCH_INTERVAL_MS));
    }
  };
  const dispatching = loop();
  // The chain's full verification is a schedule, not a reaction to anything: one job id, so
  // restarting the worker replaces the standing schedule rather than stacking another.
  await getJobQueue().add("audit.verify_chain", "audit-verify-chain-daily", {}, { repeatEveryMs: AUDIT_PASS_INTERVAL_MS });
  const stop = async () => {
    stopped = true;
    await dispatching;
    await worker.close();
    await getJobQueue().close();
  };
  return { worker, stop };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  validateRuntime("worker");
  if (process.argv.includes("--check")) { console.log("worker imports and configuration verified."); process.exit(0); }
  const started = await startWorker();
  // Visits booked while nothing was running still need their reminders.
  const caught = await scheduleUpcomingReminders().catch(() => ({ appointments: 0, scheduled: 0 }));
  const backlog = await outboxBacklog();
  console.log(`Worker running. Topics: ${handledTopics().join(", ")}. Outbox pending ${backlog.pending}, dead ${backlog.dead}. Reminders scheduled for ${caught.appointments} upcoming visits.`);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => { void started.stop().then(closeRuntimeConnections).then(() => process.exit(0)); });
  }
}
