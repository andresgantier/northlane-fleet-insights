-- migrate:up
-- Supervised FRC changes (Phase 5c): close an active FRC, correct its dates, or record a past FRC.
-- Same pattern as opening one: the assistant proposes, a Fleet Operations user confirms, and this
-- function enforces every rule and writes the audit. Nothing is deleted: "remove" means status Aborted.
-- One FRC per vehicle (as in the source): a recorded past FRC replaces the stored one; the replaced
-- values stay in the audit log.

alter table public.frc_actions drop constraint frc_actions_result_check;
alter table public.frc_actions add constraint frc_actions_result_check check (result in (
  'opened', 'closed', 'edited', 'recorded',
  'rejected_role', 'rejected_not_visible', 'rejected_not_critical', 'rejected_active', 'rejected_invalid'));
alter table public.frc_actions
  add column action        text not null default 'open' check (action in ('open', 'close', 'edit', 'record_past')),
  add column new_status    text,
  add column new_frc_start date,
  add column new_frc_end   date;

create function app.change_fleet_review_case(
  p_vehicle_id integer,
  p_request_id uuid,
  p_action     text,     -- close | edit | record_past
  p_status     text,     -- close/record_past: closed status; edit: ignored (keeps the status)
  p_start      date,     -- edit/record_past: start date; close: ignored
  p_end        date      -- close/record_past: end date (close defaults to today); edit: new end of a closed FRC
)
returns jsonb
language plpgsql volatile
security definer
set search_path = ''
as $$
declare
  v_user     public.app_users%rowtype;
  v_existing public.frc_actions%rowtype;
  v_frc      public.fleet_review_cases%rowtype;
  v_today    date := app.as_of();
  v_status   text;
  v_start    date;
  v_end      date;
  v_result   text;
  v_message  text;
begin
  select * into v_existing from public.frc_actions where request_id = p_request_id;
  if found then
    return jsonb_build_object('result', v_existing.result, 'message', v_existing.message, 'repeated', true);
  end if;

  select * into v_user from public.app_users where user_id = app.current_user_id();
  if not found then
    raise exception 'No signed-in user';
  end if;
  if p_action not in ('close', 'edit', 'record_past') then
    raise exception 'Unknown action %', p_action;
  end if;

  perform 1 from public.vehicles where id = p_vehicle_id for update;
  if not found then
    v_result := 'rejected_not_visible';  v_message := 'Vehicle not found.';
  elsif v_user.role <> 'fleet_ops' then
    v_result := 'rejected_role';  v_message := 'Only Fleet Operations can change a Fleet Review Case.';
  else
    select * into v_frc from public.fleet_review_cases where vehicle_id = p_vehicle_id;

    if p_action = 'close' then
      v_status := p_status;  v_start := v_frc.frc_start;  v_end := coalesce(p_end, v_today);
      if not coalesce(v_frc.is_active, false) then
        v_result := 'rejected_invalid';  v_message := 'There is no active Fleet Review Case to close.';
      end if;
    elsif p_action = 'edit' then
      if v_frc.vehicle_id is null then
        v_result := 'rejected_invalid';  v_message := 'This vehicle has no Fleet Review Case to correct.';
      end if;
      v_status := v_frc.status;  v_start := coalesce(p_start, v_frc.frc_start);
      v_end := case when v_frc.is_active then null else coalesce(p_end, v_frc.frc_end) end;
    else -- record_past
      v_status := p_status;  v_start := p_start;  v_end := p_end;
      if coalesce(v_frc.is_active, false) then
        v_result := 'rejected_active';  v_message := 'The vehicle has an active Fleet Review Case: close it first.';
      elsif p_start is null or p_end is null then
        v_result := 'rejected_invalid';  v_message := 'A past Fleet Review Case needs a start and an end date.';
      end if;
    end if;

    -- Common checks on the resulting values.
    if v_result is null then
      if p_action <> 'edit' and v_status not in ('Review Case Closed – With Action Plan',
            'Review Case Closed – No Action Plan', 'Review Case Aborted', 'Review Case Declined') then
        v_result := 'rejected_invalid';  v_message := 'Choose a closed status: with action plan, no action plan, declined or aborted.';
      elsif v_start > v_today or v_end > v_today then
        v_result := 'rejected_invalid';  v_message := 'Dates cannot be in the future.';
      elsif v_end is not null and v_end < v_start then
        v_result := 'rejected_invalid';  v_message := 'The end date must be on or after the start date.';
      end if;
    end if;

    if v_result is null then
      insert into public.fleet_review_cases (vehicle_id, status, frc_start, frc_end, grace_period_until)
      values (p_vehicle_id, v_status, v_start, v_end, v_end)
      on conflict (vehicle_id) do update
        set status = excluded.status, frc_start = excluded.frc_start,
            frc_end = excluded.frc_end, grace_period_until = excluded.grace_period_until;
      v_result := case p_action when 'close' then 'closed' when 'edit' then 'edited' else 'recorded' end;
      v_message := case p_action
        when 'close' then 'Fleet Review Case closed as ' || replace(v_status, 'Review Case ', '') || ' on ' || v_end::text || '.'
        when 'edit' then 'Fleet Review Case corrected: ' || v_start::text || ' to ' || coalesce(v_end::text, 'open') || '.'
        else 'Past Fleet Review Case recorded: ' || replace(v_status, 'Review Case ', '') || ', ' || v_start::text || ' to ' || v_end::text || '.'
      end;
    end if;
  end if;

  insert into public.frc_actions (request_id, user_id, user_name, user_role, vehicle_id, action, result, message,
                                  previous_status, previous_frc_start, previous_frc_end,
                                  new_status, new_frc_start, new_frc_end)
  values (p_request_id, v_user.user_id, v_user.display_name, v_user.role, p_vehicle_id, p_action, v_result, v_message,
          v_frc.status, v_frc.frc_start, v_frc.frc_end,
          case when v_result in ('closed', 'edited', 'recorded') then v_status end,
          case when v_result in ('closed', 'edited', 'recorded') then v_start end,
          case when v_result in ('closed', 'edited', 'recorded') then v_end end);

  return jsonb_build_object('result', v_result, 'message', v_message, 'repeated', false);
end;
$$;

revoke all on function app.change_fleet_review_case(integer, uuid, text, text, date, date) from public;
grant execute on function app.change_fleet_review_case(integer, uuid, text, text, date, date) to app_reader;

-- migrate:down
drop function if exists app.change_fleet_review_case(integer, uuid, text, text, date, date);
alter table public.frc_actions drop column if exists new_frc_end, drop column if exists new_frc_start,
  drop column if exists new_status, drop column if exists action;
alter table public.frc_actions drop constraint frc_actions_result_check;
alter table public.frc_actions add constraint frc_actions_result_check check (result in ('opened', 'rejected_role',
  'rejected_not_visible', 'rejected_not_critical', 'rejected_active'));
