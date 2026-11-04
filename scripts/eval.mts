// Evaluation of the fleet assistant (npm run eval [-- --only en-01,es-04]).
// For every question in evals/questions.json: computes the expected answer with SQL as the same
// user, asks the assistant (same model, instructions and tools as the chat page), grades the answer
// and writes evals/results/latest.json, which the /evaluation page shows. No live calls from the page.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import type { ModelMessage } from "ai";

process.loadEnvFile(".env.local");
const { generateText, APICallError } = await import("ai");
const { assistantSettings, MODEL_ID } = await import("../lib/assistant/agent");

type Expected = { match: "number" | "text" | "month" | "refusal"; sql?: string; accept?: string[] };
type Question = { id: string; language: string; difficulty: string; role: "fleet_ops" | "depot_supervisor"; turns: string[]; expected: Expected };

const PAUSE_MS = 7000; // free tier allows few requests per minute

const { questions } = JSON.parse(readFileSync("evals/questions.json", "utf8")) as { questions: Question[] };
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const selected = only ? questions.filter((q) => only.includes(q.id)) : questions;

const owner = neon(process.env.DATABASE_URL!);
const app = neon(process.env.APP_DATABASE_URL!);
const profiles = await owner`select user_id, display_name, role, organization_code from public.app_users`;
const userFor = (role: string) => {
  const p = profiles.find((r) => r.role === role);
  if (!p) throw new Error(`No ${role} demo user: run npm run db:demo-users`);
  return { id: String(p.user_id), name: String(p.display_name), role: role as Question["role"], organizationCode: (p.organization_code as string | null) ?? null };
};
const [{ as_of: asOf }] = await owner`select app.as_of()::text as as_of`;

// Expected value, computed as the same user (read-only app role, RLS applies).
async function expectedValue(userId: string, sqlText: string) {
  const [, rows] = await app.transaction([app`select set_config('app.user_id', ${userId}, true)`, app.query(sqlText)], { readOnly: true });
  const v = (rows as Record<string, unknown>[])[0]?.value;
  return v === null || v === undefined ? null : String(v);
}

// All the ways a number can be written in English, Spanish or German.
function numberForms(value: string) {
  const n = Number(value);
  const decimals = value.includes(".") ? value.split(".")[1].replace(/0+$/, "").length : 0;
  const forms = new Set<string>([value, String(n)]);
  for (const locale of ["en-US", "de-DE", "es-ES"])
    for (const d of new Set([decimals, Math.min(decimals, 1)]))
      for (const grouping of [true, false])
        forms.add(new Intl.NumberFormat(locale, { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: grouping }).format(n));
  return [...forms];
}
const containsNumber = (text: string, value: string) =>
  numberForms(value).some((f) => new RegExp(`(^|[^\\d.,])${f.replace(/[.,]/g, "\\$&")}(?![\\d]|[.,]\\d)`).test(text));

function monthForms(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 15));
  const forms = [ym, `${String(m).padStart(2, "0")}/${y}`, `${m}/${y}`, `${String(m).padStart(2, "0")}.${y}`];
  for (const locale of ["en", "es", "de"]) {
    forms.push(new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(d));
    forms.push(new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(d).replace(".", ""));
  }
  return forms;
}

type ToolCall = { tool: string; input: unknown };
function grade(q: Question, expected: string | null, answer: string, calls: ToolCall[]): { pass: boolean; reason: string } {
  const charted = calls.some((c) => c.tool === "show_chart");
  if (q.expected.match === "refusal") {
    return charted
      ? { pass: false, reason: "Expected a refusal, but the assistant showed data" }
      : { pass: true, reason: "Declined without showing data" };
  }
  if (!answer.trim()) return { pass: false, reason: "Empty answer" };
  if (q.expected.match === "text") {
    const accepted = q.expected.accept ?? (expected ? [expected] : []);
    const hit = accepted.find((a) => answer.toLowerCase().includes(a.toLowerCase()));
    return hit ? { pass: true, reason: `Mentions "${hit}"` } : { pass: false, reason: `Expected "${accepted.join('" or "')}" in the answer` };
  }
  if (expected === null) return { pass: false, reason: "The SQL returned no expected value" };
  if (q.expected.match === "month") {
    const hit = monthForms(expected).find((f) => answer.toLowerCase().includes(f.toLowerCase()));
    return hit ? { pass: true, reason: `Mentions ${hit}` } : { pass: false, reason: `Expected month ${expected}` };
  }
  return containsNumber(answer, expected)
    ? { pass: true, reason: `Mentions ${expected}` }
    : { pass: false, reason: `Expected ${expected} in the answer` };
}

