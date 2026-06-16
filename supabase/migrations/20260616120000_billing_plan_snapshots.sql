-- Snapshot operacional dos planos Stripe usados no onboarding.
-- Stripe continua sendo a fonte de verdade; esta tabela acelera leitura, auditoria e fallback.

create table if not exists public.billing_plan_snapshots (
  id uuid primary key default gen_random_uuid(),
  stripe_product_id text not null,
  stripe_price_id text not null unique,
  lookup_key text,
  plan_key text,
  name text not null,
  description text,
  currency text not null default 'brl',
  interval text,
  interval_count integer,
  billing_scheme text,
  tiers_mode text,
  usage_type text,
  active boolean not null default true,
  self_service boolean not null default true,
  enterprise_threshold integer,
  tiers_json jsonb not null default '[]'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz not null default now(),
  stripe_created_at timestamptz,
  stripe_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_billing_plan_snapshots_active_synced
  on public.billing_plan_snapshots (active, last_synced_at desc);

create index if not exists idx_billing_plan_snapshots_lookup_key
  on public.billing_plan_snapshots (lookup_key)
  where lookup_key is not null;

create index if not exists idx_billing_plan_snapshots_plan_key
  on public.billing_plan_snapshots (plan_key)
  where plan_key is not null;

alter table public.billing_plan_snapshots enable row level security;
