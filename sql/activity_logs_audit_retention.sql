-- Robust clinic audit trail for long-term activity log retention.
-- Run this once in Supabase SQL editor. It is additive and safe to re-run.

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  clinic_id uuid,
  actor_name text,
  title text not null,
  content text not null,
  type text not null default 'management',
  action text not null default 'activity_logged',
  action_type text,
  payload_details text,
  idempotency_key text,
  source text not null default 'app',
  request_path text,
  request_method text,
  ip_address text,
  user_agent text,
  status text not null default 'active',
  timestamp timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.activity_logs add column if not exists user_id uuid;
alter table public.activity_logs add column if not exists clinic_id uuid;
alter table public.activity_logs add column if not exists actor_name text;
alter table public.activity_logs add column if not exists title text;
alter table public.activity_logs add column if not exists content text;
alter table public.activity_logs add column if not exists type text default 'management';
alter table public.activity_logs add column if not exists action text default 'activity_logged';
alter table public.activity_logs add column if not exists action_type text;
alter table public.activity_logs add column if not exists payload_details text;
alter table public.activity_logs add column if not exists idempotency_key text;
alter table public.activity_logs add column if not exists source text default 'app';
alter table public.activity_logs add column if not exists request_path text;
alter table public.activity_logs add column if not exists request_method text;
alter table public.activity_logs add column if not exists ip_address text;
alter table public.activity_logs add column if not exists user_agent text;
alter table public.activity_logs add column if not exists status text default 'active';
alter table public.activity_logs add column if not exists timestamp timestamptz default now();
alter table public.activity_logs add column if not exists created_at timestamptz default now();
alter table public.activity_logs add column if not exists updated_at timestamptz default now();
alter table public.activity_logs add column if not exists deleted_at timestamptz;

update public.activity_logs
set
  title = coalesce(title, action_type, 'Atividade registrada'),
  content = coalesce(content, payload_details, 'Ação registrada no sistema.'),
  type = coalesce(type, 'management'),
  action = coalesce(nullif(action, ''), nullif(action_type, ''), 'activity_logged'),
  status = coalesce(status, 'active'),
  timestamp = coalesce(timestamp, created_at, now()),
  created_at = coalesce(created_at, timestamp, now()),
  updated_at = coalesce(updated_at, timestamp, now())
where title is null
   or content is null
   or type is null
   or action is null
   or action = ''
   or status is null
   or timestamp is null
   or created_at is null
   or updated_at is null;

alter table public.activity_logs alter column title set not null;
alter table public.activity_logs alter column content set not null;
alter table public.activity_logs alter column type set not null;
alter table public.activity_logs alter column action set default 'activity_logged';
alter table public.activity_logs alter column action set not null;
alter table public.activity_logs alter column status set not null;
alter table public.activity_logs alter column timestamp set not null;
alter table public.activity_logs alter column created_at set not null;
alter table public.activity_logs alter column updated_at set not null;

create unique index if not exists activity_logs_idempotency_key_uidx
  on public.activity_logs (idempotency_key)
  where idempotency_key is not null;

create index if not exists activity_logs_clinic_timestamp_idx
  on public.activity_logs (clinic_id, timestamp desc);

create index if not exists activity_logs_user_timestamp_idx
  on public.activity_logs (user_id, timestamp desc);

create index if not exists activity_logs_status_timestamp_idx
  on public.activity_logs (status, timestamp desc);

create index if not exists activity_logs_action_type_timestamp_idx
  on public.activity_logs (action_type, timestamp desc);

create index if not exists activity_logs_action_timestamp_idx
  on public.activity_logs (action, timestamp desc);
