-- Rules of the supervised "open FRC" action (npm run db:sql -- db/verify/open_frc_rules.sql).
-- Runs as the read-only app role with each demo user inside a transaction that is rolled back.
-- Vehicles: 22 critical (W-EUN/EH), 636 active FRC, 946 not critical.
begin;
select set_config('app.user_id', (select user_id from public.app_users where role = 'depot_supervisor' limit 1), true);
set local role app_reader;
select '1. supervisor opens 22' as test, app.open_fleet_review_case(22, '00000000-0000-0000-0000-000000000001') ->> 'result' as outcome;

reset role;
select set_config('app.user_id', (select user_id from public.app_users where role = 'fleet_ops' limit 1), true);
set local role app_reader;
select '2. fleet ops opens 22' as test, app.open_fleet_review_case(22, '00000000-0000-0000-0000-000000000002') ->> 'result' as outcome;
select '3. same request again' as test, app.open_fleet_review_case(22, '00000000-0000-0000-0000-000000000002') ->> 'result' as outcome;
select '4. new request for 22' as test, app.open_fleet_review_case(22, '00000000-0000-0000-0000-000000000003') ->> 'result' as outcome;
select '5. vehicle 636 (active FRC)' as test, app.open_fleet_review_case(636, '00000000-0000-0000-0000-000000000004') ->> 'result' as outcome;
select '6. vehicle 946 (not critical)' as test, app.open_fleet_review_case(946, '00000000-0000-0000-0000-000000000005') ->> 'result' as outcome;
select '7. vehicle 22 after opening' as test, frc_status, frc_active, is_critical from public.v_vehicle_status where vehicle_id = 22;
select '8. critical cases now' as test, critical_cases from public.v_fleet_kpis;
select '9. audit' as test, vehicle_id, user_role, result from public.frc_actions order by id;
rollback;
