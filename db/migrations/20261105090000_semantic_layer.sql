-- migrate:up
-- Semantic layer (Phase 2): the single definition of every metric and business rule.
-- Dashboard, assistant and exports read only from these views and functions.
-- All of them are SECURITY INVOKER, so row level security applies to the user who queries.
-- Definitions are documented in docs/METRICS.md.

alter table public.import_runs rename column source_snapshot_date to source_reference_date;

create schema app;

-- Reference date for all rolling windows: today in Europe/Berlin.
create function app.as_of()
returns date
language sql stable
set search_path = ''
as $$ select (now() at time zone 'Europe/Berlin')::date $$;

-- ---------------------------------------------------------------------------
-- Episode grain: one row per downtime episode with vehicle attributes.
-- ---------------------------------------------------------------------------
create view public.v_downtime_events with (security_invoker = true) as
select
  e.id                 as event_id,
  e.vehicle_id,
  v.plate_nr,
  t.name               as vehicle_type,
  t.vehicle_class,
  v.organization_code,
  v.manufacture_year,
  e.category,
  e.start_date,
  e.end_date,
  e.downtime_days,
  e.days_source,
  -- Analysis window: episodes that start or end in the last 12 months (365 days incl. today).
  (e.start_date <= app.as_of() and e.end_date >= app.as_of() - 364) as in_analysis_window
from public.downtime_events e
join public.vehicles v       on v.id = e.vehicle_id
join public.vehicle_types t  on t.id = v.vehicle_type_id;

-- ---------------------------------------------------------------------------
-- Critical-case rules per vehicle at a given date (translated from the Power BI DAX).
--   Counted episodes: start in the last 6 months (180 days), after the end of the last FRC.
--   Condition 1: no active FRC and >= 3 counted episodes.
--   Condition 2: no active FRC and >= 20 downtime days in counted episodes.
--   Condition 3: no active FRC and > 20 downtime days in the last 12 months (all episodes).
-- is_critical follows the Power BI report: conditions 1 and 2 (condition 3 is reported separately).
-- ---------------------------------------------------------------------------
create function public.vehicle_conditions(p_as_of date)
returns table (
  vehicle_id      integer,
  frc_active      boolean,
  cond1_episodes  integer,
  cond2_days      integer,
  cond3_days      integer,
  condition_1     boolean,
  condition_2     boolean,
  condition_3     boolean,
  is_critical     boolean
)
language sql stable
security invoker
set search_path = ''
as $$
  with per_vehicle as (
    select
      v.id,
      coalesce(f.is_active, false) as active,
      count(e.id) filter (
        where e.start_date between p_as_of - 179 and p_as_of
          and (f.frc_end is null or e.start_date > f.frc_end))::int as c1,
      coalesce(sum(e.downtime_days) filter (
        where e.start_date between p_as_of - 179 and p_as_of
          and (f.frc_end is null or e.start_date > f.frc_end)), 0)::int as c2,
      coalesce(sum(least(e.end_date, p_as_of) - greatest(e.start_date, p_as_of - 364) + 1) filter (
        where e.start_date <= p_as_of and e.end_date >= p_as_of - 364), 0)::int as c3
    from public.vehicles v
    left join public.fleet_review_cases f on f.vehicle_id = v.id
    left join public.downtime_events e on e.vehicle_id = v.id
    group by v.id, f.is_active
  )
  select
    id, active, c1, c2, c3,
    not active and c1 >= 3,
    not active and c2 >= 20,
    not active and c3 > 20,
    not active and (c1 >= 3 or c2 >= 20)
  from per_vehicle
$$;

