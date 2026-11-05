import "server-only";
import { queryAsUser } from "@/lib/db";

export const PAGE_SIZE = 50;

export type DashboardFilters = {
  org: string | null;
  type: string | null;
  frc: string | null;
  q: string | null;
  page: number;
};

export type FleetSummary = {
  fleet_vehicles: number;
  vehicles_with_downtime: number;
  episodes: number;
  downtime_days: number;
  mttr_days: string | null;
  availability_pct: string | null;
  critical_cases: number;
  condition_3_only: number;
  active_frcs: number;
};

export type VehicleRow = {
  vehicle_id: number;
  plate_nr: string;
  vehicle_type: string;
  organization_code: string;
  episodes_12m: number;
  downtime_days_12m: number;
  frc_active: boolean;
  frc_status: string | null;
  latest_start: string | null;
  latest_end: string | null;
  is_critical: boolean;
};

export type DashboardData = {
  summary: FleetSummary;
  vehicles: VehicleRow[];
  totalRows: number;
  organizations: string[];
  vehicleTypes: string[];
  asOf: string;
  windowStart: string;
  lastImportAt: string | null;
};

// Reads everything the dashboard needs in one round trip, as the signed-in user (RLS applies).
// All metrics come from the semantic layer (fleet_summary / vehicle_status_filtered).
export async function getDashboardData(userId: string, f: DashboardFilters): Promise<DashboardData> {
  const offset = (f.page - 1) * PAGE_SIZE;
  const [summary, vehicles, total, orgs, types, meta] = await queryAsUser(userId, (sql) => [
    sql`select * from public.fleet_summary(${f.org}, ${f.type}, ${f.frc}, ${f.q})`,
    sql`select vehicle_id, plate_nr, vehicle_type, organization_code, episodes_12m, downtime_days_12m,
               frc_active, frc_status, latest_start::text, latest_end::text, is_critical
        from public.vehicle_status_filtered(${f.org}, ${f.type}, ${f.frc}, ${f.q})
        order by episodes_12m desc, downtime_days_12m desc, vehicle_id
        limit ${PAGE_SIZE} offset ${offset}`,
    sql`select count(*)::int as n from public.vehicle_status_filtered(${f.org}, ${f.type}, ${f.frc}, ${f.q})`,
    sql`select code from public.organizations order by code`,
    sql`select name from public.vehicle_types order by name`,
    sql`select app.as_of()::text as as_of, (app.as_of() - 364)::text as window_start,
               (select (max(imported_at) at time zone 'Europe/Berlin')::date from public.import_runs)::text as last_import_at`,
  ]);

  return {
    summary: summary[0] as FleetSummary,
    vehicles: vehicles as VehicleRow[],
    totalRows: Number(total[0]?.n ?? 0),
    organizations: orgs.map((r) => String(r.code)),
    vehicleTypes: types.map((r) => String(r.name)),
    asOf: String(meta[0].as_of),
    windowStart: String(meta[0].window_start),
    lastImportAt: (meta[0].last_import_at as string | null) ?? null,
  };
}
