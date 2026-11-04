import "server-only";
import { neon, type NeonQueryFunction, type NeonQueryPromise } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;
type Query = NeonQueryPromise<false, false>;
export type Row = Record<string, unknown>;

// Neon serverless driver over HTTP, connected as the read-only app login (app_login).
export function sql(): Sql {
  const url = process.env.APP_DATABASE_URL;
  if (!url) throw new Error("APP_DATABASE_URL is missing");
  return neon(url);
}

// Runs queries as a signed-in user: one read-only transaction that first sets app.user_id,
// so row level security filters every query to what this user may see.
// userId must come from a verified Neon Auth session, never from the browser.
export async function queryAsUser(userId: string, build: (sql: Sql) => Query[]): Promise<Row[][]> {
  const db = sql();
  const results = await db.transaction(
    [db`select set_config('app.user_id', ${userId}, true)`, ...build(db)],
    { readOnly: true },
  );
  return results.slice(1) as Row[][];
}
