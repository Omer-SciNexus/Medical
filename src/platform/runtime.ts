import { z } from "zod";

export function validateRuntime(kind: "worker" | "realtime") {
  const required = kind === "worker"
    ? ["DATABASE_URL", "AUDIT_DATABASE_URL", "REDIS_URL", "AUTH_PEPPER"]
    : ["DATABASE_URL", "REDIS_URL", "AUTH_PEPPER", "APP_ORIGIN"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing configuration: ${missing.join(", ")}`);
  if ((process.env.AUTH_PEPPER?.length ?? 0) < 32) throw new Error("AUTH_PEPPER must contain at least 32 characters.");
  for (const name of ["DATABASE_URL", "REDIS_URL", ...(kind === "worker" ? ["AUDIT_DATABASE_URL"] : ["APP_ORIGIN"])]) {
    if (!z.url().safeParse(process.env[name]).success) throw new Error(`${name} must be a URL.`);
  }
  for (const name of ["OUTBOX_INTERVAL_MS", "AUDIT_FULL_PASS_MS", "WORKER_CONCURRENCY", "REALTIME_REVALIDATE_MS"]) {
    if (process.env[name] && !z.coerce.number().int().positive().safeParse(process.env[name]).success) throw new Error(`${name} must be a positive integer.`);
  }
}

export async function closeRuntimeConnections() {
  const globals = globalThis as unknown as {
    meridianPool?: { end(): Promise<void> }; meridianAuditPool?: { end(): Promise<void> };
    meridianRedis?: { disconnect(): void }; meridianQueueConnection?: { disconnect(): void };
  };
  globals.meridianRedis?.disconnect();
  globals.meridianQueueConnection?.disconnect();
  await Promise.all([globals.meridianPool?.end(), globals.meridianAuditPool?.end()]);
}
