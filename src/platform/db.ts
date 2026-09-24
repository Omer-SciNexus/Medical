import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const globalDb = globalThis as unknown as { meridianPool?: Pool; meridianAuditPool?: Pool };
export function getDb() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be configured.");
  const pool = globalDb.meridianPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  return drizzle(pool);
}
// The runtime role has no SELECT on audit_log, so reading it needs the separate
// auditor credential. Only the authorized audit viewer may use this connection.
export function getAuditDb() {
  if (!process.env.AUDIT_DATABASE_URL) throw new Error("AUDIT_DATABASE_URL must be configured.");
  const pool = globalDb.meridianAuditPool ??= new Pool({ connectionString: process.env.AUDIT_DATABASE_URL, max: 4, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  return drizzle(pool);
}
export type Database = ReturnType<typeof getDb>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
