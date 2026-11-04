import type { Episode } from "@/lib/data/vehicle";

// Timeline of downtime episodes with the FRC period shaded (like the Power BI detail view).
// Pure server-rendered HTML: positions are percentages of the date range.

const CATEGORY_COLOR: Record<string, string> = {
  "Mechanical Breakdown": "bg-blue-600",
  "Scheduled Maintenance": "bg-teal-500",
  "Inspection/Compliance Hold": "bg-amber-500",
  "Accident/Collision Damage": "bg-rose-600",
};

const day = (iso: string) => Math.round(Date.parse(iso + "T00:00:00Z") / 86400000);
const iso = (d: number) => new Date(d * 86400000).toISOString().slice(0, 10);
const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });

export function DowntimeTimeline(props: {
  episodes: Episode[];
  asOf: string;
  frcStart: string | null;
  frcEnd: string | null;
}) {
  const asOf = day(props.asOf);
  const start = asOf - 364;
  const lastEnd = Math.max(asOf, ...props.episodes.filter((e) => e.in_analysis_window).map((e) => day(e.end_date)));
  const end = lastEnd + 1;
  const pct = (d: number) => ((Math.min(Math.max(d, start), end) - start) / (end - start)) * 100;

  const shown = props.episodes.filter((e) => day(e.end_date) >= start && day(e.start_date) <= end);
  const frcFrom = props.frcStart ? day(props.frcStart) : null;
  const frcTo = props.frcEnd ? day(props.frcEnd) + 1 : end;
  const sixMonths = asOf - 179;

  const ticks: { left: number; label: string }[] = [];
  const first = new Date(iso(start) + "T00:00:00Z");
  for (let m = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1)); day(m.toISOString().slice(0, 10)) < end; m.setUTCMonth(m.getUTCMonth() + 1)) {
    ticks.push({ left: pct(day(m.toISOString().slice(0, 10))), label: monthLabel.format(m) });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative h-24 overflow-hidden rounded-md border bg-muted/30" role="img" aria-label={`Timeline with ${shown.length} downtime episodes in the last 12 months`}>
        {frcFrom !== null && frcTo > start && (
          <div
            className="absolute inset-y-0 bg-red-200/60 dark:bg-red-900/40"
            style={{ left: `${pct(frcFrom)}%`, width: `${Math.max(pct(frcTo) - pct(frcFrom), 0.3)}%` }}
            title={`FRC ${props.frcStart} – ${props.frcEnd ?? "open"}`}
          />
        )}
        {ticks.map((t) => (
          <div key={t.label} className="absolute inset-y-0 border-l border-dashed border-border" style={{ left: `${t.left}%` }} />
        ))}
        <div className="absolute inset-y-0 border-l-2 border-foreground/40" style={{ left: `${pct(sixMonths)}%` }} title="Start of the last 6 months" />
        <div className="absolute inset-y-0 border-l-2 border-foreground" style={{ left: `${pct(asOf)}%` }} title="Today" />
        {shown.map((e) => (
          <div
            key={e.event_id}
            className={`absolute top-6 h-12 rounded-sm ${CATEGORY_COLOR[e.category] ?? "bg-gray-500"} ${day(e.end_date) > asOf ? "opacity-60" : ""}`}
            style={{ left: `${pct(day(e.start_date))}%`, width: `max(3px, ${pct(day(e.end_date) + 1) - pct(day(e.start_date))}%)` }}
            title={`${e.category}: ${e.start_date} – ${e.end_date} (${e.downtime_days} d)`}
          />
        ))}
      </div>
      <div className="relative h-4 text-[11px] text-muted-foreground">
        {ticks.map((t, i) => (
          <span key={t.label} className={i % 2 ? "absolute hidden -translate-x-1/2 sm:inline" : "absolute -translate-x-1/2"} style={{ left: `${t.left}%` }}>{t.label}</span>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {Object.entries(CATEGORY_COLOR).map(([name, color]) => (
          <span key={name} className="flex items-center gap-1"><span className={`size-2.5 rounded-sm ${color}`} />{name}</span>
        ))}
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-red-200 dark:bg-red-900" />FRC period</span>
        <span className="flex items-center gap-1"><span className="h-3 border-l-2 border-foreground/40" />Last 6 months start</span>
        <span className="flex items-center gap-1"><span className="h-3 border-l-2 border-foreground" />Today</span>
      </div>
    </div>
  );
}
