import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import Redis from "ioredis";
import { Queue, QueueEvents, Worker } from "bullmq";
import { sendJobMail } from "../../src/platform/mailer";

let redis: StartedRedisContainer | undefined;
let connection: Redis;
let queue: Queue;
let events: QueueEvents;
let worker: Worker;
beforeAll(async () => {
  redis = await new RedisContainer("redis:7-alpine").start();
  connection = new Redis(redis.getConnectionUrl(), { maxRetriesPerRequest: null });
  const name = `mail-regression-${randomUUID()}`;
  queue = new Queue(name, { connection });
  events = new QueueEvents(name, { connection });
  await events.waitUntilReady();
}, 120_000);
afterAll(async () => {
  await worker?.close();
  await events?.close();
  // This randomly named queue belongs only to this suite.
  await queue?.obliterate();
  await queue?.close();
  connection?.disconnect();
  await redis?.stop();
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
});
describe("mail worker retries", () => {
  it("retries provider failure with the same idempotency key before completing", async () => {
    vi.stubEnv("MAIL_API_KEY", "synthetic-provider-key");
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    worker = new Worker(queue.name, async (job) => {
      await sendJobMail({ to: "synthetic@example.test", subject: "Synthetic queue test", text: "Synthetic test only", idempotencyKey: `mail-${job.id}` });
      return { accepted: true };
    }, { connection });
    const job = await queue.add("mail", { resourceId: randomUUID() }, { jobId: "stable-delivery", attempts: 2, backoff: { type: "fixed", delay: 25 } });
    await expect(job.waitUntilFinished(events, 10_000)).resolves.toEqual({ accepted: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map((call) => call[1].headers["Idempotency-Key"])).toEqual(["mail-stable-delivery", "mail-stable-delivery"]);
    expect((await queue.getJob(job.id!))?.attemptsMade).toBe(2);
  });
});
