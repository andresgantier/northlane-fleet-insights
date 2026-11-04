-- migrate:up
-- Dashboard helpers (Phase 3): the vehicle list and its KPIs with the dashboard filters.
-- Same definitions as v_vehicle_status / downtime_metrics (see docs/METRICS.md); RLS applies.

-- Vehicles (last 12 months) filtered by depot, type, FRC state and ID/plate search
-- (plate search ignores case, spaces and hyphens: "pl 4428" finds "PL-4428").
-- p_frc: null (any) | 'active' | 'none' (never had an FRC) | an exact FRC status.
create function public.vehicle_status_filtered(
  p_organization text default null,
  p_vehicle_type text default null,
  p_frc          text default null,
  p_search       text default null
)
returns setof public.v_vehicle_status
language sql stable
security invoker
set search_path = ''
as $$
  select s.*
  from public.v_vehicle_status s
  where (p_organization is null or s.organization_code = p_organization)
    and (p_vehicle_type is null or s.vehicle_type = p_vehicle_type)
    and (p_frc is null
         or (p_frc = 'active' and s.frc_active)
         or (p_frc = 'none' and s.frc_status is null)
         or s.frc_status = p_frc)
    and (p_search is null
         or s.vehicle_id::text = trim(p_search)
         or regexp_replace(lower(s.plate_nr), '[^a-z0-9]', '', 'g')
            like '%' || regexp_replace(lower(p_search), '[^a-z0-9]', '', 'g') || '%')
$$;

-- KPIs for the same filtered set. Availability uses every filtered vehicle (also those without downtime).
create function public.fleet_summary(
  p_organization text default null,
  p_vehicle_type text default null,
  p_frc          text default null,
  p_search       text default null
)
returns table (
  fleet_vehicles          integer,
  vehicles_with_downtime  integer,
  episodes                integer,
  downtime_days           integer,
  mttr_days               numeric,
  availability_pct        numeric,
  critical_cases          integer,
  condition_3_only        integer,
  active_frcs             integer
)
language sql stable
security invoker
set search_path = ''
as $$
  select
    count(*)::int,
    count(*) filter (where s.episodes_12m > 0)::int,
    coalesce(sum(s.episodes_12m), 0)::int,
    coalesce(sum(s.downtime_days_12m), 0)::int,
    round(sum(s.downtime_days_12m)::numeric / nullif(sum(s.episodes_12m), 0), 1),
    round(100 * (1 - coalesce(sum(s.downtime_days_12m), 0)::numeric / nullif(count(*) * 365, 0)), 2),
    count(*) filter (where s.is_critical)::int,
    count(*) filter (where s.condition_3 and not s.is_critical)::int,
    count(*) filter (where s.frc_active)::int
  from public.vehicle_status_filtered(p_organization, p_vehicle_type, p_frc, p_search) s
$$;

-- Episodes of one vehicle for the vehicle page, flagged when they count for conditions 1 and 2
-- (same rule as vehicle_conditions: start in the last 180 days and after the end of the last FRC).
create function public.vehicle_episodes(p_vehicle_id integer)
returns table (
  event_id            bigint,
  category            text,
  start_date          date,
  end_date            date,
  downtime_days       integer,
  days_source         integer,
  in_analysis_window  boolean,
  counted             boolean
)
language sql stable
security invoker
set search_path = ''
as $$
  select e.event_id, e.category, e.start_date, e.end_date, e.downtime_days, e.days_source,
         e.in_analysis_window,
         (e.start_date between app.as_of() - 179 and app.as_of()
          and (f.frc_end is null or e.start_date > f.frc_end))
  from public.v_downtime_events e
  left join public.fleet_review_cases f on f.vehicle_id = e.vehicle_id
  where e.vehicle_id = p_vehicle_id
  order by e.start_date desc
$$;

grant execute on function public.vehicle_status_filtered(text, text, text, text),
                          public.fleet_summary(text, text, text, text),
                          public.vehicle_episodes(integer)
  to app_reader;

-- migrate:down
drop function if exists public.vehicle_episodes(integer);
drop function if exists public.fleet_summary(text, text, text, text);
drop function if exists public.vehicle_status_filtered(text, text, text, text);
