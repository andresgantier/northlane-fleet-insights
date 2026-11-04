-- migrate:up
-- Assistant question log and daily usage limits (Phase 4).
-- No personal data: no user id or email, only the role, the depot and a hashed browser-session key.
-- The app role stays read-only on every table; it can only call the two functions below.

create table public.assistant_questions (
  id                bigint generated always as identity primary key,
  asked_at          timestamptz not null default now(),
  session_key       text not null,                 -- sha256 of a random browser cookie
  user_role         text not null check (user_role in ('fleet_ops', 'depot_supervisor')),
  organization_code text,                          -- depot of a supervisor, null for fleet_ops
  question          text not null check (length(question) <= 1000),
  status            text not null check (status in ('ok', 'error', 'rate_limited', 'limit_reached')),
  tools_used        text[] not null default '{}',
  model             text,
  latency_ms        integer,
  error_message     text
);
create index assistant_questions_day_idx on public.assistant_questions (asked_at);
create index assistant_questions_session_idx on public.assistant_questions (session_key, asked_at);

alter table public.assistant_questions enable row level security;
-- No policies: only the owner (and the security definer functions below) can read or write.

-- Questions used today (Europe/Berlin) by this browser session and in total.
-- Rejected attempts (limit_reached) do not count.
create function app.assistant_usage_today(p_session_key text)
returns table (session_count integer, global_count integer)
language sql stable
security definer
set search_path = ''
as $$
  select
    count(*) filter (where q.session_key = p_session_key)::int,
    count(*)::int
  from public.assistant_questions q
  where q.asked_at >= (app.as_of()::timestamp at time zone 'Europe/Berlin')
    and q.status <> 'limit_reached'
$$;

-- Records one question. Role and depot are taken from app_users for the current user,
-- so the app cannot log a different role than the signed-in one.
create function app.log_assistant_question(
  p_session_key   text,
  p_question      text,
  p_status        text,
  p_tools_used    text[],
  p_model         text,
  p_latency_ms    integer,
  p_error_message text
)
returns void
language sql volatile
security definer
set search_path = ''
as $$
  insert into public.assistant_questions
    (session_key, user_role, organization_code, question, status, tools_used, model, latency_ms, error_message)
  select p_session_key, u.role, u.organization_code, left(p_question, 1000), p_status,
         coalesce(p_tools_used, '{}'), p_model, p_latency_ms, left(p_error_message, 500)
  from public.app_users u
  where u.user_id = app.current_user_id()
$$;

revoke all on function app.assistant_usage_today(text) from public;
revoke all on function app.log_assistant_question(text, text, text, text[], text, integer, text) from public;
grant execute on function app.assistant_usage_today(text),
                          app.log_assistant_question(text, text, text, text[], text, integer, text)
  to app_reader;

-- migrate:down
drop function if exists app.log_assistant_question(text, text, text, text[], text, integer, text);
drop function if exists app.assistant_usage_today(text);
drop table if exists public.assistant_questions;
