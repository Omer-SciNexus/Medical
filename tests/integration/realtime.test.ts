import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { Client } from "pg";
import type { Pool } from "pg";
import type Redis from "ioredis";
import { readFile } from "node:fs/promises";
import WebSocket from "ws";
import { migrateDatabase } from "../../scripts/migrate";
import { seedDatabase, seedIds } from "../../scripts/seed";
import { encryptSecret } from "../../src/modules/identity/crypto";
import { createSession, revokeAllSessions } from "../../src/modules/identity/sessions";
import { publishChange } from "../../src/platform/realtime";
import { startRealtime } from "../../scripts/realtime";
import type { Actor } from "../../src/modules/identity/validators";

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
let owner: Client;
let server: Awaited<ReturnType<typeof startRealtime>>;
const origin = "http://127.0.0.1:4000";
const actorFor = (role: Actor["role"]): Actor => ({ id: seedIds[role === "clinician" ? "clinician" : role === "staff" ? "staff" : "admin"], clinicId: seedIds.clinic, role, patientId: null, mfaVerified: true, authenticatedAt: Date.now(), mfaVerifiedAt: Date.now() });

/** Opens a socket the way a browser would: a cookie and an Origin, and nothing else. */
function connect(options: { token?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (options.origin !== null) headers.origin = options.origin ?? origin;
  if (options.token) headers.cookie = `meridian_session=${options.token}`;
  return new WebSocket(`ws://127.0.0.1:${server.port}`, { headers });
}
const waitFor = (socket: WebSocket, type: string, timeoutMs = 4_000) => new Promise<Record<string, unknown>>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`no ${type} message arrived`)), timeoutMs);
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw)) as Record<string, unknown>;
    if (message.type !== type) return;
    clearTimeout(timer); resolve(message);
  });
  socket.on("close", () => { clearTimeout(timer); reject(new Error("socket closed")); });
  socket.on("error", (error) => { clearTimeout(timer); reject(error); });
});
const rejection = (socket: WebSocket) => new Promise<string>((resolve) => {
  socket.on("unexpected-response", (_request, response) => resolve(String(response.statusCode)));
  socket.on("error", () => resolve("error"));
});
const closure = (socket: WebSocket) => new Promise<number>((resolve) => socket.on("close", (code) => resolve(code)));

beforeAll(async () => {
  postgres = await new PostgreSqlContainer("postgres:17-alpine").withDatabase("meridian").withUsername("meridian_owner").withPassword("test-owner-password").start();
  redis = await new RedisContainer("redis:7-alpine").start();
  owner = new Client({ connectionString: postgres.getConnectionUri() }); await owner.connect();
  await owner.query(await readFile("scripts/init-db.sql", "utf8"));
  await migrateDatabase(postgres.getConnectionUri());
  await seedDatabase(postgres.getConnectionUri(), "integration-test-password-only");
  process.env.AUTH_PEPPER = "integration-test-only-pepper-32-characters";
  process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.CLINIC_TIMEZONE = "Europe/Istanbul";
  process.env.APP_ORIGIN = origin;
  const app = new URL(postgres.getConnectionUri()); app.username = "meridian_app"; app.password = "local-app-only";
  process.env.DATABASE_URL = app.toString();
  process.env.REDIS_URL = redis.getConnectionUrl();
  await owner.query("UPDATE users SET mfa_secret = $1 WHERE role <> 'patient' AND active = true", [encryptSecret("JBSWY3DPEHPK3PXP")]);
  process.env.REALTIME_REVALIDATE_MS = "500";
  server = await startRealtime(0);
}, 180_000);

afterAll(async () => {
  await server?.stop();
  const globals = globalThis as unknown as { meridianPool?: Pool; meridianAuditPool?: Pool; meridianRedis?: Redis };
  await globals.meridianPool?.end(); globals.meridianPool = undefined;
  await globals.meridianAuditPool?.end(); globals.meridianAuditPool = undefined;
  globals.meridianRedis?.disconnect(); globals.meridianRedis = undefined;
  await owner?.end(); await redis?.stop(); await postgres?.stop();
});

