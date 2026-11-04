import "server-only";
import { neon } from "@neondatabase/serverless";

// Neon serverless driver over HTTP, connected as the read-only app login (app_login).
// Row level security applies: queries must run with the signed-in user's id as context (Phase 3).
export function sql() {
  const url = process.env.APP_DATABASE_URL;
  if (!url) throw new Error("APP_DATABASE_URL is missing");
  return neon(url);
}
