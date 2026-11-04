-- migrate:up
-- Users, database roles and row level security (Phase 2).
--
-- How a request is scoped:
--   1. The app server verifies the Neon Auth session and gets the user id.
--   2. In the same transaction it runs: select set_config('app.user_id', '<id>', true)
--   3. Policies look up that user's role and depot in app_users.
-- No user id (or an unknown one) = no rows: the policies fail closed.

-- Application profile per signed-in user (user_id = Neon Auth user id, created in Phase 3).
create table public.app_users (
  user_id            text primary key,
  display_name       text not null,
  role               text not null check (role in ('fleet_ops', 'depot_supervisor')),
  organization_code  text references public.organizations (code),
  constraint app_users_depot_chk check ((role = 'depot_supervisor') = (organization_code is not null))
);

-- Current request context ---------------------------------------------------
create function app.current_user_id()
returns text
language sql stable
set search_path = ''
as $$ select nullif(current_setting('app.user_id', true), '') $$;

create function app.current_user_role()
returns text
language sql stable
security invoker
set search_path = ''
as $$ select role from public.app_users where user_id = app.current_user_id() $$;

create function app.current_user_org()
returns text
language sql stable
security invoker
set search_path = ''
as $$ select organization_code from public.app_users where user_id = app.current_user_id() $$;

-- Row level security on every table ------------------------------------------
alter table public.organizations       enable row level security;
alter table public.vehicle_types       enable row level security;
alter table public.vehicles            enable row level security;
alter table public.downtime_events     enable row level security;
alter table public.fleet_review_cases  enable row level security;
alter table public.import_runs         enable row level security;
alter table public.app_users           enable row level security;

-- A user sees only their own profile.
create policy app_users_self on public.app_users
  for select using (user_id = app.current_user_id());

-- Fleet Operations sees every depot; a depot supervisor only their own.
create policy organizations_visible on public.organizations
  for select using (
    (select app.current_user_role()) = 'fleet_ops'
    or code = (select app.current_user_org()));

create policy vehicles_visible on public.vehicles
  for select using (
    (select app.current_user_role()) = 'fleet_ops'
    or organization_code = (select app.current_user_org()));

-- Episodes and review cases follow the visibility of their vehicle.
create policy downtime_events_visible on public.downtime_events
  for select using (vehicle_id in (select id from public.vehicles));

create policy fleet_review_cases_visible on public.fleet_review_cases
  for select using (vehicle_id in (select id from public.vehicles));

-- Reference data: any signed-in user with a profile.
create policy vehicle_types_signed_in on public.vehicle_types
  for select using ((select app.current_user_role()) is not null);

create policy import_runs_signed_in on public.import_runs
  for select using ((select app.current_user_role()) is not null);

-- Database roles ---------------------------------------------------------------
-- app_reader: read-only privileges used by the app. app_login: the login the app connects with
-- (its password is set by scripts/app-role.mjs, never in a migration).
do $$
begin
  if not exists (select from pg_roles where rolname = 'app_reader') then
    create role app_reader nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'app_login') then
    create role app_login login;
  end if;
end $$;

grant app_reader to app_login;
-- Lets the owner run verification queries as the app (set local role app_reader).
grant app_reader to current_user;

grant usage on schema public, app to app_reader;
grant select on public.organizations, public.vehicle_types, public.vehicles, public.downtime_events,
                public.fleet_review_cases, public.import_runs, public.app_users,
                public.v_downtime_events, public.v_vehicle_status, public.v_fleet_kpis
  to app_reader;
grant execute on function app.as_of(), app.current_user_id(), app.current_user_role(), app.current_user_org(),
                          public.vehicle_conditions(date),
                          public.downtime_metrics(date, date, text, text, text, text, text, integer),
                          public.health_check()
  to app_reader;
-- No insert, update, delete or truncate is granted anywhere: the app role is read-only.

-- migrate:down
revoke all on all tables in schema public from app_reader;
revoke all on all functions in schema public from app_reader;
revoke all on all functions in schema app from app_reader;
revoke usage on schema public, app from app_reader;
drop policy if exists import_runs_signed_in on public.import_runs;
drop policy if exists vehicle_types_signed_in on public.vehicle_types;
drop policy if exists fleet_review_cases_visible on public.fleet_review_cases;
drop policy if exists downtime_events_visible on public.downtime_events;
drop policy if exists vehicles_visible on public.vehicles;
drop policy if exists organizations_visible on public.organizations;
drop policy if exists app_users_self on public.app_users;
alter table public.app_users          disable row level security;
alter table public.import_runs        disable row level security;
alter table public.fleet_review_cases disable row level security;
alter table public.downtime_events    disable row level security;
alter table public.vehicles           disable row level security;
alter table public.vehicle_types      disable row level security;
alter table public.organizations      disable row level security;
drop function if exists app.current_user_org();
drop function if exists app.current_user_role();
drop function if exists app.current_user_id();
drop table if exists public.app_users;
drop role if exists app_login;
drop role if exists app_reader;
