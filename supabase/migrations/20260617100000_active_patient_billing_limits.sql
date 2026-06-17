-- Limites e upgrades explícitos de pacientes ativos.
-- O cadastro pode existir como inativo/pendente, mas ativação faturável acima do limite exige confirmação.

alter table public.clinics
  add column if not exists current_active_patient_limit integer,
  add column if not exists current_active_patient_count integer default 0,
  add column if not exists pending_billing_quantity integer,
  add column if not exists pending_effective_date timestamptz,
  add column if not exists pending_billing_status text,
  add column if not exists pending_billing_requested_at timestamptz,
  add column if not exists pending_billing_requested_by uuid;

alter table public.users
  add column if not exists current_active_patient_limit integer,
  add column if not exists current_active_patient_count integer default 0,
  add column if not exists pending_billing_quantity integer,
  add column if not exists pending_effective_date timestamptz,
  add column if not exists pending_billing_status text,
  add column if not exists pending_billing_requested_at timestamptz,
  add column if not exists pending_billing_requested_by uuid;

create table if not exists public.billing_plan_change_audit_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid,
  user_id uuid,
  stripe_subscription_id text,
  stripe_subscription_item_id text,
  stripe_price_id text,
  previous_limit integer,
  requested_limit integer,
  active_patient_count integer,
  effective_date timestamptz,
  status text not null default 'pending',
  trigger text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_billing_plan_change_audit_logs_clinic_created
  on public.billing_plan_change_audit_logs (clinic_id, created_at desc);

alter table public.billing_plan_change_audit_logs enable row level security;
