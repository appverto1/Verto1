create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid,
  user_email text,
  clinic_id text,
  role text,
  subscription jsonb not null,
  updated_at timestamptz not null default now()
);

alter table if exists public.push_subscriptions
  add column if not exists user_email text;

create index if not exists idx_push_subscriptions_user_id
  on public.push_subscriptions (user_id);

create index if not exists idx_push_subscriptions_clinic_id
  on public.push_subscriptions (clinic_id);

create index if not exists idx_push_subscriptions_user_email
  on public.push_subscriptions (lower(user_email));

do $$
begin
  if to_regclass('public.appointments') is not null then
    alter table public.appointments
      add column if not exists status text not null default 'pending';
  end if;
end $$;
