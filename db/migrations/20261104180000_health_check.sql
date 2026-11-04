-- migrate:up
-- Health check used by GET /api/health.
-- Returns only server time and Postgres version: no table data.
create or replace function public.health_check()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'server_time', now(),
    'postgres_version', current_setting('server_version')
  );
$$;

-- migrate:down
drop function if exists public.health_check();
