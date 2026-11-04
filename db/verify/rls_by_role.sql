-- RLS verification (npm run db:sql -- db/verify/rls_by_role.sql).
-- Runs as owner inside a transaction that is rolled back: creates two test profiles,
-- then queries as the read-only app role with each user id.
begin;
insert into public.app_users (user_id, display_name, role, organization_code) values
  ('test-fleet-ops', 'Test Fleet Ops', 'fleet_ops', null),
  ('test-supervisor-ej', 'Test Supervisor EJ', 'depot_supervisor', 'W-EUN/EJ');

set local role app_reader;

-- 1. No user context: nothing is visible.
select 'no user' as scenario, (select count(*) from public.vehicles)::int as vehicles,
       (select count(*) from public.downtime_events)::int as episodes,
       (select critical_cases from public.v_fleet_kpis) as critical_cases;

-- 2. Fleet Operations: everything.
select set_config('app.user_id', 'test-fleet-ops', true);
select 'fleet_ops' as scenario, (select count(*) from public.vehicles)::int as vehicles,
       (select count(*) from public.downtime_events)::int as episodes,
       (select count(distinct organization_code) from public.v_vehicle_status)::int as depots,
       (select critical_cases from public.v_fleet_kpis) as critical_cases;

-- 3. Depot supervisor W-EUN/EJ: only that depot.
select set_config('app.user_id', 'test-supervisor-ej', true);
select 'supervisor EJ' as scenario, (select count(*) from public.vehicles)::int as vehicles,
       (select count(*) from public.downtime_events)::int as episodes,
       (select string_agg(distinct organization_code, ', ') from public.v_vehicle_status) as depots,
       (select critical_cases from public.v_fleet_kpis) as critical_cases,
       (select count(*) from public.fleet_review_cases)::int as frcs;

-- 4. Supervisor asking for another depot through the metrics function: zero vehicles.
select 'supervisor EJ asks for W-EUN/C' as scenario, fleet_vehicles, episodes, downtime_days
from public.downtime_metrics(app.as_of() - 364, app.as_of(), 'none', 'W-EUN/C');

-- 5. Unknown user id: nothing.
select set_config('app.user_id', 'someone-else', true);
select 'unknown user' as scenario, (select count(*) from public.vehicles)::int as vehicles;

rollback;

-- Reference (owner, no RLS): depot W-EUN/EJ expected values.
select 'expected EJ (owner)' as scenario, count(*)::int as vehicles,
       (select count(*) from public.downtime_events e join public.vehicles v on v.id = e.vehicle_id where v.organization_code = 'W-EUN/EJ')::int as episodes,
       (select count(*) from public.fleet_review_cases f join public.vehicles v on v.id = f.vehicle_id where v.organization_code = 'W-EUN/EJ')::int as frcs
from public.vehicles where organization_code = 'W-EUN/EJ';
