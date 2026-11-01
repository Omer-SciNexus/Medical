import "server-only";
import { getRedis } from "./redis";

/** Counts one attempt against `key` and reports whether the window's limit is now exceeded. */
export async function exceedsLimit(key: string, limit: number, windowSeconds = 900) {
  const count = await getRedis().eval("local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return n", 1, key, windowSeconds);
  return Number(count) > limit;
}
