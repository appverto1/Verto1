-- Consolidacao idempotente do billing Stripe por paciente ativo.
-- Nao remove historico legado; apenas adiciona campos usados pelo fluxo oficial.

alter table public.clinics
  add column if not exists stripe_price_id text,
  add column if not exists billing_model text default 'active_patients',
  add column if not exists active_patient_count integer default 0,
  add column if not exists last_billing_sync_at timestamptz,
  add column if not exists billing_sync_status text,
  add column if not exists billing_sync_error text;

alter table public.users
  add column if not exists billing_model text default 'active_patients',
  add column if not exists stripe_price_id text;

create table if not exists public.stripe_webhook_events (
  id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now(),
  status text not null default 'processed',
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.billing_sync_audit_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid,
  billing_model text not null default 'active_patients',
  stripe_subscription_id text,
  stripe_subscription_item_id text,
  stripe_price_id text,
  active_patient_count integer,
  billable_quantity integer,
  trigger text,
  status text not null,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_clinics_billing_model
  on public.clinics (billing_model);

create index if not exists idx_clinics_stripe_price_id
  on public.clinics (stripe_price_id);

create index if not exists idx_billing_sync_audit_logs_clinic_created
  on public.billing_sync_audit_logs (clinic_id, created_at desc);

alter table public.stripe_webhook_events enable row level security;
alter table public.billing_sync_audit_logs enable row level security;
