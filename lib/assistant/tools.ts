import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { queryAsUser, type Row } from "@/lib/db";
import { periodSchema, resolvePeriod } from "./period";
import { MAX_ROWS, type ChartSpec, type Column, type DataResult } from "./types";

// Typed tools over the semantic layer. Every query runs as the signed-in user (RLS applies),
// parameters are validated by zod, and the model never writes SQL.

export const CATEGORIES = [
  "Mechanical Breakdown",
  "Scheduled Maintenance",
  "Inspection/Compliance Hold",
  "Accident/Collision Damage",
] as const;
export const VEHICLE_CLASSES = ["Trailer", "Truck", "Van"] as const;
const FRC_STATES = ["any", "active", "none", "closed_with_action_plan", "closed_no_action_plan", "declined", "aborted"] as const;
const FRC_STATUS: Record<string, string> = {
  closed_with_action_plan: "Review Case Closed – With Action Plan",
  closed_no_action_plan: "Review Case Closed – No Action Plan",
  declined: "Review Case Declined",
  aborted: "Review Case Aborted",
};

export type ToolContext = {
  userId: string;
  asOf: string;
  organizations: string[]; // depots visible to the user
  vehicleTypes: string[];
  isSupervisor: boolean;
  depot: string | null;
};

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const topN = z.number().int().min(1).max(MAX_ROWS).optional().describe(`Maximum rows to return (1–${MAX_ROWS}).`);

