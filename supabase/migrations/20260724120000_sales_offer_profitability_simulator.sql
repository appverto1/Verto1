-- Verto: simulador comercial de rentabilidade e ofertas por simulacao.
-- Migration aditiva e idempotente. Nao altera DRE, assinaturas ou ofertas historicas.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create extension if not exists pgcrypto;

do $guard$
begin
  if to_regclass('public.sales_leads') is null
     or to_regclass('public.sales_offers') is null
     or to_regclass('public.sales_lead_events') is null
     or to_regclass('public.sales_subscription_discounts') is null
     or to_regclass('public.users') is null then
    raise exception 'SALES_COMMERCIAL_CANONICAL_SCHEMA_REQUIRED';
  end if;
end
$guard$;

create table if not exists public.sales_financial_assumption_sets (
  id uuid primary key default gen_random_uuid(),
  version integer not null,
  name text not null,
  effective_at timestamptz not null default now(),
  values jsonb not null default '{}'::jsonb,
  source_metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint sales_financial_assumption_sets_version_positive check (version > 0),
  constraint sales_financial_assumption_sets_name_length check (char_length(name) between 2 and 120),
  constraint sales_financial_assumption_sets_values_object check (jsonb_typeof(values) = 'object'),
  constraint sales_financial_assumption_sets_source_object check (jsonb_typeof(source_metadata) = 'object')
);

create unique index if not exists sales_financial_assumption_sets_version_uidx
  on public.sales_financial_assumption_sets (version);
create index if not exists sales_financial_assumption_sets_effective_idx
  on public.sales_financial_assumption_sets (effective_at desc, version desc);

create table if not exists public.sales_offer_simulations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.sales_leads(id) on delete restrict,
  created_by uuid not null references public.users(id) on delete restrict,
  status text not null default 'saved',
  assumption_set_id uuid not null references public.sales_financial_assumption_sets(id) on delete restrict,
  model_version text not null,
  initial_active_patient_quantity integer not null,
  base_unit_amount_cents integer not null,
  currency text not null default 'BRL',
  discount_type text not null default 'none',
  discount_percentage numeric(7,4),
  discount_duration_months integer,
  offer_validity_days integer not null default 14,
  usage_profile text not null default 'standard',
  custom_monthly_cost_cents integer not null default 0,
  onboarding_cost_cents integer not null default 0,
  assumptions_snapshot jsonb not null,
  results_snapshot jsonb not null,
  profitability_rating text not null,
  internal_justification text,
  internal_notes text,
  idempotency_key text not null,
  selected_for_offer_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint sales_offer_simulations_status_check check (
    status in ('saved', 'selected', 'offered', 'archived')
  ),
  constraint sales_offer_simulations_quantity_check check (
    initial_active_patient_quantity between 1 and 100000
  ),
  constraint sales_offer_simulations_amount_check check (
    base_unit_amount_cents > 0
    and custom_monthly_cost_cents >= 0
    and onboarding_cost_cents >= 0
  ),
  constraint sales_offer_simulations_discount_type_check check (
    discount_type in ('none', 'coupon')
  ),
  constraint sales_offer_simulations_discount_check check (
    (
      discount_type = 'none'
      and coalesce(discount_percentage, 0) = 0
      and discount_duration_months is null
    )
    or (
      discount_type = 'coupon'
      and discount_percentage > 0
      and discount_percentage <= 100
      and discount_duration_months between 1 and 36
    )
  ),
  constraint sales_offer_simulations_validity_check check (
    offer_validity_days between 1 and 90
  ),
  constraint sales_offer_simulations_usage_profile_check check (
    usage_profile in ('light', 'standard', 'intensive', 'custom')
  ),
  constraint sales_offer_simulations_rating_check check (
    profitability_rating in ('healthy', 'attention', 'not_recommended', 'insufficient_data')
  ),
  constraint sales_offer_simulations_snapshot_check check (
    jsonb_typeof(assumptions_snapshot) = 'object'
    and jsonb_typeof(results_snapshot) = 'object'
  ),
  constraint sales_offer_simulations_idempotency_length check (
    char_length(idempotency_key) between 12 and 240
  ),
  constraint sales_offer_simulations_justification_length check (
    internal_justification is null or char_length(internal_justification) <= 1500
  ),
  constraint sales_offer_simulations_notes_length check (
    internal_notes is null or char_length(internal_notes) <= 2000
  )
);

create unique index if not exists sales_offer_simulations_creator_idempotency_uidx
  on public.sales_offer_simulations (created_by, idempotency_key);
create index if not exists sales_offer_simulations_lead_created_idx
  on public.sales_offer_simulations (lead_id, created_at desc)
  where deleted_at is null;
create index if not exists sales_offer_simulations_assumption_idx
  on public.sales_offer_simulations (assumption_set_id, created_at desc)
  where deleted_at is null;

