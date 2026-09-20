import "server-only";
import { z } from "zod";
import { getRedis } from "@/platform/redis";
import { digest, newToken } from "./crypto";
import { findUserById, appendAudit } from "./repository";
import { actorSchema, type Actor } from "./validators";

const sessionSchema = z.object({ actor: actorSchema, expiresAt: z.number() });
export const SESSION_COOKIE = "meridian_session";
const IDLE_SECONDS = 30 * 60;
const ABSOLUTE_SECONDS = 8 * 60 * 60;
const keyFor = (token: string) => `session:${digest(token)}`;

export async function createSession(actor: Actor) {
  actorSchema.parse(actor);
  const token = newToken();
  const key = keyFor(token);
  const expiresAt = Date.now() + ABSOLUTE_SECONDS * 1000;
  await appendAudit({ clinicId: actor.clinicId, actorId: actor.id, action: "identity.signed_in", purpose: "authentication", outcome: "allowed" });
  const result = await getRedis().multi().set(key, JSON.stringify({ actor, expiresAt }), "EX", IDLE_SECONDS)
    .sadd(`user_sessions:${actor.id}`, key).expire(`user_sessions:${actor.id}`, ABSOLUTE_SECONDS).exec();
  if (!result || result.some(([error]) => error)) throw new Error("Session storage is unavailable.");
  return { token, expiresAt };
}
export async function resolveSession(token: string | undefined): Promise<Actor | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const redis = getRedis();
  const key = keyFor(token);
  const raw = await redis.get(key);
  if (!raw) return null;
  const parsed = sessionSchema.safeParse(JSON.parse(raw));
  if (!parsed.success || parsed.data.expiresAt <= Date.now()) { await redis.del(key); return null; }
  const { actor, expiresAt } = parsed.data;
  const user = await findUserById(actor.id);
  if (!user?.active || user.role !== actor.role || user.clinicId !== actor.clinicId || user.patientId !== actor.patientId || (user.role !== "patient" && (!actor.mfaVerified || !user.mfaSecret))) { await redis.del(key); return null; }
  const renewed = await redis.expire(key, Math.min(IDLE_SECONDS, Math.max(1, Math.floor((expiresAt - Date.now()) / 1000))));
  return renewed ? actor : null;
}
export async function revokeSession(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return;
  const key = keyFor(token);
  const raw = await getRedis().getdel(key);
  if (raw) {
    const { actor } = sessionSchema.parse(JSON.parse(raw));
    await getRedis().srem(`user_sessions:${actor.id}`, key);
    await appendAudit({ clinicId: actor.clinicId, actorId: actor.id, action: "identity.signed_out", purpose: "authentication", outcome: "allowed" });
  }
}
export async function revokeAllSessions(userId: string) {
  const id = z.uuid().parse(userId);
  // Atomic with session index deletion. Concurrent new authentication may start a new session.
  await getRedis().eval("local keys = redis.call('SMEMBERS', KEYS[1]); for _,key in ipairs(keys) do redis.call('DEL', key) end; return redis.call('DEL', KEYS[1])", 1, `user_sessions:${id}`);
}
