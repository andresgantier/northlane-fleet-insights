-- migrate:up
-- Supervised action (Phase 5b): open a Fleet Review Case for a critical case.
-- The assistant only proposes; the user confirms with a button that calls this function.
-- It is the only write path of the app and enforces every rule itself:
--   only fleet_ops, only critical cases, never while an FRC is active, idempotent per request, always audited.

-- Audit log of every attempt (opened or rejected). No foreign key to vehicles on purpose:
-- the audit survives a re-import of the fleet data.
create table public.frc_actions (
  id                  bigint generated always as identity primary key,
  request_id          uuid not null unique,      -- one per confirmation card: repeated clicks do nothing
  created_at          timestamptz not null default now(),
  user_id             text not null,
  user_name           text not null,
  user_role           text not null,
  vehicle_id          integer not null,
  result              text not null check (result in ('opened', 'rejected_role', 'rejected_not_visible',
                                                      'rejected_not_critical', 'rejected_active')),
  message             text not null,
  previous_status     text,                      -- FRC replaced by the new one (one FRC per vehicle)
  previous_frc_start  date,
  previous_frc_end    date
);
create index frc_actions_vehicle_idx on public.frc_actions (vehicle_id, created_at desc);

alter table public.frc_actions enable row level security;
-- Fleet Operations sees the whole audit; a supervisor sees the attempts on vehicles of their depot.
create policy frc_actions_visible on public.frc_actions
  for select using (
    (select app.current_user_role()) = 'fleet_ops'
    or vehicle_id in (select id from public.vehicles));
grant select on public.frc_actions to app_reader;

create function app.open_fleet_review_case(p_vehicle_id integer, p_request_id uuid)
returns jsonb
language plpgsql volatile
security definer
set search_path = ''
as $$
declare
  v_user       public.app_users%rowtype;
  v_existing   public.frc_actions%rowtype;
  v_frc        public.fleet_review_cases%rowtype;
  v_critical   boolean;
  v_result     text;
  v_message    text;
begin
  -- Same request again (double click, retry): return the first outcome, change nothing.
  select * into v_existing from public.frc_actions where request_id = p_request_id;
  if found then
    return jsonb_build_object('result', v_existing.result, 'message', v_existing.message, 'repeated', true);
  end if;

  select * into v_user from public.app_users where user_id = app.current_user_id();
  if not found then
    raise exception 'No signed-in user';
  end if;

  -- Serialize concurrent attempts on the same vehicle.
  perform 1 from public.vehicles where id = p_vehicle_id for update;
  if not found then
    v_result := 'rejected_not_visible';
    v_message := 'Vehicle not found.';
  elsif v_user.role <> 'fleet_ops' then
    v_result := 'rejected_role';
    v_message := 'Only Fleet Operations can open a Fleet Review Case.';
  else
    select * into v_frc from public.fleet_review_cases where vehicle_id = p_vehicle_id;
    select c.is_critical into v_critical from public.vehicle_conditions(app.as_of()) c where c.vehicle_id = p_vehicle_id;
    if coalesce(v_frc.is_active, false) then
      v_result := 'rejected_active';
      v_message := 'This vehicle already has an active Fleet Review Case.';
    elsif not coalesce(v_critical, false) then
      v_result := 'rejected_not_critical';
      v_message := 'This vehicle is not a critical case, so no Fleet Review Case is needed.';
    else
      insert into public.fleet_review_cases (vehicle_id, status, frc_start, frc_end, grace_period_until)
      values (p_vehicle_id, 'Review Case Active – Standard', app.as_of(), null, null)
      on conflict (vehicle_id) do update
        set status = excluded.status, frc_start = excluded.frc_start,
            frc_end = null, grace_period_until = null;
      v_result := 'opened';
      v_message := 'Fleet Review Case opened (Active – Standard) from ' || app.as_of()::text || '.';
    end if;
  end if;

  insert into public.frc_actions (request_id, user_id, user_name, user_role, vehicle_id, result, message,
                                  previous_status, previous_frc_start, previous_frc_end)
  values (p_request_id, v_user.user_id, v_user.display_name, v_user.role, p_vehicle_id, v_result, v_message,
          v_frc.status, v_frc.frc_start, v_frc.frc_end);

  return jsonb_build_object('result', v_result, 'message', v_message, 'repeated', false);
end;
$$;

revoke all on function app.open_fleet_review_case(integer, uuid) from public;
grant execute on function app.open_fleet_review_case(integer, uuid) to app_reader;

-- migrate:down
drop function if exists app.open_fleet_review_case(integer, uuid);
drop table if exists public.frc_actions;
