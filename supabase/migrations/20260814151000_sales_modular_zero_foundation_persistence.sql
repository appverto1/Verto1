-- Allow a zero-priced Fundação Verto only for modular commercial snapshots.
--
-- Context:
-- 20260804010000 made platform_foundation the canonical base line for modular
-- proposals and intentionally allows manual pricing of R$ 0,00. The legacy
-- constraints on sales_offer_simulations.base_unit_amount_cents and
-- sales_offers.base_unit_amount_cents still required values > 0, causing a
-- valid modular proposal with Fundação Verto = R$ 0,00 to fail while saving
-- the scenario (and later while publishing the offer).
--
-- This migration does not modify historical rows, snapshots, catalog values,
-- Stripe data, offers, leads, or proposal calculations. It only scopes the
-- existing positive-value invariant correctly:
--   * legacy rows remain strictly > 0;
--   * modular rows may persist the canonical Fundação Verto amount >= 0.

begin;

do $schema_guard$
begin
  if to_regclass('public.sales_offer_simulations') is null
     or to_regclass('public.sales_offers') is null then
    raise exception 'SALES_MODULAR_SCHEMA_PENDING'
      using detail = 'Apply the commercial proposal schema before this migration';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'sales_offer_simulations'
       and column_name = 'simulation_type'
  ) or not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'sales_offers'
       and column_name = 'offer_type'
  ) then
    raise exception 'SALES_MODULAR_SCHEMA_PENDING'
      using detail = 'simulation_type/offer_type are required for modular-aware amount constraints';
  end if;
end;
$schema_guard$;

-- The original simulator constraint predates modular Fundação Verto pricing.
alter table public.sales_offer_simulations
  drop constraint if exists sales_offer_simulations_amount_check;

alter table public.sales_offer_simulations
  add constraint sales_offer_simulations_amount_check
  check (
    custom_monthly_cost_cents >= 0
    and onboarding_cost_cents >= 0
    and (
      (simulation_type = 'modular' and base_unit_amount_cents >= 0)
      or
      (simulation_type <> 'modular' and base_unit_amount_cents > 0)
    )
  ) not valid;

alter table public.sales_offer_simulations
  validate constraint sales_offer_simulations_amount_check;

-- Two historical migrations used different names for the same legacy > 0
-- invariant. Drop both defensively so an installation that has either (or
-- both) cannot continue rejecting valid modular zero-foundation offers.
alter table public.sales_offers
  drop constraint if exists sales_offers_base_amount_check;

alter table public.sales_offers
  drop constraint if exists sales_offers_amount_positive;

alter table public.sales_offers
  add constraint sales_offers_base_amount_check
  check (
    (offer_type = 'modular' and base_unit_amount_cents >= 0)
    or
    (offer_type <> 'modular' and base_unit_amount_cents > 0)
  ) not valid;

alter table public.sales_offers
  validate constraint sales_offers_base_amount_check;

-- Fail the migration rather than silently widening legacy pricing semantics.
do $verification$
declare
  simulation_constraint text;
  offer_constraint text;
begin
  select pg_get_constraintdef(oid)
    into simulation_constraint
    from pg_constraint
   where conrelid = 'public.sales_offer_simulations'::regclass
     and conname = 'sales_offer_simulations_amount_check';

  select pg_get_constraintdef(oid)
    into offer_constraint
    from pg_constraint
   where conrelid = 'public.sales_offers'::regclass
     and conname = 'sales_offers_base_amount_check';

  if simulation_constraint is null
     or position('simulation_type' in simulation_constraint) = 0
     or position('base_unit_amount_cents >= 0' in simulation_constraint) = 0
     or position('base_unit_amount_cents > 0' in simulation_constraint) = 0 then
    raise exception 'SALES_MODULAR_SIMULATION_AMOUNT_CONSTRAINT_INVALID';
  end if;

  if offer_constraint is null
     or position('offer_type' in offer_constraint) = 0
     or position('base_unit_amount_cents >= 0' in offer_constraint) = 0
     or position('base_unit_amount_cents > 0' in offer_constraint) = 0 then
    raise exception 'SALES_MODULAR_OFFER_AMOUNT_CONSTRAINT_INVALID';
  end if;
end;
$verification$;

notify pgrst, 'reload schema';

commit;

select
  exists (
    select 1
      from pg_constraint
     where conrelid = 'public.sales_offer_simulations'::regclass
       and conname = 'sales_offer_simulations_amount_check'
       and pg_get_constraintdef(oid) like '%simulation_type%'
       and pg_get_constraintdef(oid) like '%base_unit_amount_cents >= 0%'
       and pg_get_constraintdef(oid) like '%base_unit_amount_cents > 0%'
  ) as modular_simulation_zero_foundation_ready,
  exists (
    select 1
      from pg_constraint
     where conrelid = 'public.sales_offers'::regclass
       and conname = 'sales_offers_base_amount_check'
       and pg_get_constraintdef(oid) like '%offer_type%'
       and pg_get_constraintdef(oid) like '%base_unit_amount_cents >= 0%'
       and pg_get_constraintdef(oid) like '%base_unit_amount_cents > 0%'
  ) as modular_offer_zero_foundation_ready;
