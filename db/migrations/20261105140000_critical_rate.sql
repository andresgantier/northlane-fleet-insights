-- migrate:up
-- Critical rate (after the Phase 7 review): critical cases per 100 fleet vehicles, so depots or types of
-- different size can be compared. Defined here once; the assistant shows it, it never computes ratios itself.
drop function public.fleet_summary(text, text, text, text);

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
  active_frcs             integer,
  critical_rate_pct       numeric   -- critical cases / fleet vehicles × 100
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
    count(*) filter (where s.frc_active)::int,
    round(100 * count(*) filter (where s.is_critical)::numeric / nullif(count(*), 0), 1)
  from public.vehicle_status_filtered(p_organization, p_vehicle_type, p_frc, p_search) s
$$;

grant execute on function public.fleet_summary(text, text, text, text) to app_reader;

-- migrate:down
drop function public.fleet_summary(text, text, text, text);
create function public.fleet_summary(
  p_organization text default null, p_vehicle_type text default null,
  p_frc text default null, p_search text default null
)
returns table (
  fleet_vehicles integer, vehicles_with_downtime integer, episodes integer, downtime_days integer,
  mttr_days numeric, availability_pct numeric, critical_cases integer, condition_3_only integer, active_frcs integer
)
language sql stable security invoker set search_path = ''
as $$
  select count(*)::int, count(*) filter (where s.episodes_12m > 0)::int, coalesce(sum(s.episodes_12m), 0)::int,
         coalesce(sum(s.downtime_days_12m), 0)::int,
         round(sum(s.downtime_days_12m)::numeric / nullif(sum(s.episodes_12m), 0), 1),
         round(100 * (1 - coalesce(sum(s.downtime_days_12m), 0)::numeric / nullif(count(*) * 365, 0)), 2),
         count(*) filter (where s.is_critical)::int,
         count(*) filter (where s.condition_3 and not s.is_critical)::int,
         count(*) filter (where s.frc_active)::int
  from public.vehicle_status_filtered(p_organization, p_vehicle_type, p_frc, p_search) s
$$;
grant execute on function public.fleet_summary(text, text, text, text) to app_reader;