const settingsCache = new Map<string, Awaited<ReturnType<typeof assistantSettings>>>();
type EvalResult = Record<string, unknown> & { id: string; pass: boolean };
const results: EvalResult[] = [];
for (const [i, q] of selected.entries()) {
  const user = userFor(q.role);
  if (!settingsCache.has(q.role)) settingsCache.set(q.role, await assistantSettings(user));
  const settings = settingsCache.get(q.role)!;
  const expected = q.expected.sql ? await expectedValue(user.id, q.expected.sql) : null;

  const messages: ModelMessage[] = [];
  let answer = "";
  let calls: ToolCall[] = [];
  let error: string | null = null;
  const started = Date.now();
  for (const turn of q.turns) {
    messages.push({ role: "user", content: turn });
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await generateText({ ...settings, messages });
        messages.push(...r.response.messages);
        answer = r.text.trim();
        calls = r.steps.flatMap((s) => s.toolCalls.map((c) => ({ tool: c.toolName, input: c.input })));
        error = null;
        break;
      } catch (e) {
        const limited = APICallError.isInstance(e) && e.statusCode === 429;
        const cause = (e as { lastError?: unknown }).lastError;
        const limitedRetry = limited || (APICallError.isInstance(cause) && cause.statusCode === 429);
        error = e instanceof Error ? e.message.slice(0, 200) : String(e);
        if (!limitedRetry || attempt >= 3) break;
        process.stdout.write(" (rate limited, waiting 60 s)");
        await new Promise((res) => setTimeout(res, 60000));
      }
    }
    if (error) break;
    await new Promise((res) => setTimeout(res, PAUSE_MS));
  }

  const graded = error ? { pass: false, reason: `Error: ${error}` } : grade(q, expected, answer, calls);
  results.push({
    id: q.id, language: q.language, difficulty: q.difficulty, role: q.role, turns: q.turns,
    match: q.expected.match, expected: q.expected.match === "refusal" ? "Refusal (no data shown)" : (expected ?? q.expected.accept?.join(" / ") ?? null),
    answer, tools: calls, pass: graded.pass, reason: graded.reason, seconds: Math.round((Date.now() - started) / 100) / 10,
  });
  console.log(`${String(i + 1).padStart(2)}/${selected.length} ${graded.pass ? "PASS" : "FAIL"} ${q.id} · ${graded.reason}`);
}

// Merge with previous results when only some questions were re-run.
mkdirSync("evals/results", { recursive: true });
let all: EvalResult[] = results;
if (only) {
  try {
    const prev = JSON.parse(readFileSync("evals/results/latest.json", "utf8"));
    all = questions
      .map((q) => results.find((r) => r.id === q.id) ?? (prev.results as EvalResult[]).find((r) => r.id === q.id))
      .filter((r): r is EvalResult => Boolean(r));
  } catch { /* no previous run */ }
}
const passed = all.filter((r) => r.pass).length;
writeFileSync(
  "evals/results/latest.json",
  JSON.stringify({ run_at: new Date().toISOString(), as_of: asOf, model: MODEL_ID, total: all.length, passed, results: all }, null, 2),
);
console.log(`\nScore: ${passed}/${all.length} (${Math.round((100 * passed) / all.length)} %) · written to evals/results/latest.json`);
