import "server-only";
import Redis from "ioredis";

const globalRedis = globalThis as unknown as { meridianRedis?: Redis };
export function getRedis() {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL must be configured.");
  return globalRedis.meridianRedis ??= new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 2, connectTimeout: 5_000, lazyConnect: true });
}
