-- ABA configurable prompt/help types.
-- Additive only: keeps legacy aba_prompt_levels and historical ABA events intact.

create extension if not exists pgcrypto;

create table if not exists public.aba_prompt_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  key text not null,
  name text not null,
  category text not null default 'Geral',
  independence_score numeric(5,2) not null default 0
    check (independence_score >= 0 and independence_score <= 100),
  intrusiveness_order integer not null default 0,
  counts_as_independent boolean not null default false,
  show_in_session boolean not null default true,
  active boolean not null default true,
  description text,
  is_system_default boolean not null default false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_aba_prompt_types_org_order
  on public.aba_prompt_types (organization_id, active, show_in_session, intrusiveness_order);

create unique index if not exists ux_aba_prompt_types_org_active_name
  on public.aba_prompt_types (organization_id, lower(name))
  where active = true;

alter table public.aba_trials
  add column if not exists prompt_type_id uuid references public.aba_prompt_types(id) on delete set null,
  add column if not exists prompt_type_name_snapshot text,
  add column if not exists prompt_category_snapshot text,
  add column if not exists prompt_independence_score_snapshot numeric(5,2),
  add column if not exists prompt_intrusiveness_order_snapshot integer;

alter table public.aba_maintenance_probe_results
  add column if not exists prompt_type_id uuid references public.aba_prompt_types(id) on delete set null,
  add column if not exists prompt_type_name_snapshot text,
  add column if not exists prompt_category_snapshot text,
  add column if not exists prompt_independence_score_snapshot numeric(5,2),
  add column if not exists prompt_intrusiveness_order_snapshot integer;

create index if not exists idx_aba_trials_prompt_type
  on public.aba_trials (clinic_id, prompt_type_id, occurred_at desc)
  where prompt_type_id is not null;

create index if not exists idx_aba_maintenance_probe_results_prompt_type
  on public.aba_maintenance_probe_results (organization_id, prompt_type_id, occurred_at desc)
  where prompt_type_id is not null;

alter table public.aba_prompt_types enable row level security;

drop policy if exists aba_prompt_types_clinic_read on public.aba_prompt_types;
create policy aba_prompt_types_clinic_read
on public.aba_prompt_types
for select
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or u.clinic_id::text = aba_prompt_types.organization_id::text
      )
  )
);

drop policy if exists aba_prompt_types_clinic_write on public.aba_prompt_types;
create policy aba_prompt_types_clinic_write
on public.aba_prompt_types
for all
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or (
          u.role = 'coordinator'
          and u.clinic_id::text = aba_prompt_types.organization_id::text
        )
      )
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or (
          u.role = 'coordinator'
          and u.clinic_id::text = aba_prompt_types.organization_id::text
        )
      )
  )
);