-- ---------------------------------------------------------------------------
-- Generic downtime metrics for a period, optionally grouped and filtered.
-- Episodes count when they overlap the period; downtime days are clipped to the period.
-- p_group_by: none | month | organization | vehicle_type | vehicle_class | category | vehicle
-- ---------------------------------------------------------------------------
create function public.downtime_metrics(
  p_from          date,
  p_to            date,
  p_group_by      text    default 'none',
  p_organization  text    default null,
  p_vehicle_class text    default null,
  p_vehicle_type  text    default null,
  p_category      text    default null,
  p_vehicle_id    integer default null
)
returns table (
  group_key               text,
  period_start            date,
  period_end              date,
  fleet_vehicles          integer,
  vehicles_with_downtime  integer,
  episodes                integer,
  downtime_days           integer,
  mttr_days               numeric,
  availability_pct        numeric
)
language sql stable
security invoker
set search_path = ''
as $$
  with fv as (                      -- visible vehicles matching the filters
    select v.id, v.plate_nr, v.organization_code, t.name as vehicle_type, t.vehicle_class
    from public.vehicles v
    join public.vehicle_types t on t.id = v.vehicle_type_id
    where (p_organization  is null or v.organization_code = p_organization)
      and (p_vehicle_class is null or t.vehicle_class = p_vehicle_class)
      and (p_vehicle_type  is null or t.name = p_vehicle_type)
      and (p_vehicle_id    is null or v.id = p_vehicle_id)
  ),
  buckets as (                      -- whole period, or one bucket per calendar month
    select p_from as b_start, p_to as b_end
    where p_group_by in ('none', 'organization', 'vehicle_type', 'vehicle_class', 'category', 'vehicle')
      and p_to >= p_from
    union all
    select greatest(m::date, p_from), least((m + interval '1 month - 1 day')::date, p_to)
    from generate_series(date_trunc('month', p_from), p_to, interval '1 month') as g(m)
    where p_group_by = 'month' and p_to >= p_from
  ),
  groups as (                       -- every group that exists, so zero-downtime groups still appear
    select b.b_start, b.b_end,
      case p_group_by
        when 'organization'  then fv.organization_code
        when 'vehicle_type'  then fv.vehicle_type
        when 'vehicle_class' then fv.vehicle_class
        when 'vehicle'       then fv.id || ' · ' || fv.plate_nr
        when 'month'         then to_char(b.b_start, 'YYYY-MM')
        else 'All'
      end as k,
      count(*)::int as n_vehicles
    from buckets b cross join fv
    where p_group_by <> 'category'
    group by 1, 2, 3
    union all
    select b.b_start, b.b_end, c.category, (select count(*) from fv)::int
    from buckets b
    cross join unnest(array['Mechanical Breakdown', 'Scheduled Maintenance',
                            'Inspection/Compliance Hold', 'Accident/Collision Damage']) as c(category)
    where p_group_by = 'category'
      and (p_category is null or c.category = p_category)
  ),
  ev as (                           -- episodes overlapping each bucket, days clipped to it
    select b.b_start, fv.id as vehicle_id,
      case p_group_by
        when 'organization'  then fv.organization_code
        when 'vehicle_type'  then fv.vehicle_type
        when 'vehicle_class' then fv.vehicle_class
        when 'category'      then e.category
        when 'vehicle'       then fv.id || ' · ' || fv.plate_nr
        when 'month'         then to_char(b.b_start, 'YYYY-MM')
        else 'All'
      end as k,
      least(e.end_date, b.b_end) - greatest(e.start_date, b.b_start) + 1 as days
    from buckets b
    join public.downtime_events e on e.start_date <= b.b_end and e.end_date >= b.b_start
    join fv on fv.id = e.vehicle_id
    where (p_category is null or e.category = p_category)
  ),
  agg as (
    select b_start, k, count(distinct vehicle_id)::int as vwd, count(*)::int as eps, sum(days)::int as dd
    from ev group by b_start, k
  )
  select
    g.k, g.b_start, g.b_end, g.n_vehicles,
    coalesce(a.vwd, 0), coalesce(a.eps, 0), coalesce(a.dd, 0),
    round(a.dd::numeric / nullif(a.eps, 0), 1),
    case when p_group_by = 'category' then null
         else round(100 * (1 - coalesce(a.dd, 0)::numeric / nullif(g.n_vehicles * (g.b_end - g.b_start + 1), 0)), 2)
    end
  from groups g
  left join agg a on a.b_start = g.b_start and a.k = g.k
  order by g.b_start, coalesce(a.dd, 0) desc, g.k
