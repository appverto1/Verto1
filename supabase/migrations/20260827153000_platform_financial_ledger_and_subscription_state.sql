-- Verto platform finance ledger: real Stripe revenue, subscription/trial state and
-- canonical SaaS-client scope for the Super Admin DRE.
--
-- This migration intentionally does NOT touch clinic financial records. It stores
-- only Verto's own commercial subscription facts received from authenticated
-- Stripe webhooks. Patient-level legacy billing is not a source of SaaS revenue.

begin;

create extension if not exists pgcrypto;

create table if not exists public.platform_subscription_financial_state (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.clinics(id) on delete set null,
  sales_offer_id uuid references public.sales_offers(id) on delete set null,
  sales_lead_id uuid references public.sales_leads(id) on delete set null,
  stripe_subscription_id text not null,
  stripe_customer_id text,
  stripe_status text not null,
  trial_start_at timestamptz,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  cancel_at timestamptz,
  canceled_at timestamptz,
  last_invoice_id text,
  last_invoice_status text,
  last_invoice_amount_due_cents integer check (last_invoice_amount_due_cents is null or last_invoice_amount_due_cents >= 0),
  last_invoice_amount_paid_cents integer check (last_invoice_amount_paid_cents is null or last_invoice_amount_paid_cents >= 0),
  first_paid_at timestamptz,
  last_paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stripe_subscription_id)
);

create unique index if not exists ux_platform_subscription_financial_state_organization
  on public.platform_subscription_financial_state(organization_id)
  where organization_id is not null
    and stripe_status not in ('canceled', 'incomplete_expired');

create index if not exists idx_platform_subscription_financial_state_status
  on public.platform_subscription_financial_state(stripe_status, trial_ends_at, organization_id);

create table if not exists public.platform_billing_invoice_ledger (
  id uuid primary key default gen_random_uuid(),
  stripe_invoice_id text not null unique,
  stripe_subscription_id text,
  stripe_customer_id text,
  organization_id uuid references public.clinics(id) on delete set null,
  sales_offer_id uuid references public.sales_offers(id) on delete set null,
  sales_lead_id uuid references public.sales_leads(id) on delete set null,
  status text not null,
  currency text not null default 'brl',
  billing_reason text,
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  total_cents integer not null default 0 check (total_cents >= 0),
  amount_due_cents integer not null default 0 check (amount_due_cents >= 0),
  amount_paid_cents integer not null default 0 check (amount_paid_cents >= 0),
  amount_remaining_cents integer not null default 0 check (amount_remaining_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  period_start timestamptz,
  period_end timestamptz,
  paid_at timestamptz,
  failed_at timestamptz,
  source_event_id text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_platform_billing_invoice_ledger_paid_period
  on public.platform_billing_invoice_ledger(paid_at, organization_id)
  where amount_paid_cents > 0;

create index if not exists idx_platform_billing_invoice_ledger_open
  on public.platform_billing_invoice_ledger(status, organization_id, period_end)
  where amount_remaining_cents > 0;

create index if not exists idx_platform_billing_invoice_ledger_subscription
  on public.platform_billing_invoice_ledger(stripe_subscription_id, created_at desc);

alter table public.platform_subscription_financial_state enable row level security;
alter table public.platform_billing_invoice_ledger enable row level security;

revoke all on table public.platform_subscription_financial_state from public, anon, authenticated;
revoke all on table public.platform_billing_invoice_ledger from public, anon, authenticated;
grant select, insert, update, delete on table public.platform_subscription_financial_state to service_role;
grant select, insert, update, delete on table public.platform_billing_invoice_ledger to service_role;

comment on table public.platform_subscription_financial_state is
  'Server-owned Stripe subscription/trial state for Verto SaaS customers. Patients are never represented as SaaS customers.';
comment on table public.platform_billing_invoice_ledger is
  'Server-owned real Stripe invoice ledger used by the Super Admin DRE. Stores Verto subscription billing only, not clinic/patient financial records.';

-- Retire the obsolete R$ 4,90 patient-subscription projection from local profile
-- data. This does not cancel or mutate any Stripe object; it only removes the
-- stale SaaS-price marker that made patients appear as Verto customers.
update public.users
set plan_price = null,
    plan_name = null,
    updated_at = now()
where lower(coalesce(role::text, '')) = 'patient'
  and plan_price is not null
  and abs(plan_price::numeric - 4.90) < 0.0001;

notify pgrst, 'reload schema';

commit;
