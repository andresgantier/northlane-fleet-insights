-- Dashboard KPIs by role (npm run db:sql -- db/verify/dashboard_kpis_by_role.sql).
-- The numbers must equal the KPI cards on the dashboard for each demo account.
-- Runs as the read-only app role with each demo user's id, inside a rolled-back transaction.
begin;
select set_config('app.user_id', (select user_id from public.app_users where role = 'fleet_ops' limit 1), true);
set local role app_reader;
select 'Fleet Operations' as account, * from public.fleet_summary();
reset role;
select set_config('app.user_id', (select user_id from public.app_users where role = 'depot_supervisor' limit 1), true);
set local role app_reader;
select 'Depot Supervisor W-EUN/EJ' as account, * from public.fleet_summary();
rollback;
