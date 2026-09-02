-- Custos recorrentes da clínica: uma regra persistida, projeções mensais calculadas na leitura.

create extension if not exists pgcrypto;

create table if not exists public.clinic_recurring_costs (
  id uuid primary key default gen_random_uuid(),
  clinic_id text not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  amount numeric(14,2) not null check (amount > 0 and amount <= 10000000),
  recurrence text not null check (recurrence in ('weekly', 'monthly')),
  starts_on date not null default current_date,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_clinic_recurring_costs_active_period
  on public.clinic_recurring_costs (clinic_id, active, starts_on);

alter table public.clinic_recurring_costs enable row level security;

drop policy if exists clinic_recurring_costs_select on public.clinic_recurring_costs;
create policy clinic_recurring_costs_select
on public.clinic_recurring_costs
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (
        u.clinic_id::text = clinic_recurring_costs.clinic_id
        or u.id::text = clinic_recurring_costs.clinic_id
      )
  )
);

drop policy if exists clinic_recurring_costs_insert on public.clinic_recurring_costs;
create policy clinic_recurring_costs_insert
on public.clinic_recurring_costs
for insert
to authenticated
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (
        u.clinic_id::text = clinic_recurring_costs.clinic_id
        or u.id::text = clinic_recurring_costs.clinic_id
      )
  )
);

revoke all on table public.clinic_recurring_costs from public, anon;
grant select, insert on table public.clinic_recurring_costs to authenticated;
grant all on table public.clinic_recurring_costs to service_role;

comment on table public.clinic_recurring_costs is
  'Regras de custos semanais ou mensais da clínica; não materializa lançamentos futuros.';
