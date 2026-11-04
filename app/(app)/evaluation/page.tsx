import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/app/kpi-card";
import latest from "@/evals/results/latest.json";
import notes from "@/evals/review-notes.json";

// Results of the last evaluation run (npm run eval). Static: opening this page calls no model.

type Result = (typeof latest.results)[number];
const reviewNotes = notes as Record<string, string>;

function group(results: Result[], key: "language" | "difficulty") {
  const map = new Map<string, { total: number; passed: number }>();
  for (const r of results) {
    const g = map.get(r[key]) ?? { total: 0, passed: 0 };
    g.total++;
    if (r.pass) g.passed++;
    map.set(r[key], g);
  }
  return [...map.entries()];
}

const LANG: Record<string, string> = { en: "English", es: "Spanish", de: "German" };
const pct = (p: number, t: number) => `${Math.round((100 * p) / t)} %`;

export default function EvaluationPage() {
  const results = latest.results as Result[];
  const failures = results.filter((r) => !r.pass);
  const runAt = new Date(latest.run_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Assistant evaluation</h1>
        <p className="text-sm text-muted-foreground">
          {latest.total} test questions in three languages, with expected answers computed by SQL on the same day. Last run {runAt} (data as of {latest.as_of}), model <code>{latest.model}</code>.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Correct answers" value={pct(latest.passed, latest.total)} hint={`${latest.passed} of ${latest.total}`} />
        {group(results, "difficulty").map(([d, g]) => (
          <KpiCard key={d} label={d === "trap" ? "Trap questions (no answer possible)" : `${d[0].toUpperCase()}${d.slice(1)} questions`} value={pct(g.passed, g.total)} hint={`${g.passed} of ${g.total}`} />
        ))}
        {group(results, "language").map(([l, g]) => (
          <KpiCard key={l} label={LANG[l] ?? l} value={pct(g.passed, g.total)} hint={`${g.passed} of ${g.total}`} />
        ))}
      </section>

      <Card>
        <CardHeader><CardTitle className="text-base">How it is graded</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          A script asks every question with the same model, instructions and tools as the chat. A number answer passes when the
          SQL result appears in the reply (in any language format); a text answer when it names the right depot, type or month;
          a trap question when the assistant declines without showing data. Follow-up questions are asked as a conversation.
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">History</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          First run: 27 of 32 (84 %). The five failures were reviewed one by one (four assistant issues, one grading
          error); each fix is noted on its question below. The full set was then run again: the remaining failure is explained on its question.
        </CardContent>
      </Card>

      {failures.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Failures ({failures.length})</h2>
          {failures.map((r) => <ResultCard key={r.id} r={r} />)}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">All questions</h2>
        {results.map((r) => <ResultCard key={r.id} r={r} compact={!reviewNotes[r.id]} />)}
      </section>
    </>
  );
}

function ResultCard({ r, compact }: { r: Result; compact?: boolean }) {
  const note = reviewNotes[r.id];
  return (
    <details className="rounded-lg border bg-card p-3 text-sm" open={!compact}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-2">
        <Badge variant={r.pass ? "secondary" : "destructive"}>{r.pass ? "Pass" : "Fail"}</Badge>
        <span className="font-mono text-xs text-muted-foreground">{r.id}</span>
        <span>{r.turns.join(" → ")}</span>
        <span className="ml-auto text-xs text-muted-foreground">{r.difficulty} · {r.role === "depot_supervisor" ? "supervisor" : "fleet ops"} · {r.seconds} s</span>
      </summary>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Expected</dt><dd>{r.expected}</dd>
        <dt className="text-muted-foreground">Answer</dt><dd className="whitespace-pre-wrap">{r.answer || "—"}</dd>
        <dt className="text-muted-foreground">Result</dt><dd>{r.reason}</dd>
        <dt className="text-muted-foreground">Tools</dt>
        <dd className="font-mono text-xs">{r.tools.length ? r.tools.map((t) => `${t.tool}(${JSON.stringify(t.input)})`).join("\n") : "none"}</dd>
        {note && (<><dt className="text-muted-foreground">Review</dt><dd>{note}</dd></>)}
      </dl>
    </details>
  );
}