describe("authenticating the upgrade", () => {
  it("refuses a connection with no session, no origin, or an origin that is not ours", async () => {
    expect(await rejection(connect())).toBe("401");
    expect(await rejection(connect({ token: "f".repeat(64) }))).toBe("401");
    const { token } = await createSession(actorFor("staff"));
    expect(await rejection(connect({ token, origin: null }))).toBe("403");
    expect(await rejection(connect({ token, origin: "https://somewhere.else" }))).toBe("403");
  });
  it("accepts a live session and says so", async () => {
    const { token } = await createSession(actorFor("staff"));
    const socket = connect({ token });
    await expect(waitFor(socket, "ready")).resolves.toMatchObject({ type: "ready" });
    socket.close();
  });
});

describe("subscribing", () => {
  it("lets the front desk watch the board and refuses the clinician's queue", async () => {
    const { token } = await createSession(actorFor("staff"));
    const socket = connect({ token });
    await waitFor(socket, "ready");
    socket.send(JSON.stringify({ type: "subscribe", channel: "clinic:board" }));
    await expect(waitFor(socket, "subscribed")).resolves.toMatchObject({ channel: "clinic:board" });
    socket.send(JSON.stringify({ type: "subscribe", channel: "clinic:queue" }));
    await expect(waitFor(socket, "denied")).resolves.toMatchObject({ channel: "clinic:queue" });
    socket.close();
  });
  it("lets a clinician watch their queue and refuses the board", async () => {
    const { token } = await createSession(actorFor("clinician"));
    const socket = connect({ token });
    await waitFor(socket, "ready");
    socket.send(JSON.stringify({ type: "subscribe", channel: "clinic:queue" }));
    await expect(waitFor(socket, "subscribed")).resolves.toMatchObject({ channel: "clinic:queue" });
    socket.send(JSON.stringify({ type: "subscribe", channel: "clinic:board" }));
    await expect(waitFor(socket, "denied")).resolves.toMatchObject({ channel: "clinic:board" });
    socket.close();
  });
  it("ignores an unknown channel and a malformed frame without dropping the socket", async () => {
    const { token } = await createSession(actorFor("staff"));
    const socket = connect({ token });
    await waitFor(socket, "ready");
    socket.send("not json at all");
    socket.send(JSON.stringify({ type: "subscribe", channel: "clinic:everything" }));
    socket.send(JSON.stringify({ type: "subscribe", channel: "clinic:board" }));
    await expect(waitFor(socket, "subscribed")).resolves.toMatchObject({ channel: "clinic:board" });
    socket.close();
  });
});

describe("what travels over the socket", () => {
  it("carries a nudge with no content, so the screen re-reads rather than replaying", async () => {
    const { token } = await createSession(actorFor("staff"));
    const socket = connect({ token });
    await waitFor(socket, "ready");
    socket.send(JSON.stringify({ type: "subscribe", channel: "clinic:board" }));
    await waitFor(socket, "subscribed");
    const incoming = waitFor(socket, "changed");
    await publishChange(seedIds.clinic, "clinic:board");
    const message = await incoming;
    expect(Object.keys(message).sort()).toEqual(["at", "channel", "type"]);
    expect(message.channel).toBe("clinic:board");
    socket.close();
  });
  it("never sends another clinic's changes, or a channel this socket did not subscribe to", async () => {
    const other = await owner.query("INSERT INTO clinics (name) VALUES ('Realtime Other') RETURNING id");
    const { token } = await createSession(actorFor("staff"));
    const socket = connect({ token });
    await waitFor(socket, "ready");
    socket.send(JSON.stringify({ type: "subscribe", channel: "clinic:board" }));
    await waitFor(socket, "subscribed");
    const nothing = waitFor(socket, "changed", 1_200).then(() => "arrived").catch(() => "silent");
    await publishChange(other.rows[0].id, "clinic:board");
    await publishChange(seedIds.clinic, "clinic:queue");
    expect(await nothing).toBe("silent");
    socket.close();
  });
});

describe("a session that ends", () => {
  it("closes the socket on the next revalidation rather than waiting for it to go idle", async () => {
    const { token } = await createSession(actorFor("staff"));
    const socket = connect({ token });
    await waitFor(socket, "ready");
    socket.send(JSON.stringify({ type: "subscribe", channel: "clinic:board" }));
    await waitFor(socket, "subscribed");
    const closed = closure(socket);
    await revokeAllSessions(seedIds.staff);
    expect(await closed).toBe(4401);
    expect(server.subscriberCount()).toBe(0);
  });
});
