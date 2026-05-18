-- Billing metered/graduated por paciente ativo.
-- Execute no Supabase SQL editor antes de ativar STRIPE_ACTIVE_PATIENT_PRICE_ID em producao.

alter table public.clinics
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_customer_email text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_subscription_item_id text,
  add column if not exists subscription_status text default 'pending',
  add column if not exists stripe_last_reported_active_patients integer,
  add column if not exists stripe_last_usage_reported_at timestamptz,
  add column if not exists stripe_payment_failed_at timestamptz,
  add column if not exists stripe_access_block_at timestamptz,
  add column if not exists stripe_last_failed_invoice_id text;

alter table public.users
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_customer_email text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_subscription_item_id text,
  add column if not exists stripe_payment_failed_at timestamptz,
  add column if not exists stripe_access_block_at timestamptz,
  add column if not exists stripe_last_failed_invoice_id text;

create index if not exists idx_clinics_stripe_subscription_id
  on public.clinics (stripe_subscription_id);

create index if not exists idx_clinics_stripe_subscription_item_id
  on public.clinics (stripe_subscription_item_id);

create index if not exists idx_clinics_subscription_status
  on public.clinics (subscription_status);
