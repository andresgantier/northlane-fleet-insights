"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChartSpec, Column, DataResult } from "@/lib/assistant/types";

const COLORS = ["#0b4ea2", "#f28c28"]; // blue / amber, readable in light and dark mode
// Donut slices: distinct hues, then repeated lighter blues for small groups.
const SLICES = ["#0b4ea2", "#f28c28", "#14b8a6", "#e11d48", "#8b5cf6", "#0ea5e9", "#84cc16", "#f97316", "#64748b", "#ec4899"];
const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function cell(value: unknown, kind: Column["kind"]) {
  if (value === null || value === undefined || value === "") return "—";
  if (kind === "boolean") return value ? "Yes" : "No";
  if (kind === "number") return nf.format(Number(value));
  if (kind === "percent") return `${nf.format(Number(value))} %`;
  return String(value);
}

// Chart (validated spec from the assistant) + data table + "How was this calculated?" + Excel download.
export function AnswerVisual({ data, spec }: { data: DataResult; spec: ChartSpec | null }) {
  const [downloading, setDownloading] = useState(false);
  const type = spec?.chart_type ?? "table";
  const x = spec?.x ?? data.columns[0].key;
  const y = spec?.y ?? [];
  const label = (k: string) => data.columns.find((c) => c.key === k)?.label ?? k;
  const rows = data.rows.map((r) => ({ ...r, [x]: String(r[x] ?? "") }));

  async function download() {
    setDownloading(true);
    try {
      // Loaded only on click, entirely in the browser: the file contains exactly the rows shown.
      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Data");
      ws.columns = data.columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 2) }));
      ws.getRow(1).font = { bold: true };
      data.rows.forEach((r) => ws.addRow(r));
      const about = wb.addWorksheet("How it was calculated");
      [
        ["Title", spec?.title ?? data.title],
        ["Period", data.calculation.period],
        ["Filters", data.calculation.filters.join("; ") || "None"],
        ["Metrics", data.calculation.metric.join("; ")],
        ["Source", data.calculation.source],
      ].forEach((row) => about.addRow(row));
      about.getColumn(1).width = 14;
      about.getColumn(2).width = 100;
      const buffer = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `northlane-${(spec?.title ?? data.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
      <h3 className="text-sm font-medium">{spec?.title ?? data.title}</h3>

      {type === "bar" && y.length > 0 && (
        <div style={{ height: Math.max(180, rows.length * 28 + 60) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey={x} width={150} tick={{ fontSize: 11 }} interval={0} />
              <Tooltip formatter={(v) => nf.format(Number(v))} />
              {y.length > 1 && <Legend />}
              {y.map((k, i) => <Bar key={k} dataKey={k} name={label(k)} fill={COLORS[i]} radius={[0, 3, 3, 0]} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {type === "line" && y.length > 0 && (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ left: 0, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={x} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => nf.format(Number(v))} />
              {y.length > 1 && <Legend />}
              {y.map((k, i) => <Line key={k} dataKey={k} name={label(k)} stroke={COLORS[i]} strokeWidth={2} dot={{ r: 3 }} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {type === "donut" && y.length === 1 && (
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={rows.filter((r) => Number(r[y[0]] ?? 0) > 0)} dataKey={y[0]} nameKey={x} innerRadius="55%" outerRadius="85%" paddingAngle={1}>
                {rows.filter((r) => Number(r[y[0]] ?? 0) > 0).map((r, i) => <Cell key={String(r[x])} fill={SLICES[i % SLICES.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => nf.format(Number(v))} />
              <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      <details open={type === "table"} className="group">
        <summary className="cursor-pointer text-sm text-muted-foreground">Data table ({data.rows.length}{data.truncated ? ` of ${data.total_rows}` : ""} rows)</summary>
        <div className="mt-2 max-h-80 overflow-auto rounded border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>{data.columns.map((c) => <th key={c.key} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i} className="border-t">
                  {data.columns.map((c) => (
                    <td key={c.key} className={`px-2 py-1 whitespace-nowrap ${c.kind === "number" || c.kind === "percent" ? "text-right tabular-nums" : ""}`}>{cell(r[c.key], c.kind)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details>
        <summary className="cursor-pointer text-sm text-muted-foreground">How was this calculated?</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Metric</dt>
          <dd><ul className="list-disc pl-4">{data.calculation.metric.map((m) => <li key={m}>{m}</li>)}</ul></dd>
          <dt className="text-muted-foreground">Period</dt><dd>{data.calculation.period}</dd>
          <dt className="text-muted-foreground">Filters</dt><dd>{data.calculation.filters.length ? data.calculation.filters.join(" · ") : "None"}</dd>
          <dt className="text-muted-foreground">Tool</dt><dd><code>{data.calculation.tool}</code> → <code>{data.calculation.source}</code></dd>
          {data.calculation.notes?.map((n) => <dd key={n} className="col-start-2 text-muted-foreground">{n}</dd>)}
        </dl>
      </details>

      <div>
        <Button size="sm" variant="outline" onClick={download} disabled={downloading}>
          <Download className="size-4" aria-hidden /> {downloading ? "Preparing…" : "Download (.xlsx)"}
        </Button>
      </div>
    </div>
  );
}
