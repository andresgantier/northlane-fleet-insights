-- Rules of the supervised FRC changes (npm run db:sql -- db/verify/change_frc_rules.sql).
-- Runs as the read-only app role with each demo user inside a transaction that is rolled back.
-- Vehicles: 636 active FRC (W-EUN/EL), 259 active FRC, 946 no FRC, 22 closed FRC.
begin;
select set_config('app.user_id', (select user_id from public.app_users where role = 'depot_supervisor' limit 1), true);
set local role app_reader;
select '1. supervisor closes 636' as test, app.change_fleet_review_case(636, gen_random_uuid(), 'close', 'Review Case Closed – With Action Plan', null, null) ->> 'result' as outcome;

reset role;
select set_config('app.user_id', (select user_id from public.app_users where role = 'fleet_ops' limit 1), true);
set local role app_reader;
select '2. close 636 with action plan' as test, app.change_fleet_review_case(636, gen_random_uuid(), 'close', 'Review Case Closed – With Action Plan', null, null) ->> 'result' as outcome;
select '3. close 636 again' as test, app.change_fleet_review_case(636, gen_random_uuid(), 'close', 'Review Case Closed – No Action Plan', null, null) ->> 'result' as outcome;
select '4. correct start of 636' as test, app.change_fleet_review_case(636, gen_random_uuid(), 'edit', null, app.as_of() - 120, null) ->> 'result' as outcome;
select '5. start after end' as test, app.change_fleet_review_case(636, gen_random_uuid(), 'edit', null, app.as_of() + 5, null) ->> 'result' as outcome;
select '6. past FRC for 946' as test, app.change_fleet_review_case(946, gen_random_uuid(), 'record_past', 'Review Case Closed – No Action Plan', app.as_of() - 200, app.as_of() - 150) ->> 'result' as outcome;
select '7. past FRC on active 259' as test, app.change_fleet_review_case(259, gen_random_uuid(), 'record_past', 'Review Case Aborted', app.as_of() - 90, app.as_of() - 60) ->> 'result' as outcome;
select '8. abort = "remove" 259' as test, app.change_fleet_review_case(259, gen_random_uuid(), 'close', 'Review Case Aborted', null, null) ->> 'result' as outcome;
select '9. vehicles now' as test, vehicle_id, frc_status, frc_start::text, frc_end::text, is_critical
from public.v_vehicle_status where vehicle_id in (636, 946, 259) order by vehicle_id;
select '10. audit' as test, vehicle_id, action, result, previous_status, new_status from public.frc_actions
where created_at > now() - interval '1 minute' order by id;
rollback;
