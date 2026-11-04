// Creates (or checks) the two demo accounts and their app profiles (npm run db:demo-users).
// Re-runnable: signs up through Neon Auth when the account does not exist yet, otherwise signs in
// to confirm the password, then upserts the role and depot in app_users (owner connection).
// DEMO_PASSWORD comes from .env.local (generated on the first run, server only).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { Pool, neonConfig } from "@neondatabase/serverless";
import demo from "../lib/demo-accounts.json" with { type: "json" };

const ENV_FILE = ".env.local";
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
for (const name of ["DATABASE_URL", "NEON_AUTH_BASE_URL"])
  if (!process.env[name]) throw new Error(`${name} is missing in .env.local`);

let password = process.env.DEMO_PASSWORD;
if (!password) {
  password = "Demo-" + randomBytes(12).toString("base64url");
  const env = readFileSync(ENV_FILE, "utf8");
  const line = `DEMO_PASSWORD=${password}`;
  writeFileSync(ENV_FILE, /^DEMO_PASSWORD=.*$/m.test(env) ? env.replace(/^DEMO_PASSWORD=.*$/m, line) : env.trimEnd() + `\n${line}\n`);
  console.log("Generated DEMO_PASSWORD and saved it to .env.local");
}

const base = process.env.NEON_AUTH_BASE_URL.replace(/\/$/, "");
async function call(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function ensureAccount(account) {
  const signUp = await call("/sign-up/email", { email: account.email, password, name: account.name });
  if (signUp.ok && signUp.json?.user?.id) return { id: signUp.json.user.id, created: true };

  const signIn = await call("/sign-in/email", { email: account.email, password });
  if (signIn.ok && signIn.json?.user?.id) return { id: signIn.json.user.id, created: false };

  throw new Error(
    `Could not create or sign in ${account.email} (sign-up ${signUp.status}: ${JSON.stringify(signUp.json)}; ` +
      `sign-in ${signIn.status}: ${JSON.stringify(signIn.json)}). If the account exists with another password, ` +
      `delete it in the Neon console (Auth > Users) and run this again.`,
  );
}

neonConfig.webSocketConstructor = globalThis.WebSocket;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  for (const account of Object.values(demo)) {
    const { id, created } = await ensureAccount(account);
    await pool.query(
      `insert into public.app_users (user_id, display_name, role, organization_code)
       values ($1, $2, $3, $4)
       on conflict (user_id) do update
         set display_name = excluded.display_name, role = excluded.role, organization_code = excluded.organization_code`,
      [id, account.name, account.role, account.organization_code],
    );
    console.log(`${created ? "Created" : "Checked"} ${account.email} -> ${account.role}${account.organization_code ? ` (${account.organization_code})` : ""}`);
  }
} finally {
  await pool.end();
}
