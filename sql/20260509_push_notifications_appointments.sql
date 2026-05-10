create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid,
  clinic_id text,
  role text,
  subscription jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user_id
  on public.push_subscriptions (user_id);

create index if not exists idx_push_subscriptions_clinic_id
  on public.push_subscriptions (clinic_id);

do $$
begin
  if to_regclass('public.appointments') is not null then
    alter table public.appointments
      add column if not exists status text not null default 'pending';
  end if;
end $$;