alter table public.sales_offers
  add column if not exists simulation_id uuid,
  add column if not exists simulation_snapshot jsonb,
  add column if not exists promotional_unit_amount_cents integer,
  add column if not exists promotional_monthly_amount_cents integer,
  add column if not exists post_discount_monthly_amount_cents integer,
  add column if not exists internal_justification text;

do $offer_fk$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.sales_offers'::regclass
       and conname = 'sales_offers_simulation_id_fkey'
  ) then
    alter table public.sales_offers
      add constraint sales_offers_simulation_id_fkey
      foreign key (simulation_id)
      references public.sales_offer_simulations(id)
      on delete restrict;
  end if;
end
$offer_fk$;

create unique index if not exists sales_offers_simulation_uidx
  on public.sales_offers (simulation_id)
  where simulation_id is not null;

do $drop_legacy_duration_constraints$
declare
  constraint_name text;
begin
  foreach constraint_name in array array[
    'sales_offers_discount_duration',
    'sales_offers_discount_duration_check'
  ] loop
    if exists (
      select 1
        from pg_constraint
       where conrelid = 'public.sales_offers'::regclass
         and conname = constraint_name
    ) then
      execute format(
        'alter table public.sales_offers drop constraint %I',
        constraint_name
      );
    end if;
  end loop;

  if exists (
    select 1
      from pg_constraint
     where conrelid = 'public.sales_subscription_discounts'::regclass
       and conname = 'sales_subscription_discounts_duration'
  ) then
    alter table public.sales_subscription_discounts
      drop constraint sales_subscription_discounts_duration;
  end if;
end
$drop_legacy_duration_constraints$;

do $new_duration_constraints$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.sales_offers'::regclass
       and conname = 'sales_offers_discount_duration_v2_check'
  ) then
    alter table public.sales_offers
      add constraint sales_offers_discount_duration_v2_check check (
        (
          discount_type = 'none'
          and discount_duration_months is null
          and coalesce(discount_percentage, 0) = 0
        )
        or (
          discount_type = 'coupon'
          and discount_duration_months between 1 and 36
          and (
            discount_percentage is null
            or discount_percentage > 0
          )
          and (
            discount_percentage is null
            or discount_percentage <= 100
          )
        )
      ) not valid;
    alter table public.sales_offers
      validate constraint sales_offers_discount_duration_v2_check;
  end if;

  if to_regclass('public.sales_subscription_discounts') is not null
     and not exists (
       select 1
         from pg_constraint
        where conrelid = 'public.sales_subscription_discounts'::regclass
          and conname = 'sales_subscription_discounts_duration_v2_check'
     ) then
    alter table public.sales_subscription_discounts
      add constraint sales_subscription_discounts_duration_v2_check check (
        discount_duration_months is null
        or discount_duration_months between 1 and 36
      ) not valid;
    alter table public.sales_subscription_discounts
      validate constraint sales_subscription_discounts_duration_v2_check;
  end if;
end
$new_duration_constraints$;

create or replace function public.create_sales_financial_assumption_set(
  p_name text,
  p_values jsonb,
  p_source_metadata jsonb,
  p_created_by uuid
)
returns public.sales_financial_assumption_sets
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  created_row public.sales_financial_assumption_sets%rowtype;
  next_version integer;
begin
  if p_created_by is null
     or nullif(btrim(p_name), '') is null
     or jsonb_typeof(coalesce(p_values, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_source_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'SALES_ASSUMPTION_INPUT_INVALID' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('sales-financial-assumption-version', 0)
  );

  select coalesce(max(version), 0) + 1
    into next_version
    from public.sales_financial_assumption_sets;

  insert into public.sales_financial_assumption_sets (
    version,
    name,
    effective_at,
    values,
    source_metadata,
    created_by
  ) values (
    next_version,
    left(btrim(p_name), 120),
    now(),
    coalesce(p_values, '{}'::jsonb),
    coalesce(p_source_metadata, '{}'::jsonb),
    p_created_by
  )
  returning * into created_row;

  return created_row;
end
$function$;

revoke all on function public.create_sales_financial_assumption_set(
  text, jsonb, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.create_sales_financial_assumption_set(
  text, jsonb, jsonb, uuid
) to service_role;

alter table public.sales_financial_assumption_sets enable row level security;
alter table public.sales_offer_simulations enable row level security;

revoke all on public.sales_financial_assumption_sets from anon, authenticated;
revoke all on public.sales_offer_simulations from anon, authenticated;
grant all on public.sales_financial_assumption_sets to service_role;
grant all on public.sales_offer_simulations to service_role;

comment on table public.sales_financial_assumption_sets is
  'Versioned internal assumptions used only by the owner profitability simulator.';
comment on table public.sales_offer_simulations is
  'Immutable commercial profitability snapshots. These rows never feed realized DRE.';
comment on column public.sales_offers.simulation_snapshot is
  'Frozen commercial snapshot copied when an owner prepares an offer. Never exposed publicly.';

notify pgrst, 'reload schema';

commit;
