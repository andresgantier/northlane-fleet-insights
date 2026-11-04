import "server-only";
import { queryAsUser } from "@/lib/db";

export type VehicleStatus = {
  vehicle_id: number;
  plate_nr: string;
  vehicle_type: string;
  vehicle_class: string;
  organization_code: string;
  manufacture_year: number;
  episodes_12m: number;
  downtime_days_12m: number;
  mttr_days_12m: string | null;
  avg_days_between_episodes_12m: string | null;
  availability_pct_12m: string;
  latest_start: string | null;
  latest_end: string | null;
  frc_status: string | null;
  frc_active: boolean;
  frc_start: string | null;
  frc_end: string | null;
  grace_period_until: string | null;
  cond1_episodes: number;
  cond2_days: number;
  cond3_days: number;
  condition_1: boolean;
  condition_2: boolean;
  condition_3: boolean;
  is_critical: boolean;
};

export type Episode = {
  event_id: number;
  category: string;
  start_date: string;
  end_date: string;
  downtime_days: number;
  days_source: number;
  in_analysis_window: boolean;
  counted: boolean; // counts for conditions 1 and 2
};

export type VehicleDetail = { vehicle: VehicleStatus; episodes: Episode[]; asOf: string };

// One vehicle as the signed-in user. Returns null when it does not exist or is not visible (RLS).
export async function getVehicleDetail(userId: string, vehicleId: number): Promise<VehicleDetail | null> {
  const [vehicle, episodes, meta] = await queryAsUser(userId, (sql) => [
    sql`select vehicle_id, plate_nr, vehicle_type, vehicle_class, organization_code, manufacture_year,
               episodes_12m, downtime_days_12m, mttr_days_12m, avg_days_between_episodes_12m,
               availability_pct_12m, latest_start::text, latest_end::text, frc_status, frc_active,
               frc_start::text, frc_end::text, grace_period_until::text, cond1_episodes, cond2_days,
               cond3_days, condition_1, condition_2, condition_3, is_critical
        from public.v_vehicle_status where vehicle_id = ${vehicleId}`,
    sql`select event_id, category, start_date::text, end_date::text, downtime_days, days_source,
               in_analysis_window, counted
        from public.vehicle_episodes(${vehicleId})`,
    sql`select app.as_of()::text as as_of`,
  ]);
  if (!vehicle[0]) return null;
  return {
    vehicle: vehicle[0] as VehicleStatus,
    episodes: episodes as Episode[],
    asOf: String(meta[0].as_of),
  };
}
