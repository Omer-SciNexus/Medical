import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import Redis from "ioredis";
import { resolveSession, SESSION_COOKIE, allowedAuthOrigins } from "../src/modules/identity";
import { REALTIME_CHANNEL, authorizeChannel, isChannel, parseNudge, readCookie, type Channel } from "../src/platform/realtime";
import { logOperational } from "../src/platform/log";

const PORT = Number(process.env.REALTIME_PORT ?? 4010);
const REVALIDATE_MS = Number(process.env.REALTIME_REVALIDATE_MS ?? 60_000);

type Subscriber = { socket: WebSocket; clinicId: string; actorId: string; token: string; channels: Set<Channel> };

/**
 * The live-update server.
 *
 * The upgrade is authenticated from the session cookie and checked against the allowed origins,
 * which is the same pair of rules every Server Action applies. A subscription is authorized by
 * role, and the clinic is taken from the resolved session rather than from the client. Sessions
 * are re-resolved on a timer, so a revoked session, a deactivated account or a changed role
 * closes the socket rather than waiting for it to go idle.
 */
export async function startRealtime(port = PORT) {
  const server = createServer((_request, response) => { response.writeHead(426); response.end("Upgrade required"); });
  const sockets = new WebSocketServer({ noServer: true });
  const subscribers = new Set<Subscriber>();

  server.on("upgrade", async (request, socket, head) => {
    const origin = request.headers.origin;
    // Same two gates as a Server Action: a known origin, and a session that still resolves.
    if (!origin || !allowedAuthOrigins().includes(origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); socket.destroy(); return;
    }
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    const actor = token ? await resolveSession(token).catch(() => null) : null;
    if (!actor || !token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return;
    }
    sockets.handleUpgrade(request, socket, head, (connection) => {
      const subscriber: Subscriber = { socket: connection, clinicId: actor.clinicId, actorId: actor.id, token, channels: new Set() };
      subscribers.add(subscriber);
      connection.on("message", (raw) => {
        try {
          const message = JSON.parse(String(raw)) as { type?: string; channel?: string };
          if (message.type !== "subscribe" || !isChannel(message.channel)) return;
          if (!authorizeChannel(actor, message.channel)) { connection.send(JSON.stringify({ type: "denied", channel: message.channel })); return; }
          subscriber.channels.add(message.channel);
          connection.send(JSON.stringify({ type: "subscribed", channel: message.channel }));
        } catch { /* a malformed frame is ignored rather than closing the socket */ }
      });
      connection.on("close", () => subscribers.delete(subscriber));
      connection.send(JSON.stringify({ type: "ready" }));
    });
  });

  // A separate connection, because a subscribed Redis client can run no other command.
  const listener = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", { maxRetriesPerRequest: null });
  await listener.subscribe(REALTIME_CHANNEL);
  listener.on("message", (_channel, payload) => {
    const nudge = parseNudge(payload);
    if (!nudge) return;
    for (const subscriber of subscribers) {
      if (subscriber.clinicId !== nudge.clinicId || !subscriber.channels.has(nudge.channel)) continue;
      subscriber.socket.send(JSON.stringify({ type: "changed", channel: nudge.channel, at: nudge.at }));
    }
  });

  const revalidate = setInterval(() => {
    for (const subscriber of subscribers) {
      void resolveSession(subscriber.token).then((actor) => {
        if (actor && actor.id === subscriber.actorId && actor.clinicId === subscriber.clinicId) return;
        subscriber.socket.close(4401, "session ended");
        subscribers.delete(subscriber);
      }).catch(() => undefined);
    }
  }, REVALIDATE_MS);

  await new Promise<void>((ready) => server.listen(port, "127.0.0.1", ready));
  return {
    port: (server.address() as { port: number }).port,
    subscriberCount: () => subscribers.size,
    async stop() {
      clearInterval(revalidate);
      for (const subscriber of subscribers) subscriber.socket.close(1001, "server stopping");
      listener.disconnect();
      sockets.close();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const started = await startRealtime();
  console.log(`Live updates listening on ws://127.0.0.1:${started.port}. Sessions revalidated every ${REVALIDATE_MS / 1000}s.`);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => { void started.stop().then(() => process.exit(0)); });
  }
  process.on("uncaughtException", () => logOperational("job.failed", { code: "REALTIME_FAILED" }));
}
