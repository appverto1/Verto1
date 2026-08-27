-- Verto billing contract bridge for accepted modular/custom capacity offers.
--
-- Goals:
-- 1. persist the commercial capacity snapshot once, when the paid offer is
--    bound to the canonical organization;
-- 2. let the existing active-patient sync queue bill only capacity blocks that
--    exceed the accepted contracted limit;
-- 3. preserve the grace period without creating a second scheduler;
-- 4. keep legacy active-patient billing untouched when no modular contract exists.

begin;

create extension if not exists pgcrypto;

create table if not exists public.organization_billing_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  sales_offer_id uuid not null references public.sales_offers(id) on delete restrict,
  sales_checkout_link_id uuid references public.sales_checkout_links(id) on delete set null,
  stripe_subscription_id text not null,
  stripe_schedule_id text,
  billing_model text not null default 'modular_capacity_v1'
    check (billing_model in ('modular_capacity_v1')),
  status text not null default 'active'
    check (status in ('active', 'suspended', 'cancelled')),

  -- Frozen accepted capacity. This already includes any blocks reserved in the
  -- proposal itself. Runtime expansion starts only above this limit.
  accepted_capacity_limit_patients integer not null
    check (accepted_capacity_limit_patients > 0),
  initial_capacity_blocks integer not null default 0
    check (initial_capacity_blocks >= 0),
  initial_capacity_monthly_cents integer not null default 0
    check (initial_capacity_monthly_cents >= 0),
  block_size_patients integer not null
    check (block_size_patients > 0),
  block_price_cents integer not null
    check (block_price_cents >= 0),
  grace_period_days integer not null default 7
    check (grace_period_days between 0 and 365),
  billing_adjustment text not null default 'next_cycle'
    check (billing_adjustment = 'next_cycle'),
  blocks_clinical_access boolean not null default false
    check (blocks_clinical_access = false),

  -- Only runtime expansion is stored here. It never decreases automatically.
  billed_additional_blocks integer not null default 0
    check (billed_additional_blocks >= 0),
  last_active_patient_count integer not null default 0
    check (last_active_patient_count >= 0),
  overage_started_at timestamptz,
  grace_expires_at timestamptz,
  last_capacity_sync_at timestamptz,
  last_capacity_sync_error text,

  -- Stripe references for the capacity extension. They may be null at contract
  -- creation when the accepted proposal reserved zero extra blocks; the runtime
  -- creates the dedicated capacity Product/Price only if growth requires it.
  capacity_product_id text,
  capacity_subscription_item_id text,
  capacity_price_id text,

  source_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id),
  unique (sales_offer_id),
  unique (stripe_subscription_id)
);

create index if not exists idx_organization_billing_contracts_grace_due
  on public.organization_billing_contracts (grace_expires_at, organization_id)
  where status = 'active' and grace_expires_at is not null;

create index if not exists idx_organization_billing_contracts_subscription
  on public.organization_billing_contracts (stripe_subscription_id)
  where status <> 'cancelled';

alter table public.organization_billing_contracts enable row level security;

revoke all on table public.organization_billing_contracts from public, anon, authenticated;
grant select, insert, update, delete on table public.organization_billing_contracts to service_role;

-- Reuse the canonical active-patient billing queue. This function only wakes a
-- contract whose grace period expired; it does not perform billing itself and
-- never creates a parallel cron/queue.
create or replace function public.enqueue_due_capacity_contract_billing_sync(
  p_trigger text default 'capacity_grace_reconciliation'
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_count integer := 0;
begin
  if to_regclass('public.active_patient_billing_sync_queue') is null then
    return 0;
  end if;

  -- This wake-up RPC deliberately does not recalculate patients. The worker
  -- immediately validates the queued quantity with getBillableActivePatientCount,
  -- which remains the single canonical billing definition. Re-reading the full
  -- patients table every five minutes would duplicate semantics and waste DB I/O.
  with due_contracts as (
    select
      contract.organization_id,
      greatest(0, contract.last_active_patient_count) as active_patient_count
    from public.organization_billing_contracts contract
    where contract.status = 'active'
      and contract.grace_expires_at is not null
      and contract.grace_expires_at <= now()
  ), queued as (
    insert into public.active_patient_billing_sync_queue as queue_row (
      clinic_id,
      desired_active_patient_count,
      queue_version,
      status,
      attempts,
      next_attempt_at,
      locked_at,
      lock_token,
      last_error,
      trigger,
      created_at,
      updated_at
    )
    select
      due_contracts.organization_id,
      due_contracts.active_patient_count,
      1,
      'pending',
      0,
      now(),
      null,
      null,
      null,
      coalesce(nullif(trim(p_trigger), ''), 'capacity_grace_reconciliation'),
      now(),
      now()
    from due_contracts
    on conflict (clinic_id) do update
    set
      -- Increment even if the patient count is unchanged: grace expiry itself is
      -- a new billing fact that must be processed by the existing worker. Do not
      -- disturb a job that is already pending/retrying/processing.
      queue_version = queue_row.queue_version + 1,
      desired_active_patient_count = excluded.desired_active_patient_count,
      status = 'pending',
      attempts = 0,
      next_attempt_at = now(),
      locked_at = null,
      lock_token = null,
      last_error = null,
      trigger = excluded.trigger,
      updated_at = now()
    where queue_row.status = 'succeeded'
    returning clinic_id
  )
  select count(*) into v_count from queued;

  return coalesce(v_count, 0);
end;
$function$;

revoke all on function public.enqueue_due_capacity_contract_billing_sync(text)
  from public, anon, authenticated;
grant execute on function public.enqueue_due_capacity_contract_billing_sync(text)
  to service_role;

notify pgrst, 'reload schema';

commit;
