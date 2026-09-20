import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function migrateDatabase(connectionString: string) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    // Session lock serializes deploy processes; Drizzle records committed migrations.
    await client.query("SELECT pg_advisory_lock(71422001)");
    await migrate(drizzle(client), { migrationsFolder: resolve("drizzle") });
  } finally {
    await client.query("SELECT pg_advisory_unlock(71422001)").catch(() => undefined);
    await client.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("Set MIGRATION_DATABASE_URL to the migration-owner connection.");
  migrateDatabase(url).then(() => console.log("Forward migrations applied.")).catch(() => { console.error("Migration failed. Check the owner connection and committed migrations."); process.exitCode = 1; });
}