export function buildTools(ctx: ToolContext) {
  const results = new Map<string, DataResult>();
  let counter = 0;
  const save = (r: Omit<DataResult, "result_id">): DataResult => {
    const result = { ...r, result_id: `r${++counter}` };
    results.set(result.result_id, result);
    return result;
  };

  const orgEnum = z.enum(ctx.organizations as [string, ...string[]]);
  const typeEnum = z.enum(ctx.vehicleTypes as [string, ...string[]]);
  const depotNote = ctx.isSupervisor ? [`Depot = ${ctx.depot} (your access is limited to this depot)`] : [];
  const run = (build: Parameters<typeof queryAsUser>[1]) => queryAsUser(ctx.userId, build);

  const filtersSchema = z
    .object({
      organization: orgEnum.optional().describe("Depot code"),
      vehicle_class: z.enum(VEHICLE_CLASSES).optional().describe("Trailer, Truck or Van"),
      vehicle_type: typeEnum.optional().describe("One of the 35 exact vehicle type names"),
      category: z.enum(CATEGORIES).optional().describe("Downtime category"),
      vehicle_id: z.number().int().positive().optional(),
    })
    .default({});

  const describeFilters = (f: z.infer<typeof filtersSchema>) => [
    ...depotNote,
    ...(f.organization ? [`Depot = ${f.organization}`] : []),
    ...(f.vehicle_class ? [`Vehicle class = ${f.vehicle_class}`] : []),
    ...(f.vehicle_type ? [`Vehicle type = ${f.vehicle_type}`] : []),
    ...(f.category ? [`Downtime category = ${f.category}`] : []),
    ...(f.vehicle_id ? [`Vehicle ID = ${f.vehicle_id}`] : []),
  ];

  return {
    query_downtime_metrics: tool({
      description:
        "Downtime metrics for any period, optionally grouped. Use for totals, breakdowns (by depot, vehicle type, " +
        "vehicle class, downtime category), monthly trends (group_by month) and vehicle rankings for a period " +
        "(group_by vehicle). Metrics per row: episodes, downtime_days, mttr_days, availability_pct, vehicles_with_downtime.",
      inputSchema: z.object({
        group_by: z.enum(["none", "month", "organization", "vehicle_type", "vehicle_class", "category", "vehicle"]),
        period: periodSchema,
        filters: filtersSchema,
        sort_by: z.enum(["downtime_days", "episodes", "mttr_days", "availability_pct", "vehicles_with_downtime"]).optional()
          .describe("Ignored for group_by month (always chronological). Default downtime_days."),
        sort_order: z.enum(["desc", "asc"]).optional().describe("Default desc"),
        min_downtime_days: z.number().int().min(0).optional().describe("Keep only groups with downtime_days >= this value"),
        min_episodes: z.number().int().min(0).optional().describe("Keep only groups with episodes >= this value"),
        top_n: topN,
      }),
      execute: async (input) => {
        const period = resolvePeriod(input.period, ctx.asOf);
        const f = input.filters;
        const [rows] = await run((sql) => [
          sql`select * from public.downtime_metrics(${period.from}::date, ${period.to}::date, ${input.group_by},
                ${f.organization ?? null}, ${f.vehicle_class ?? null}, ${f.vehicle_type ?? null},
                ${f.category ?? null}, ${f.vehicle_id ?? null})`,
        ]);
        let data = rows.map((r: Row) => ({
          group: String(r.group_key),
          fleet_vehicles: num(r.fleet_vehicles),
          vehicles_with_downtime: num(r.vehicles_with_downtime),
          episodes: num(r.episodes),
          downtime_days: num(r.downtime_days),
          mttr_days: num(r.mttr_days),
          availability_pct: num(r.availability_pct),
        }));
        if (input.min_downtime_days !== undefined) data = data.filter((r) => (r.downtime_days ?? 0) >= input.min_downtime_days!);
        if (input.min_episodes !== undefined) data = data.filter((r) => (r.episodes ?? 0) >= input.min_episodes!);
        if (input.group_by !== "month") {
          const key = input.sort_by ?? "downtime_days";
          const dir = input.sort_order === "asc" ? 1 : -1;
          data.sort((a, b) => dir * (((a[key] ?? -1) as number) - ((b[key] ?? -1) as number)));
        }
        const total = data.length;
        const limit = Math.min(input.top_n ?? (input.group_by === "vehicle" ? 20 : MAX_ROWS), MAX_ROWS);
        data = data.slice(0, limit);

        const groupLabel: Record<string, string> = {
          none: "Total", month: "Month", organization: "Depot", vehicle_type: "Vehicle type",
          vehicle_class: "Vehicle class", category: "Downtime category", vehicle: "Vehicle",
        };
        const columns: Column[] = [
          { key: "group", label: groupLabel[input.group_by], kind: "text" },
          { key: "episodes", label: "Episodes", kind: "number" },
          { key: "downtime_days", label: "Downtime days", kind: "number" },
          { key: "mttr_days", label: "MTTR (days)", kind: "number" },
          ...(input.group_by === "category" ? [] : [{ key: "availability_pct", label: "Availability %", kind: "percent" } as Column]),
          { key: "vehicles_with_downtime", label: "Vehicles with downtime", kind: "number" },
          ...(input.group_by === "vehicle" ? [] : [{ key: "fleet_vehicles", label: "Fleet vehicles", kind: "number" } as Column]),
        ];
        return save({
          title: `Downtime by ${groupLabel[input.group_by].toLowerCase()}`,
          columns,
          rows: data,
          total_rows: total,
          truncated: total > data.length,
          calculation: {
            tool: "query_downtime_metrics",
            metric: [
              "Downtime days = calendar days down, counting only days inside the period",
              "Episodes = downtime episodes overlapping the period",
              "MTTR = downtime days ÷ episodes",
              ...(input.group_by === "category" ? [] : ["Availability = 1 − downtime days ÷ (vehicles × days in period)"]),
            ],
            period: `${period.label}: ${period.from} to ${period.to}`,
            filters: [
              ...describeFilters(f),
              ...(input.min_downtime_days !== undefined ? [`Downtime days ≥ ${input.min_downtime_days}`] : []),
              ...(input.min_episodes !== undefined ? [`Episodes ≥ ${input.min_episodes}`] : []),
            ],
            source: `downtime_metrics(group_by => '${input.group_by}')`,
            notes: total > data.length ? [`Showing ${data.length} of ${total} rows`] : undefined,
          },
        });
      },
    }),

    list_vehicles: tool({
      description:
        "Vehicle list for the last 12 months with Fleet Review Case (FRC) status and critical-case flags. Use for " +
        "critical cases (vehicles where an FRC should be opened), vehicles with an active FRC, which condition a vehicle " +
        "meets, and rankings over the last 12 months. Also returns how many vehicles match in total.",
      inputSchema: z.object({
        filters: z
          .object({
            organization: orgEnum.optional(),
            vehicle_class: z.enum(VEHICLE_CLASSES).optional(),
            vehicle_type: typeEnum.optional(),
            frc_state: z.enum(FRC_STATES).optional().describe("any (default), active, none (never had one), or a closed state"),
            critical_only: z.boolean().optional().describe("Only critical cases (condition 1 or 2)"),
            condition: z.enum(["condition_1", "condition_2", "condition_3"]).optional().describe("Only vehicles meeting this condition"),
          })
          .default({}),
        sort_by: z.enum(["episodes_12m", "downtime_days_12m", "cond1_episodes", "cond2_days", "latest_start"]).optional()
          .describe("Default episodes_12m"),
        top_n: topN,
      }),
      execute: async (input) => {
        const f = input.filters;
        const frc = !f.frc_state || f.frc_state === "any" ? null : (FRC_STATUS[f.frc_state] ?? f.frc_state);
        const [rows] = await run((sql) => [
          sql`select vehicle_id, plate_nr, vehicle_type, vehicle_class, organization_code, episodes_12m,
                     downtime_days_12m, latest_start::text, frc_status, frc_active, cond1_episodes, cond2_days,
                     cond3_days, condition_1, condition_2, condition_3, is_critical
              from public.vehicle_status_filtered(${f.organization ?? null}, ${f.vehicle_type ?? null}, ${frc}, null)
              where (${f.vehicle_class ?? null}::text is null or vehicle_class = ${f.vehicle_class ?? null})
                and (${f.critical_only ?? false} = false or is_critical)
                and (${f.condition ?? null}::text is null
                     or (${f.condition ?? null} = 'condition_1' and condition_1)
                     or (${f.condition ?? null} = 'condition_2' and condition_2)
                     or (${f.condition ?? null} = 'condition_3' and condition_3))
                and episodes_12m > 0`,
        ]);
        const key = input.sort_by ?? "episodes_12m";
        const sorted = [...rows].sort((a, b) =>
          key === "latest_start"
            ? String(b.latest_start ?? "").localeCompare(String(a.latest_start ?? ""))
            : Number(b[key] ?? 0) - Number(a[key] ?? 0) || Number(b.downtime_days_12m) - Number(a.downtime_days_12m),
        );
        const limit = Math.min(input.top_n ?? 20, MAX_ROWS);
        const data = sorted.slice(0, limit).map((r) => ({
          vehicle: `${r.vehicle_id} · ${r.plate_nr}`,
          vehicle_type: String(r.vehicle_type),
          depot: String(r.organization_code),
          episodes_12m: num(r.episodes_12m),
          downtime_days_12m: num(r.downtime_days_12m),
          frc_status: r.frc_status ? String(r.frc_status).replace("Review Case ", "") : "None",
          critical: Boolean(r.is_critical),
          cond1_episodes: num(r.cond1_episodes),
          cond2_days: num(r.cond2_days),
          condition_3: Boolean(r.condition_3),
          latest_start: (r.latest_start as string | null) ?? null,
        }));
        return save({
          title: f.critical_only ? "Critical cases" : "Vehicles",
          columns: [
            { key: "vehicle", label: "Vehicle", kind: "text" },
            { key: "vehicle_type", label: "Type", kind: "text" },
            { key: "depot", label: "Depot", kind: "text" },
            { key: "episodes_12m", label: "Episodes (12 mo)", kind: "number" },
            { key: "downtime_days_12m", label: "Downtime days (12 mo)", kind: "number" },
            { key: "frc_status", label: "FRC", kind: "text" },
            { key: "critical", label: "Critical", kind: "boolean" },
            { key: "cond1_episodes", label: "Cond. 1 episodes", kind: "number" },
            { key: "cond2_days", label: "Cond. 2 days", kind: "number" },
            { key: "latest_start", label: "Latest start", kind: "date" },
          ],
          rows: data,
          total_rows: rows.length,
          truncated: rows.length > data.length,
          calculation: {
            tool: "list_vehicles",
            metric: [
              "Episodes and downtime days: last 12 months (days inside the window)",
              "Critical case = no active FRC and (≥ 3 counted episodes or ≥ 20 days in counted episodes); counted = started in the last 180 days and after the last FRC ended",
              "Condition 3 (informational) = no active FRC and > 20 downtime days in the last 12 months",
            ],
            period: `Last 12 months: ${addDaysIso(ctx.asOf, -364)} to ${ctx.asOf}`,
            filters: [
              ...depotNote,
              ...(f.organization ? [`Depot = ${f.organization}`] : []),
              ...(f.vehicle_class ? [`Vehicle class = ${f.vehicle_class}`] : []),
              ...(f.vehicle_type ? [`Vehicle type = ${f.vehicle_type}`] : []),
              ...(frc ? [`FRC = ${f.frc_state}`] : []),
              ...(f.critical_only ? ["Critical cases only"] : []),
              ...(f.condition ? [`Meets ${f.condition.replace("_", " ")}`] : []),
              "Vehicles with at least one episode in the last 12 months",
            ],
            source: "v_vehicle_status (vehicle_conditions)",
            notes: rows.length > data.length ? [`${rows.length} vehicles match; showing ${data.length}`] : undefined,
          },
        });
      },
    }),

    get_fleet_kpis: tool({
      description:
        "Headline KPIs for the last 12 months: number of critical cases, active FRCs, fleet vehicles, vehicles with " +
        "downtime, episodes, downtime days, MTTR, availability, condition-3-only vehicles. Use group_by organization " +
        "or vehicle_type to compare these KPIs (e.g. which depot has the most critical cases).",
      inputSchema: z.object({
        group_by: z.enum(["none", "organization", "vehicle_type"]).optional().describe("Default none"),
        organization: orgEnum.optional(),
        vehicle_type: typeEnum.optional(),
      }),
      execute: async (input) => {
        const groupBy = input.group_by ?? "none";
        // One fleet_summary() per group, all in one transaction (same definitions as the dashboard).
        const keys =
          groupBy === "organization" ? (input.organization ? [input.organization] : ctx.organizations)
          : groupBy === "vehicle_type" ? (input.vehicle_type ? [input.vehicle_type] : ctx.vehicleTypes)
          : ["All"];
        const results = await run((sql) =>
          keys.map((k) =>
            sql`select * from public.fleet_summary(
                  ${groupBy === "organization" ? k : (input.organization ?? null)},
                  ${groupBy === "vehicle_type" ? k : (input.vehicle_type ?? null)}, null, null)`,
          ),
        );
        const data = results
          .map(([r], i) => ({
            group: keys[i],
            critical_cases: num(r?.critical_cases),
            active_frcs: num(r?.active_frcs),
            fleet_vehicles: num(r?.fleet_vehicles),
            vehicles_with_downtime: num(r?.vehicles_with_downtime),
            episodes: num(r?.episodes),
            downtime_days: num(r?.downtime_days),
            mttr_days: num(r?.mttr_days),
            availability_pct: num(r?.availability_pct),
            condition_3_only: num(r?.condition_3_only),
          }))
          .filter((r) => (r.fleet_vehicles ?? 0) > 0)
          .sort((a, b) => (b.critical_cases ?? 0) - (a.critical_cases ?? 0) || a.group.localeCompare(b.group));
        const groupLabel = { none: "Total", organization: "Depot", vehicle_type: "Vehicle type" }[groupBy];
        return save({
          title: groupBy === "none" ? "Fleet KPIs" : `Fleet KPIs by ${groupLabel.toLowerCase()}`,
          columns: [
            { key: "group", label: groupLabel, kind: "text" },
            { key: "critical_cases", label: "Critical cases", kind: "number" },
            { key: "active_frcs", label: "Active FRCs", kind: "number" },
            { key: "fleet_vehicles", label: "Fleet vehicles", kind: "number" },
            { key: "vehicles_with_downtime", label: "Vehicles with downtime", kind: "number" },
            { key: "episodes", label: "Episodes", kind: "number" },
            { key: "downtime_days", label: "Downtime days", kind: "number" },
            { key: "mttr_days", label: "MTTR (days)", kind: "number" },
            { key: "availability_pct", label: "Availability %", kind: "percent" },
            { key: "condition_3_only", label: "Condition 3 only", kind: "number" },
          ],
          rows: data,
          total_rows: data.length,
          truncated: false,
          calculation: {
            tool: "get_fleet_kpis",
            metric: [
              "Same definitions as the dashboard header (fleet_summary): last 12 months",
              "Critical case = no active FRC and (≥ 3 counted episodes or ≥ 20 days in counted episodes)",
            ],
            period: `Last 12 months: ${addDaysIso(ctx.asOf, -364)} to ${ctx.asOf}`,
            filters: [
              ...depotNote,
              ...(input.organization ? [`Depot = ${input.organization}`] : []),
              ...(input.vehicle_type ? [`Vehicle type = ${input.vehicle_type}`] : []),
              ...(groupBy !== "none" ? [`Grouped by ${groupLabel.toLowerCase()}`] : []),
            ],
            source: "fleet_summary()",
          },
        });
      },
    }),

    get_vehicle_details: tool({
      description: "One vehicle by ID or plate: 12-month KPIs, FRC, which critical-case conditions it meets, and its episodes.",
      inputSchema: z.object({
        vehicle_id: z.number().int().positive().optional(),
        plate: z.string().min(2).max(20).optional().describe("Licence plate, spaces and hyphens are ignored"),
      }),
      execute: async (input) => {
        if (!input.vehicle_id && !input.plate) throw new Error("Give a vehicle_id or a plate.");
        let id = input.vehicle_id ?? null;
        if (!id) {
          const [found] = await run((sql) => [
            sql`select vehicle_id from public.vehicle_status_filtered(null, null, null, ${input.plate!})
                where vehicle_id::text <> ${input.plate!} order by vehicle_id limit 2`,
          ]);
          if (found.length > 1) return { found: false, message: "Several vehicles match that plate; ask for the vehicle ID." };
          id = found.length ? Number(found[0].vehicle_id) : null;
        }
        if (!id) return { found: false, message: "No vehicle with that plate is visible to this user." };
        const [status, episodes] = await run((sql) => [
          sql`select vehicle_id, plate_nr, vehicle_type, vehicle_class, organization_code, manufacture_year, episodes_12m,
                     downtime_days_12m, mttr_days_12m, avg_days_between_episodes_12m, availability_pct_12m,
                     frc_status, frc_active, frc_start::text, frc_end::text, cond1_episodes, cond2_days, cond3_days,
                     condition_1, condition_2, condition_3, is_critical
              from public.v_vehicle_status where vehicle_id = ${id}`,
          sql`select category, start_date::text, end_date::text, downtime_days, counted
              from public.vehicle_episodes(${id}) limit ${MAX_ROWS}`,
        ]);
        const v = status[0];
        if (!v) return { found: false, message: "No vehicle with that ID is visible to this user." };
        const result = save({
          title: `Episodes of vehicle ${v.vehicle_id} · ${v.plate_nr}`,
          columns: [
            { key: "category", label: "Category", kind: "text" },
            { key: "start_date", label: "Start", kind: "date" },
            { key: "end_date", label: "End", kind: "date" },
            { key: "downtime_days", label: "Days", kind: "number" },
            { key: "counted", label: "Counts for cond. 1–2", kind: "boolean" },
          ],
          rows: episodes.map((e) => ({
            category: String(e.category), start_date: String(e.start_date), end_date: String(e.end_date),
            downtime_days: num(e.downtime_days), counted: Boolean(e.counted) && !v.frc_active,
          })),
          total_rows: episodes.length,
          truncated: false,
          calculation: {
            tool: "get_vehicle_details",
            metric: ["Vehicle status and episodes from the semantic layer"],
            period: `KPIs: last 12 months (${addDaysIso(ctx.asOf, -364)} to ${ctx.asOf}); episodes: all on record`,
            filters: [...depotNote, `Vehicle = ${v.vehicle_id} · ${v.plate_nr}`],
            source: "v_vehicle_status, vehicle_episodes()",
          },
        });
        return { found: true, vehicle: v, episodes_result: result };
      },
    }),

    show_chart: tool({
      description:
        "Display a data result to the user. Call exactly once per answer, after the data tools, with the result_id " +
        "you want to show. chart_type: line for monthly trends, bar for rankings and breakdowns (up to ~15 rows), " +
        "table for lists of vehicles, KPIs or anything else.",
      inputSchema: z.object({
        result_id: z.string().describe("result_id returned by a data tool in this answer"),
        chart_type: z.enum(["bar", "line", "table"]),
        x: z.string().describe("Column key for categories / months"),
        y: z.array(z.string()).min(1).max(2).describe("1–2 numeric column keys"),
        title: z.string().min(3).max(80),
      }),
      execute: async (spec): Promise<{ ok: true; spec: ChartSpec } | { ok: false; error: string }> => {
        const r = results.get(spec.result_id);
        if (!r) return { ok: false, error: "Unknown result_id: call a data tool first in this answer." };
        const cols = new Map(r.columns.map((c) => [c.key, c]));
        if (!cols.has(spec.x)) return { ok: false, error: `x must be one of: ${r.columns.map((c) => c.key).join(", ")}` };
        const bad = spec.y.filter((k) => !["number", "percent"].includes(cols.get(k)?.kind ?? ""));
        if (spec.chart_type !== "table" && bad.length)
          return { ok: false, error: `y must be numeric columns of this result: ${r.columns.filter((c) => c.kind === "number" || c.kind === "percent").map((c) => c.key).join(", ")}` };
        return { ok: true, spec };
      },
    }),
  };
}

function addDaysIso(isoDate: string, n: number) {
  return new Date(Date.parse(isoDate + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}
