-- migrate:up
-- Core data model for NorthLane fleet downtime (Phase 1).
-- Data is loaded only by scripts/import.mjs (npm run db:import). RLS policies come in Phase 2.

-- Depots / branches. Code format "W-EUN/EJ" -> levels W / EUN / EJ (Org Lvl 3/4/5 in Power BI).
create table public.organizations (
  code       text primary key,
  org_lvl_3  text not null,
  org_lvl_4  text not null,
  org_lvl_5  text not null
);

-- 35 vehicle types grouped into a vehicle class (Trailer / Truck / Van) for questions like "which trailers...".
create table public.vehicle_types (
  id             smallint generated always as identity primary key,
  name           text not null unique,
  vehicle_class  text not null check (vehicle_class in ('Trailer', 'Truck', 'Van'))
);

-- One row per vehicle. "Vehicle Age" in the source is actually the manufacture year.
create table public.vehicles (
  id                 integer primary key,              -- ID_Vehicle from the source
  plate_nr           text not null unique,
  vehicle_type_id    smallint not null references public.vehicle_types (id),
  organization_code  text not null references public.organizations (code),
  manufacture_year   smallint not null check (manufacture_year between 1990 and 2100)
);
create index vehicles_organization_idx on public.vehicles (organization_code);
create index vehicles_type_idx on public.vehicles (vehicle_type_id);

-- Downtime episodes. downtime_days is the normalized value (inclusive calendar days);
-- days_source keeps the original "Days" column for audit (it uses 0 for some same-day episodes).
create table public.downtime_events (
  id             bigint generated always as identity primary key,
  vehicle_id     integer not null references public.vehicles (id),
  category       text not null check (category in (
                   'Mechanical Breakdown', 'Scheduled Maintenance',
                   'Inspection/Compliance Hold', 'Accident/Collision Damage')),
  start_date     date not null,
  end_date       date not null,
  days_source    integer not null check (days_source >= 0),
  downtime_days  integer generated always as (end_date - start_date + 1) stored,
  constraint downtime_events_dates_chk check (end_date >= start_date),
  constraint downtime_events_unique unique (vehicle_id, category, start_date, end_date)
);
create index downtime_events_vehicle_idx on public.downtime_events (vehicle_id, start_date);
create index downtime_events_start_idx on public.downtime_events (start_date);
create index downtime_events_end_idx on public.downtime_events (end_date);

-- Fleet Review Cases: at most one per vehicle (as in the source export).
create table public.fleet_review_cases (
  vehicle_id          integer primary key references public.vehicles (id),
  status              text not null check (status in (
                        'Review Case Active – Standard', 'Review Case Active – Individual',
                        'Review Case Closed – With Action Plan', 'Review Case Closed – No Action Plan',
                        'Review Case Declined', 'Review Case Aborted')),
  is_active           boolean generated always as (
                        status in ('Review Case Active – Standard', 'Review Case Active – Individual')) stored,
  frc_start           date not null,
  frc_end             date,
  grace_period_until  date,
  constraint frc_dates_chk check (frc_end is null or frc_end >= frc_start),
  constraint frc_active_open_chk check (is_active = (frc_end is null))
);

-- One row per import run: when it ran, the source snapshot date and the date shift applied.
create table public.import_runs (
  id                    bigint generated always as identity primary key,
  imported_at           timestamptz not null default now(),
  source_snapshot_date  date not null,       -- "Last Update" of the original Power BI report
  shift_days            integer not null,    -- days added to every source date
  report                jsonb not null       -- counts and data quality findings
);

-- migrate:down
drop table if exists public.import_runs;
drop table if exists public.fleet_review_cases;
drop table if exists public.downtime_events;
drop table if exists public.vehicles;
drop table if exists public.vehicle_types;
drop table if exists public.organizations;
