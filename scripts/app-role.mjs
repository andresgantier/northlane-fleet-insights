// Sets the password of the read-only database login used by the app (npm run db:app-role).
// Re-runnable: reuses APP_DATABASE_PASSWORD from .env.local or generates one, applies it to the
// app_login role and writes APP_DATABASE_URL (same host as DATABASE_URL, user app_login).
// The password never goes into a migration or into git.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { Pool, neonConfig } from "@neondatabase/serverless";

const ENV_FILE = ".env.local";
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing in .env.local");

let password = process.env.APP_DATABASE_PASSWORD;
if (!password) {
  password = randomBytes(24).toString("base64url"); // ~190 bits of entropy
  appendFileSync(ENV_FILE, `\n# Read-only database login used by the app (server only)\nAPP_DATABASE_PASSWORD=${password}\n`);
  console.log("Generated APP_DATABASE_PASSWORD and saved it to .env.local");
}

neonConfig.webSocketConstructor = globalThis.WebSocket;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  // Identifiers cannot be parameters; the password is base64url (no quotes), so a literal is safe.
  if (!/^[A-Za-z0-9_-]+$/.test(password)) throw new Error("APP_DATABASE_PASSWORD must be base64url");
  await pool.query(`alter role app_login with login password '${password}'`);
} finally {
  await pool.end();
}

const url = new URL(process.env.DATABASE_URL);
url.username = "app_login";
url.password = password;
const line = `APP_DATABASE_URL=${url.toString()}`;

const env = readFileSync(ENV_FILE, "utf8");
writeFileSync(
  ENV_FILE,
  /^APP_DATABASE_URL=.*$/m.test(env) ? env.replace(/^APP_DATABASE_URL=.*$/m, line) : env.trimEnd() + `\n${line}\n`,
);
console.log("app_login password applied; APP_DATABASE_URL written to .env.local");
