import { connection } from "next/server";
import { sql } from "@/lib/db";

// GET /api/health – checks that the app can reach the Neon database.
export async function GET() {
  await connection(); // always run at request time, never prerendered
  const checkedAt = new Date().toISOString();

  if (!process.env.DATABASE_URL) {
    return Response.json(
      { ok: false, error: "DATABASE_URL is missing", checked_at: checkedAt },
      { status: 503 },
    );
  }

  const started = performance.now();
  try {
    const rows = await sql()`select public.health_check() as database`;
    const latencyMs = Math.round(performance.now() - started);
    return Response.json(
      { ok: true, database: rows[0].database, latency_ms: latencyMs, checked_at: checkedAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[health] database check failed:", message);
    return Response.json(
      { ok: false, error: "Database check failed", checked_at: checkedAt },
      { status: 503 },
    );
  }
}
