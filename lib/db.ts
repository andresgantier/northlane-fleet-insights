import "server-only";
import { neon } from "@neondatabase/serverless";

// Neon serverless driver over HTTP: one round trip per query, ideal for Vercel functions.
// Phase 2 replaces this owner connection with a read-only role plus per-user RLS context.
export function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is missing");
  return neon(url);
}
