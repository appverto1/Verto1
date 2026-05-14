-- Ensure activity_logs.action exists and is populated before enforcing NOT NULL.

alter table public.activity_logs
  add column if not exists action text default 'activity_logged';

update public.activity_logs
set action = coalesce(nullif(action, ''), nullif(action_type, ''), 'activity_logged')
where action is null or action = '';

alter table public.activity_logs
  alter column action set default 'activity_logged';

alter table public.activity_logs
  alter column action set not null;

create index if not exists activity_logs_action_timestamp_idx
  on public.activity_logs (action, timestamp desc);
