import "server-only";
import { getRedis } from "./redis";

/**
 * Live updates carry no content.
 *
 * A message on a channel says only that something in this clinic changed; the browser then
 * re-reads an authorized snapshot through the ordinary screen, which is already scoped and
 * audited. So nothing about a patient travels over a socket, a reconnect needs no cursor to
 * replay from, and a stale connection cannot show stale data — it can only miss a nudge.
 */
export const REALTIME_CHANNEL = "meridian:changes";
export const CHANNELS = {
  "clinic:board": ["staff", "admin"],
  "clinic:queue": ["clinician"],
} as const;
export type Channel = keyof typeof CHANNELS;
export type Nudge = { channel: Channel; clinicId: string; at: number };

// Object.hasOwn, not `in`: `in` walks the prototype chain, so a subscriber asking for
// "toString" or "__proto__" would otherwise pass this and reach a function as if it were a list.
export const isChannel = (value: unknown): value is Channel => typeof value === "string" && Object.hasOwn(CHANNELS, value);
/** The clinic comes from the authenticated actor, never from the subscriber's request. */
export function authorizeChannel(actor: { role: string }, channel: string) {
  return isChannel(channel) && (CHANNELS[channel] as readonly string[]).includes(actor.role);
}
/** Published after a change has committed, so a nudge never announces a rolled-back write. */
export async function publishChange(clinicId: string, channel: Channel) {
  const nudge: Nudge = { channel, clinicId, at: Date.now() };
  await getRedis().publish(REALTIME_CHANNEL, JSON.stringify(nudge)).catch(() => undefined);
}
export function parseNudge(payload: string): Nudge | undefined {
  try {
    const parsed = JSON.parse(payload) as Partial<Nudge>;
    if (!isChannel(parsed.channel) || typeof parsed.clinicId !== "string") return undefined;
    return { channel: parsed.channel, clinicId: parsed.clinicId, at: typeof parsed.at === "number" ? parsed.at : Date.now() };
  } catch { return undefined; }
}
/** Reads one cookie out of a raw header, which is all the upgrade request gives us. */
export function readCookie(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}
