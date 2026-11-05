"use client";

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MonthRow } from "@/lib/data/vehicle";

// Downtime days per month for one vehicle (last 12 months), stacked by category,
// with the Fleet Review Case period shaded red and the last 6 months (critical-case window) shaded grey.

const CATEGORIES = [
  { key: "Mechanical Breakdown", color: "#2563eb" },
  { key: "Scheduled Maintenance", color: "#14b8a6" },
  { key: "Inspection/Compliance Hold", color: "#f59e0b" },
  { key: "Accident/Collision Damage", color: "#e11d48" },
];
const monthLabel = (ym: string) =>
  new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${ym}-15T00:00:00Z`));

export function VehicleMonthlyChart(props: {
  months: MonthRow[];
  frcStart: string | null;
  frcEnd: string | null;
  asOf: string;
}) {
  const byMonth = new Map<string, Record<string, number | string>>();
  for (const r of props.months) {
    const row = byMonth.get(r.month) ?? { month: r.month, label: monthLabel(r.month), total: 0 };
    row[r.category] = r.downtime_days;
    row.total = Number(row.total) + r.downtime_days;
    byMonth.set(r.month, row);
  }
  const data = [...byMonth.values()].sort((a, b) => String(a.month).localeCompare(String(b.month)));
  const first = String(data[0]?.month ?? "");
  const last = String(data.at(-1)?.month ?? "");
  const ym = (iso: string) => iso.slice(0, 7);
  const clamp = (m: string) => (m < first ? first : m > last ? last : m);
  const sixMonthStart = ym(new Date(Date.parse(props.asOf + "T00:00:00Z") - 179 * 86400000).toISOString());
  const frcFrom = props.frcStart && ym(props.frcStart) <= last ? monthLabel(clamp(ym(props.frcStart))) : null;
  const frcTo = props.frcStart ? monthLabel(clamp(props.frcEnd ? ym(props.frcEnd) : last)) : null;
  const total = data.reduce((n, r) => n + Number(r.total), 0);

  if (total === 0)
    return <p className="py-10 text-center text-sm text-muted-foreground">No downtime in the last 12 months.</p>;

  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 28, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          {frcFrom && frcTo && (
            <ReferenceArea x1={frcFrom} x2={frcTo} fill="#fecaca" fillOpacity={0.5} label={{ value: "FRC period", position: "insideTopRight", fontSize: 11, fill: "#b91c1c" }} />
          )}
          <ReferenceArea x1={monthLabel(clamp(sixMonthStart))} x2={monthLabel(last)} fill="#94a3b8" fillOpacity={0.12}
            label={{ value: "Last 6 months", position: "insideTopLeft", fontSize: 11, fill: "#475569" }} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} domain={[0, (max: number) => Math.max(4, Math.ceil(max * 1.2))]} label={{ value: "Days down", angle: -90, position: "insideLeft", offset: 20, fontSize: 11 }} />
          <Tooltip formatter={(v, name) => [`${v} days`, name]} labelFormatter={(l) => String(l)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {CATEGORIES.map((c) => (
            <Bar key={c.key} dataKey={c.key} stackId="d" fill={c.color} maxBarSize={48} isAnimationActive={false} />
          ))}
          {/* Invisible line at the stack total, only to print the month total above each bar. */}
          <Line dataKey="total" stroke="none" dot={false} activeDot={false} isAnimationActive={false} legendType="none" tooltipType="none"
            label={({ x, y, value }) => (Number(value) > 0 ? <text x={Number(x)} y={Number(y) - 8} textAnchor="middle" fontSize={11} fill="currentColor">{String(value)}</text> : <g />)} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
