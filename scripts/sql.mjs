// Runs a .sql file and prints every result set (npm run db:sql -- file.sql [--app]).
// Default connection: DATABASE_URL (owner). --app: APP_DATABASE_URL (read-only app login).
// For verification queries only; schema changes go through migrations.
import { readFileSync, existsSync } from "node:fs";
import { Pool, neonConfig, types } from "@neondatabase/serverless";

const file = process.argv[2];
if (!file) throw new Error("Usage: npm run db:sql -- path/to/file.sql");
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
neonConfig.webSocketConstructor = globalThis.WebSocket;
types.setTypeParser(1082, (v) => v); // show dates as YYYY-MM-DD, not JS Date objects

const asApp = process.argv.includes("--app");
const connectionString = asApp ? process.env.APP_DATABASE_URL : process.env.DATABASE_URL;
if (!connectionString) throw new Error(asApp ? "APP_DATABASE_URL is missing" : "DATABASE_URL is missing");
const pool = new Pool({ connectionString });
try {
  const results = await pool.query(readFileSync(file, "utf8"));
  for (const r of [results].flat()) {
    if (r.command !== "SELECT") continue;
    console.table(r.rows);
  }
} finally {
  await pool.end();
}
