-- Read-only check (npm run db:sql -- db/verify/app_role_read_only.sql --app).
-- Connects as app_login: without a user context it sees nothing, and any write is rejected.
select current_user, (select count(*) from public.vehicles)::int as vehicles_without_user;
select (select public.health_check()) is not null as health_check_ok;
-- Each write must fail with "permission denied"; if one succeeds, this block raises WRITE ALLOWED.
do $$
begin
  begin insert into public.organizations values ('X-TEST/XX', 'X', 'TEST', 'XX'); raise exception 'WRITE ALLOWED: insert';
  exception when insufficient_privilege then null; end;
  begin update public.downtime_events set end_date = end_date; raise exception 'WRITE ALLOWED: update';
  exception when insufficient_privilege then null; end;
  begin delete from public.fleet_review_cases; raise exception 'WRITE ALLOWED: delete';
  exception when insufficient_privilege then null; end;
  begin truncate public.vehicles; raise exception 'WRITE ALLOWED: truncate';
  exception when insufficient_privilege then null; end;
end $$;
select 'insert, update, delete and truncate rejected' as writes;