$$;

-- ---------------------------------------------------------------------------
-- Vehicle grain: everything the dashboard list and vehicle page need (last 12 months).
-- ---------------------------------------------------------------------------
create view public.v_vehicle_status with (security_invoker = true) as
with w as (select app.as_of() as as_of, app.as_of() - 364 as w_start),
ep as (
  select e.vehicle_id, e.start_date, e.end_date,
    least(e.end_date, w.as_of) - greatest(e.start_date, w.w_start) + 1 as days_in_window,
    e.start_date - lag(e.end_date) over (partition by e.vehicle_id order by e.start_date) - 1 as gap_days
  from public.downtime_events e cross join w
),
win as (
  select ep.vehicle_id,
    count(*)::int                         as episodes_12m,
    sum(ep.days_in_window)::int           as downtime_days_12m,
    max(ep.start_date)                    as latest_start,
    max(ep.end_date)                      as latest_end,
    round(avg(ep.gap_days), 1)            as avg_days_between_episodes_12m
  from ep cross join w
  where ep.start_date <= w.as_of and ep.end_date >= w.w_start
  group by ep.vehicle_id
)
select
  v.id                         as vehicle_id,
  v.plate_nr,
  t.name                       as vehicle_type,
  t.vehicle_class,
  v.organization_code,
  v.manufacture_year,
  coalesce(win.episodes_12m, 0)       as episodes_12m,
  coalesce(win.downtime_days_12m, 0)  as downtime_days_12m,
  round(win.downtime_days_12m::numeric / nullif(win.episodes_12m, 0), 1) as mttr_days_12m,
  win.avg_days_between_episodes_12m,
  round(100 * (1 - coalesce(win.downtime_days_12m, 0)::numeric / 365), 2) as availability_pct_12m,
  win.latest_start,
  win.latest_end,
  f.status                     as frc_status,
  coalesce(f.is_active, false) as frc_active,
  f.frc_start,
  f.frc_end,
  f.grace_period_until,
  c.cond1_episodes,
  c.cond2_days,
  c.cond3_days,
  c.condition_1,
  c.condition_2,
  c.condition_3,
  c.is_critical
from public.vehicles v
join public.vehicle_types t on t.id = v.vehicle_type_id
left join win on win.vehicle_id = v.id
left join public.fleet_review_cases f on f.vehicle_id = v.id
join public.vehicle_conditions(app.as_of()) c on c.vehicle_id = v.id;

-- ---------------------------------------------------------------------------
-- Fleet KPIs (one row) for the dashboard header, last 12 months.
-- ---------------------------------------------------------------------------
create view public.v_fleet_kpis with (security_invoker = true) as
select
  app.as_of()                    as as_of,
  app.as_of() - 364              as window_start,
  m.fleet_vehicles,
  m.vehicles_with_downtime,
  m.episodes,
  m.downtime_days,
  m.mttr_days,
  m.availability_pct,
  (select count(*) from public.v_vehicle_status s where s.is_critical)::int  as critical_cases,
  (select count(*) from public.v_vehicle_status s where s.condition_3 and not s.is_critical)::int as condition_3_only,
  (select count(*) from public.fleet_review_cases f where f.is_active)::int  as active_frcs,
  (select round(avg(s.avg_days_between_episodes_12m), 1) from public.v_vehicle_status s) as avg_days_between_episodes,
  (select max(r.imported_at) from public.import_runs r) as last_import_at
from public.downtime_metrics(app.as_of() - 364, app.as_of()) m;

-- migrate:down
drop view if exists public.v_fleet_kpis;
drop view if exists public.v_vehicle_status;
drop function if exists public.downtime_metrics(date, date, text, text, text, text, text, integer);
drop function if exists public.vehicle_conditions(date);
drop view if exists public.v_downtime_events;
drop schema if exists app cascade;
alter table public.import_runs rename column source_reference_date to source_snapshot_date;
