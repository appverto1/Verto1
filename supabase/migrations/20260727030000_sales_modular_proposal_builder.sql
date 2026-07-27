-- Verto: construtor modular de propostas e rentabilidade por funcionalidade.
-- Migration aditiva, idempotente e transacional. Nao altera cobranca, assinatura ou DRE realizada.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $guard$
begin
  if to_regclass('public.users') is null
     or to_regclass('public.sales_leads') is null
     or to_regclass('public.sales_offers') is null
     or to_regclass('public.sales_offer_simulations') is null
     or to_regclass('public.sales_financial_assumption_sets') is null
     or to_regclass('public.sales_lead_events') is null then
    raise exception 'SALES_PROFITABILITY_CANONICAL_SCHEMA_REQUIRED';
  end if;
end
$guard$;

create table if not exists public.sales_pricing_catalog_versions (
  id uuid primary key default gen_random_uuid(),
  version integer not null,
  name text not null,
  status text not null default 'draft',
  effective_at timestamptz not null default now(),
  allocation_settings jsonb not null default '{}'::jsonb,
  admin_notes text,
  catalog_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  published_by uuid references public.users(id) on delete restrict,
  published_at timestamptz,
  archived_at timestamptz,
  constraint sales_pricing_catalog_versions_version_positive check (version > 0),
  constraint sales_pricing_catalog_versions_name_length check (char_length(name) between 2 and 120),
  constraint sales_pricing_catalog_versions_status_check check (status in ('draft', 'active', 'archived')),
  constraint sales_pricing_catalog_versions_allocation_object check (jsonb_typeof(allocation_settings) = 'object'),
  constraint sales_pricing_catalog_versions_snapshot_object check (jsonb_typeof(catalog_snapshot) = 'object'),
  constraint sales_pricing_catalog_versions_notes_length check (admin_notes is null or char_length(admin_notes) <= 2000)
);

create unique index if not exists sales_pricing_catalog_versions_version_uidx
  on public.sales_pricing_catalog_versions (version);
create unique index if not exists sales_pricing_catalog_versions_single_active_uidx
  on public.sales_pricing_catalog_versions ((status))
  where status = 'active';
create index if not exists sales_pricing_catalog_versions_status_idx
  on public.sales_pricing_catalog_versions (status, effective_at desc, version desc);

create table if not exists public.sales_pricing_catalog_items (
  id uuid primary key default gen_random_uuid(),
  catalog_version_id uuid not null references public.sales_pricing_catalog_versions(id) on delete restrict,
  item_key text not null,
  public_name text not null,
  internal_name text not null,
  public_description text not null,
  pricing_mode text not null,
  billing_interval text not null,
  unit_name text not null,
  included_quantity integer,
  maximum_quantity integer,
  recurring_amount_cents integer,
  one_time_amount_cents integer,
  sort_order integer not null default 0,
  is_required boolean not null default false,
  is_public boolean not null default true,
  is_active boolean not null default true,
  compatible_base_packages jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint sales_pricing_catalog_items_key_length check (char_length(item_key) between 2 and 80),
  constraint sales_pricing_catalog_items_public_name_length check (char_length(public_name) between 2 and 120),
  constraint sales_pricing_catalog_items_internal_name_length check (char_length(internal_name) between 2 and 160),
  constraint sales_pricing_catalog_items_description_length check (char_length(public_description) between 2 and 4000),
  constraint sales_pricing_catalog_items_pricing_mode_check check (
    pricing_mode in ('package_limit', 'flat_monthly', 'usage_tier', 'storage_block', 'one_time', 'custom')
  ),
  constraint sales_pricing_catalog_items_billing_interval_check check (
    billing_interval in ('monthly', 'one_time', 'custom')
  ),
  constraint sales_pricing_catalog_items_quantities_check check (
    coalesce(included_quantity, 0) >= 0
    and coalesce(maximum_quantity, 0) >= 0
  ),
  constraint sales_pricing_catalog_items_amounts_check check (
    coalesce(recurring_amount_cents, 0) >= 0
    and coalesce(one_time_amount_cents, 0) >= 0
  ),
  constraint sales_pricing_catalog_items_compatibility_array check (jsonb_typeof(compatible_base_packages) = 'array'),
  constraint sales_pricing_catalog_items_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists sales_pricing_catalog_items_version_key_uidx
  on public.sales_pricing_catalog_items (catalog_version_id, item_key);
create index if not exists sales_pricing_catalog_items_version_sort_idx
  on public.sales_pricing_catalog_items (catalog_version_id, sort_order, item_key);

create table if not exists public.sales_pricing_catalog_tiers (
  id uuid primary key default gen_random_uuid(),
  catalog_version_id uuid not null references public.sales_pricing_catalog_versions(id) on delete restrict,
  catalog_item_id uuid not null references public.sales_pricing_catalog_items(id) on delete restrict,
  tier_key text not null,
  public_name text not null,
  minimum_quantity integer not null default 1,
  maximum_quantity integer,
  included_quantity integer,
  recurring_amount_cents integer,
  one_time_amount_cents integer,
  sort_order integer not null default 0,
  is_custom boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint sales_pricing_catalog_tiers_key_length check (char_length(tier_key) between 2 and 80),
  constraint sales_pricing_catalog_tiers_name_length check (char_length(public_name) between 2 and 120),
  constraint sales_pricing_catalog_tiers_quantity_check check (
    minimum_quantity >= 0
    and (maximum_quantity is null or maximum_quantity >= minimum_quantity)
    and coalesce(included_quantity, 0) >= 0
  ),
  constraint sales_pricing_catalog_tiers_amount_check check (
    coalesce(recurring_amount_cents, 0) >= 0
    and coalesce(one_time_amount_cents, 0) >= 0
  ),
  constraint sales_pricing_catalog_tiers_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists sales_pricing_catalog_tiers_item_key_uidx
  on public.sales_pricing_catalog_tiers (catalog_item_id, tier_key);
create index if not exists sales_pricing_catalog_tiers_version_item_idx
  on public.sales_pricing_catalog_tiers (catalog_version_id, catalog_item_id, sort_order);

create table if not exists public.sales_pricing_item_cost_models (
  id uuid primary key default gen_random_uuid(),
  catalog_version_id uuid not null references public.sales_pricing_catalog_versions(id) on delete restrict,
  catalog_item_id uuid not null references public.sales_pricing_catalog_items(id) on delete restrict,
  version integer not null,
  direct_fixed_monthly_cost_cents integer,
  direct_cost_per_patient_cents integer,
  direct_cost_per_clinic_cents integer,
  direct_cost_per_usage_unit_cents integer,
  storage_cost_per_gb_cents integer,
  egress_cost_per_gb_cents integer,
  notification_cost_per_unit_cents integer,
  processing_cost_per_unit_cents integer,
  support_fixed_monthly_cost_cents integer,
  support_cost_per_patient_cents integer,
  operational_fixed_monthly_cost_cents integer,
  onboarding_cost_cents integer,
  shared_cost_allocation_weight numeric(12,4) not null default 1,
  cost_source text not null default 'unavailable',
  source_detail text not null default 'Custo ainda nao informado.',
  effective_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint sales_pricing_item_cost_models_version_positive check (version > 0),
  constraint sales_pricing_item_cost_models_non_negative check (
    coalesce(direct_fixed_monthly_cost_cents, 0) >= 0
    and coalesce(direct_cost_per_patient_cents, 0) >= 0
    and coalesce(direct_cost_per_clinic_cents, 0) >= 0
    and coalesce(direct_cost_per_usage_unit_cents, 0) >= 0
    and coalesce(storage_cost_per_gb_cents, 0) >= 0
    and coalesce(egress_cost_per_gb_cents, 0) >= 0
    and coalesce(notification_cost_per_unit_cents, 0) >= 0
    and coalesce(processing_cost_per_unit_cents, 0) >= 0
    and coalesce(support_fixed_monthly_cost_cents, 0) >= 0
    and coalesce(support_cost_per_patient_cents, 0) >= 0
    and coalesce(operational_fixed_monthly_cost_cents, 0) >= 0
    and coalesce(onboarding_cost_cents, 0) >= 0
    and shared_cost_allocation_weight >= 0
  ),
  constraint sales_pricing_item_cost_models_source_check check (
    cost_source in ('actual', 'calculated', 'estimated', 'manual', 'unavailable')
  ),
  constraint sales_pricing_item_cost_models_detail_length check (char_length(source_detail) between 2 and 500)
);

create unique index if not exists sales_pricing_item_cost_models_item_version_uidx
  on public.sales_pricing_item_cost_models (catalog_item_id, version);
create index if not exists sales_pricing_item_cost_models_latest_idx
  on public.sales_pricing_item_cost_models (catalog_version_id, catalog_item_id, version desc);

create table if not exists public.sales_pricing_catalog_audit_events (
  id uuid primary key default gen_random_uuid(),
  catalog_version_id uuid not null references public.sales_pricing_catalog_versions(id) on delete restrict,
  catalog_item_id uuid references public.sales_pricing_catalog_items(id) on delete restrict,
  event_type text not null,
  actor_user_id uuid references public.users(id) on delete restrict,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint sales_pricing_catalog_audit_event_type_length check (char_length(event_type) between 2 and 80),
  constraint sales_pricing_catalog_audit_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint sales_pricing_catalog_audit_idempotency_length check (char_length(idempotency_key) between 12 and 240)
);

create unique index if not exists sales_pricing_catalog_audit_idempotency_uidx
  on public.sales_pricing_catalog_audit_events (idempotency_key);
create index if not exists sales_pricing_catalog_audit_version_created_idx
  on public.sales_pricing_catalog_audit_events (catalog_version_id, created_at desc);

alter table public.sales_offer_simulations
  add column if not exists simulation_type text not null default 'legacy',
  add column if not exists scenario_name text,
  add column if not exists catalog_version_id uuid,
  add column if not exists request_hash text,
  add column if not exists modular_input_snapshot jsonb,
  add column if not exists public_notes text;

do $simulation_constraints$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.sales_offer_simulations'::regclass
       and conname = 'sales_offer_simulations_catalog_version_id_fkey'
  ) then
    alter table public.sales_offer_simulations
      add constraint sales_offer_simulations_catalog_version_id_fkey
      foreign key (catalog_version_id)
      references public.sales_pricing_catalog_versions(id)
      on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.sales_offer_simulations'::regclass
       and conname = 'sales_offer_simulations_type_v1_check'
  ) then
    alter table public.sales_offer_simulations
      add constraint sales_offer_simulations_type_v1_check
      check (simulation_type in ('legacy', 'modular')) not valid;
    alter table public.sales_offer_simulations
      validate constraint sales_offer_simulations_type_v1_check;
  end if;
end
$simulation_constraints$;

create index if not exists sales_offer_simulations_catalog_idx
  on public.sales_offer_simulations (catalog_version_id, created_at desc)
  where simulation_type = 'modular' and deleted_at is null;

create table if not exists public.sales_offer_simulation_items (
  id uuid primary key default gen_random_uuid(),
  simulation_id uuid not null references public.sales_offer_simulations(id) on delete restrict,
  catalog_version_id uuid not null references public.sales_pricing_catalog_versions(id) on delete restrict,
  catalog_item_id uuid not null references public.sales_pricing_catalog_items(id) on delete restrict,
  tier_id uuid references public.sales_pricing_catalog_tiers(id) on delete restrict,
  item_key text not null,
  public_name_snapshot text not null,
  public_description_snapshot text not null,
  pricing_mode_snapshot text not null,
  quantity integer not null,
  limit_quantity integer,
  included_quantity integer,
  gross_recurring_amount_cents integer not null,
  recurring_amount_cents integer not null,
  post_promotion_recurring_amount_cents integer not null,
  one_time_amount_cents integer not null,
  item_discount_basis_points integer not null default 0,
  item_discount_cents integer not null default 0,
  allocated_global_discount_cents integer not null default 0,
  direct_cost_cents integer,
  transaction_tax_cost_allocated_cents integer,
  shared_cost_allocated_cents integer,
  contribution_margin_cents integer,
  contribution_margin_basis_points integer,
  ebitda_cents integer,
  ebitda_margin_basis_points integer,
  below_ebitda_cost_allocated_cents integer,
  profit_tax_allocated_cents integer,
  net_income_cents integer,
  net_margin_basis_points integer,
  cost_source text not null,
  cost_model_snapshot jsonb,
  result_snapshot jsonb not null,
  public_metadata jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint sales_offer_simulation_items_quantity_check check (quantity >= 1),
  constraint sales_offer_simulation_items_amounts_check check (
    gross_recurring_amount_cents >= 0
    and recurring_amount_cents >= 0
    and post_promotion_recurring_amount_cents >= 0
    and one_time_amount_cents >= 0
    and item_discount_basis_points between 0 and 10000
    and item_discount_cents >= 0
    and allocated_global_discount_cents >= 0
  ),
  constraint sales_offer_simulation_items_cost_source_check check (
    cost_source in ('actual', 'calculated', 'estimated', 'manual', 'unavailable')
  ),
  constraint sales_offer_simulation_items_result_object check (jsonb_typeof(result_snapshot) = 'object'),
  constraint sales_offer_simulation_items_public_object check (jsonb_typeof(public_metadata) = 'object')
);

create unique index if not exists sales_offer_simulation_items_line_uidx
  on public.sales_offer_simulation_items (simulation_id, item_key, coalesce(tier_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists sales_offer_simulation_items_catalog_idx
  on public.sales_offer_simulation_items (catalog_version_id, catalog_item_id, created_at desc);

alter table public.sales_offers
  add column if not exists offer_type text not null default 'legacy',
  add column if not exists catalog_version_id uuid,
  add column if not exists proposal_name text,
  add column if not exists public_notes text,
  add column if not exists modular_checkout_enabled boolean not null default false,
  add column if not exists modular_snapshot jsonb,
  add column if not exists request_hash text;

do $offer_constraints$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.sales_offers'::regclass
       and conname = 'sales_offers_catalog_version_id_fkey'
  ) then
    alter table public.sales_offers
      add constraint sales_offers_catalog_version_id_fkey
      foreign key (catalog_version_id)
      references public.sales_pricing_catalog_versions(id)
      on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.sales_offers'::regclass
       and conname = 'sales_offers_type_v1_check'
  ) then
    alter table public.sales_offers
      add constraint sales_offers_type_v1_check
      check (offer_type in ('legacy', 'modular')) not valid;
    alter table public.sales_offers validate constraint sales_offers_type_v1_check;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.sales_offers'::regclass
       and conname = 'sales_offers_modular_checkout_disabled_check'
  ) then
    alter table public.sales_offers
      add constraint sales_offers_modular_checkout_disabled_check
      check (offer_type <> 'modular' or modular_checkout_enabled = false) not valid;
    alter table public.sales_offers validate constraint sales_offers_modular_checkout_disabled_check;
  end if;
end
$offer_constraints$;

create table if not exists public.sales_offer_items (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.sales_offers(id) on delete restrict,
  simulation_item_id uuid not null references public.sales_offer_simulation_items(id) on delete restrict,
  catalog_version_id uuid not null references public.sales_pricing_catalog_versions(id) on delete restrict,
  catalog_item_id uuid not null references public.sales_pricing_catalog_items(id) on delete restrict,
  tier_id uuid references public.sales_pricing_catalog_tiers(id) on delete restrict,
  item_key text not null,
  public_name_snapshot text not null,
  public_description_snapshot text not null,
  pricing_mode_snapshot text not null,
  quantity integer not null,
  limit_quantity integer,
  included_quantity integer,
  gross_recurring_amount_cents integer not null,
  recurring_amount_cents integer not null,
  post_promotion_recurring_amount_cents integer not null,
  one_time_amount_cents integer not null,
  item_discount_basis_points integer not null default 0,
  allocated_global_discount_cents integer not null default 0,
  public_metadata jsonb not null default '{}'::jsonb,
  internal_result_snapshot jsonb not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint sales_offer_items_quantity_check check (quantity >= 1),
  constraint sales_offer_items_amounts_check check (
    gross_recurring_amount_cents >= 0
    and recurring_amount_cents >= 0
    and post_promotion_recurring_amount_cents >= 0
    and one_time_amount_cents >= 0
    and item_discount_basis_points between 0 and 10000
    and allocated_global_discount_cents >= 0
  ),
  constraint sales_offer_items_public_object check (jsonb_typeof(public_metadata) = 'object'),
  constraint sales_offer_items_internal_object check (jsonb_typeof(internal_result_snapshot) = 'object')
);

create unique index if not exists sales_offer_items_simulation_item_uidx
  on public.sales_offer_items (offer_id, simulation_item_id);
create index if not exists sales_offer_items_catalog_idx
  on public.sales_offer_items (catalog_version_id, catalog_item_id, created_at desc);

create or replace function public.prevent_sales_modular_snapshot_mutation_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'SALES_MODULAR_SNAPSHOT_IMMUTABLE' using errcode = '55000';
end
$function$;

create or replace function public.protect_sales_modular_simulation_financials_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' and old.simulation_type = 'modular' then
    raise exception 'SALES_MODULAR_SIMULATION_IMMUTABLE' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE'
     and (
       new.simulation_type is distinct from old.simulation_type
       or (
         old.simulation_type = 'modular'
         and (
       new.lead_id is distinct from old.lead_id
       or new.created_by is distinct from old.created_by
       or new.assumption_set_id is distinct from old.assumption_set_id
       or new.model_version is distinct from old.model_version
       or new.initial_active_patient_quantity is distinct from old.initial_active_patient_quantity
       or new.base_unit_amount_cents is distinct from old.base_unit_amount_cents
       or new.currency is distinct from old.currency
       or new.discount_type is distinct from old.discount_type
       or new.discount_percentage is distinct from old.discount_percentage
       or new.discount_duration_months is distinct from old.discount_duration_months
       or new.offer_validity_days is distinct from old.offer_validity_days
       or new.usage_profile is distinct from old.usage_profile
       or new.assumptions_snapshot is distinct from old.assumptions_snapshot
       or new.results_snapshot is distinct from old.results_snapshot
       or new.profitability_rating is distinct from old.profitability_rating
       or new.internal_justification is distinct from old.internal_justification
       or new.internal_notes is distinct from old.internal_notes
       or new.catalog_version_id is distinct from old.catalog_version_id
       or new.request_hash is distinct from old.request_hash
       or new.modular_input_snapshot is distinct from old.modular_input_snapshot
       or new.public_notes is distinct from old.public_notes
       or new.deleted_at is distinct from old.deleted_at
         )
       )
     ) then
    raise exception 'SALES_MODULAR_SIMULATION_FINANCIALS_IMMUTABLE' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$function$;

drop trigger if exists sales_offer_simulation_items_immutable_v1 on public.sales_offer_simulation_items;
create trigger sales_offer_simulation_items_immutable_v1
before update or delete on public.sales_offer_simulation_items
for each row execute function public.prevent_sales_modular_snapshot_mutation_v1();

drop trigger if exists sales_offer_items_immutable_v1 on public.sales_offer_items;
create trigger sales_offer_items_immutable_v1
before update or delete on public.sales_offer_items
for each row execute function public.prevent_sales_modular_snapshot_mutation_v1();

drop trigger if exists sales_offer_simulations_financials_immutable_v1 on public.sales_offer_simulations;
create trigger sales_offer_simulations_financials_immutable_v1
before update or delete on public.sales_offer_simulations
for each row execute function public.protect_sales_modular_simulation_financials_v1();

create or replace function public.protect_sales_modular_offer_financials_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' and old.offer_type = 'modular' then
    raise exception 'SALES_MODULAR_OFFER_IMMUTABLE' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE'
     and (
       new.offer_type is distinct from old.offer_type
       or (
         old.offer_type = 'modular'
         and (
           new.lead_id is distinct from old.lead_id
           or new.simulation_id is distinct from old.simulation_id
           or new.simulation_snapshot is distinct from old.simulation_snapshot
           or new.base_unit_amount_cents is distinct from old.base_unit_amount_cents
           or new.currency is distinct from old.currency
           or new.initial_active_patient_quantity is distinct from old.initial_active_patient_quantity
           or new.discount_duration_months is distinct from old.discount_duration_months
           or new.discount_type is distinct from old.discount_type
           or new.discount_percentage is distinct from old.discount_percentage
           or new.promotional_monthly_amount_cents is distinct from old.promotional_monthly_amount_cents
           or new.post_discount_monthly_amount_cents is distinct from old.post_discount_monthly_amount_cents
           or new.internal_justification is distinct from old.internal_justification
           or new.public_token_hash is distinct from old.public_token_hash
           or new.expires_at is distinct from old.expires_at
           or new.created_by is distinct from old.created_by
           or new.idempotency_key is distinct from old.idempotency_key
           or new.catalog_version_id is distinct from old.catalog_version_id
           or new.proposal_name is distinct from old.proposal_name
           or new.public_notes is distinct from old.public_notes
           or new.modular_checkout_enabled is distinct from old.modular_checkout_enabled
           or new.modular_snapshot is distinct from old.modular_snapshot
           or new.request_hash is distinct from old.request_hash
           or new.stripe_customer_id is distinct from old.stripe_customer_id
           or new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id
           or new.stripe_subscription_id is distinct from old.stripe_subscription_id
           or new.stripe_discount_id is distinct from old.stripe_discount_id
           or new.stripe_coupon_id is distinct from old.stripe_coupon_id
           or new.stripe_promotion_code_id is distinct from old.stripe_promotion_code_id
         )
       )
     ) then
    raise exception 'SALES_MODULAR_OFFER_FINANCIALS_IMMUTABLE' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$function$;

drop trigger if exists sales_offers_modular_financials_immutable_v1 on public.sales_offers;
create trigger sales_offers_modular_financials_immutable_v1
before update or delete on public.sales_offers
for each row execute function public.protect_sales_modular_offer_financials_v1();

create or replace function public.protect_sales_catalog_version_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if old.status in ('active', 'archived') then
    if tg_op = 'DELETE' then
      raise exception 'PRICING_CATALOG_IMMUTABLE' using errcode = '55000';
    end if;
    if old.status = 'active'
       and new.status = 'active'
       and old.catalog_snapshot = '{}'::jsonb
       and new.catalog_snapshot <> '{}'::jsonb
       and (to_jsonb(new) - 'catalog_snapshot')
         = (to_jsonb(old) - 'catalog_snapshot') then
      return new;
    end if;
    if old.status = 'active'
       and new.status = 'archived'
       and (to_jsonb(new) - 'status' - 'archived_at')
         = (to_jsonb(old) - 'status' - 'archived_at') then
      return new;
    end if;
    raise exception 'PRICING_CATALOG_IMMUTABLE' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$function$;

drop trigger if exists sales_pricing_catalog_versions_immutable_v1 on public.sales_pricing_catalog_versions;
create trigger sales_pricing_catalog_versions_immutable_v1
before update or delete on public.sales_pricing_catalog_versions
for each row execute function public.protect_sales_catalog_version_v1();

create or replace function public.protect_published_sales_catalog_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  version_status text;
begin
  select status into version_status
    from public.sales_pricing_catalog_versions
   where id = coalesce(old.catalog_version_id, new.catalog_version_id);
  if version_status in ('active', 'archived') then
    raise exception 'PRICING_CATALOG_IMMUTABLE' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$function$;

drop trigger if exists sales_pricing_catalog_items_published_immutable_v1 on public.sales_pricing_catalog_items;
create trigger sales_pricing_catalog_items_published_immutable_v1
before update or delete on public.sales_pricing_catalog_items
for each row execute function public.protect_published_sales_catalog_v1();

drop trigger if exists sales_pricing_catalog_tiers_published_immutable_v1 on public.sales_pricing_catalog_tiers;
create trigger sales_pricing_catalog_tiers_published_immutable_v1
before update or delete on public.sales_pricing_catalog_tiers
for each row execute function public.protect_published_sales_catalog_v1();

drop trigger if exists sales_pricing_item_cost_models_published_immutable_v1 on public.sales_pricing_item_cost_models;
create trigger sales_pricing_item_cost_models_published_immutable_v1
before update or delete on public.sales_pricing_item_cost_models
for each row execute function public.protect_published_sales_catalog_v1();

insert into public.sales_pricing_catalog_versions (
  id, version, name, status, effective_at, allocation_settings, admin_notes,
  published_at
) values (
  '10000000-0000-4000-8000-000000000001'::uuid,
  1,
  'Catálogo comercial inicial',
  'active',
  '2026-07-27 00:00:00+00'::timestamptz,
  jsonb_build_object(
    'stripePercentage', 'net_revenue',
    'stripeFixed', 'base_package',
    'revenueTax', 'net_revenue',
    'delinquency', 'net_revenue',
    'sharedPlatformCosts', 'configured_weight',
    'belowEbitda', 'configured_weight'
  ),
  'Hipóteses comerciais iniciais editáveis somente por nova versão.',
  '2026-07-27 00:00:00+00'::timestamptz
)
on conflict (id) do nothing;

insert into public.sales_pricing_catalog_items (
  id, catalog_version_id, item_key, public_name, internal_name, public_description,
  pricing_mode, billing_interval, unit_name, recurring_amount_cents,
  one_time_amount_cents, sort_order, is_required, is_public, metadata
) values
(
  '11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  'clinical_core', 'Verto Clínica', 'Núcleo clínico e ABA',
  'Gestão clínica completa, prontuário, planejamento terapêutico, coleta de dados, ABA, gráficos, supervisão, relatórios e participação da família.',
  'package_limit', 'monthly', 'pacientes', null, null, 10, true, true,
  '{"includedStorageMbPerPatient":100,"includesCompleteClinicalAba":true,"features":["Pacientes, responsáveis, profissionais e permissões","Prontuário, anamnese, evoluções e documentos clínicos","Planos terapêuticos, objetivos, programas, habilidades e alvos","Sessões estruturadas, DTT, NET e coleta ABA completa","Prompts, frequência, duração, latência, intervalos e ABC","Critérios de domínio, manutenção, sondagens e regressões","Gráficos, supervisão e relatórios clínicos","Portal clínico e participação da família"]}'::jsonb
),
(
  '11000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
  'appointments_communication', 'Agenda e Comunicação', 'Agenda, comunicação e portal de agenda',
  'Agenda, recorrências, salas, conflitos, confirmações, cancelamentos, reagendamentos, lembretes, notificações e portal de agenda do paciente.',
  'package_limit', 'monthly', 'pacientes', null, null, 20, false, true, '{}'::jsonb
),
(
  '11000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001',
  'financial_management', 'Financeiro e Gestão', 'Financeiro gerencial',
  'Receitas, despesas, pagamentos, contas a receber, inadimplência, fluxo financeiro, DRE, EBITDA, margens, indicadores e relatórios.',
  'flat_monthly', 'monthly', 'clínica', 9900, null, 30, false, true, '{}'::jsonb
),
(
  '11000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001',
  'insurance_tiss', 'Convênios e TISS', 'Convênios, TISS e faturamento',
  'Convênios, pagadores, elegibilidade, autorizações, guias, TUSS, pré-faturamento, lotes, XML, pendências e relatórios.',
  'usage_tier', 'monthly', 'guias/mês', null, null, 40, false, true, '{}'::jsonb
),
(
  '11000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001',
  'school_management', 'Gestão Escolar e Institucional', 'Gestão escolar e institucional',
  'Escolas, unidades, contatos, vínculos, consentimentos, reuniões, presença, atas, documentos, encaminhamentos, tarefas e histórico institucional.',
  'package_limit', 'monthly', 'pacientes', null, null, 50, false, true, '{}'::jsonb
),
(
  '11000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001',
  'additional_storage', 'Armazenamento adicional', 'Blocos adicionais de armazenamento',
  'Capacidade adicional de arquivos, além dos 100 MB incluídos por paciente permitido no pacote Verto Clínica.',
  'storage_block', 'monthly', 'blocos', null, null, 60, false, true, '{}'::jsonb
),
(
  '11000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001',
  'onboarding', 'Implantação', 'Implantação comercial',
  'Configuração inicial, orientação e implantação da operação na Verto.',
  'one_time', 'one_time', 'implantação', null, null, 70, false, true,
  '{"allowFree":true,"allowCustom":true,"projectionInstallmentsOnly":true}'::jsonb
)
on conflict (id) do nothing;

insert into public.sales_pricing_catalog_tiers (
  id, catalog_version_id, catalog_item_id, tier_key, public_name,
  minimum_quantity, maximum_quantity, included_quantity,
  recurring_amount_cents, one_time_amount_cents, sort_order, is_custom, metadata
) values
('12000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','up_to_10','Verto Clínica até 10',1,10,10,19900,null,10,false,'{"includedStorageMb":1000}'::jsonb),
('12000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','up_to_25','Verto Clínica até 25',1,25,25,39900,null,20,false,'{"includedStorageMb":2500}'::jsonb),
('12000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','up_to_50','Verto Clínica até 50',1,50,50,69900,null,30,false,'{"includedStorageMb":5000}'::jsonb),
('12000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','up_to_100','Verto Clínica até 100',1,100,100,119900,null,40,false,'{"includedStorageMb":10000}'::jsonb),
('12000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','custom','Verto Clínica personalizado',101,null,null,null,null,50,true,'{}'::jsonb),
('12000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','up_to_10','Agenda até 10',1,10,10,4900,null,10,false,'{}'::jsonb),
('12000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','up_to_25','Agenda até 25',1,25,25,7900,null,20,false,'{}'::jsonb),
('12000000-0000-4000-8000-000000000013','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','up_to_50','Agenda até 50',1,50,50,12900,null,30,false,'{}'::jsonb),
('12000000-0000-4000-8000-000000000014','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','up_to_100','Agenda até 100',1,100,100,19900,null,40,false,'{}'::jsonb),
('12000000-0000-4000-8000-000000000015','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','custom','Agenda personalizada',101,null,null,null,null,50,true,'{}'::jsonb),
('12000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000004','up_to_100','Até 100 guias/mês',1,100,100,14900,null,10,false,'{}'::jsonb),
('12000000-0000-4000-8000-000000000022','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000004','up_to_500','Até 500 guias/mês',101,500,500,29900,null,20,false,'{}'::jsonb),
('12000000-0000-4000-8000-000000000023','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000004','custom','Volume personalizado',501,null,null,null,null,30,true,'{}'::jsonb),
('12000000-0000-4000-8000-000000000031','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000005','up_to_10','Gestão Escolar até 10',1,10,10,5900,null,10,false,'{}'::jsonb),
('12000000-0000-4000-8000-000000000032','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000005','up_to_25','Gestão Escolar até 25',1,25,25,9900,null,20,false,'{}'::jsonb),
('12000000-0000-4000-8000-000000000033','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000005','up_to_50','Gestão Escolar até 50',1,50,50,14900,null,30,false,'{}'::jsonb),
('12000000-0000-4000-8000-000000000034','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000005','up_to_100','Gestão Escolar até 100',1,100,100,24900,null,40,false,'{}'::jsonb),
('12000000-0000-4000-8000-000000000035','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000005','custom','Gestão Escolar personalizada',101,null,null,null,null,50,true,'{}'::jsonb),
('12000000-0000-4000-8000-000000000041','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000006','gb_1','Bloco de 1 GB',1,null,1024,299,null,10,false,'{"gigabytes":1}'::jsonb),
('12000000-0000-4000-8000-000000000042','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000006','gb_5','Bloco de 5 GB',1,null,5120,990,null,20,false,'{"gigabytes":5}'::jsonb),
('12000000-0000-4000-8000-000000000043','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000006','gb_10','Bloco de 10 GB',1,null,10240,1690,null,30,false,'{"gigabytes":10}'::jsonb)
on conflict (id) do nothing;

insert into public.sales_pricing_item_cost_models (
  id, catalog_version_id, catalog_item_id, version,
  shared_cost_allocation_weight, cost_source, source_detail, effective_at
)
select
  ('13000000-0000-4000-8000-' || lpad(row_number() over (order by item.sort_order)::text, 12, '0'))::uuid,
  item.catalog_version_id,
  item.id,
  1,
  case when item.item_key = 'clinical_core' then 4 else 1 end,
  'unavailable',
  'Custo por funcionalidade ainda não informado; não tratado como zero.',
  '2026-07-27 00:00:00+00'::timestamptz
from public.sales_pricing_catalog_items item
where item.catalog_version_id = '10000000-0000-4000-8000-000000000001'
on conflict (catalog_item_id, version) do nothing;

update public.sales_pricing_catalog_versions version
set catalog_snapshot = jsonb_build_object(
  'version', version.version,
  'name', version.name,
  'effectiveAt', version.effective_at,
  'allocationSettings', version.allocation_settings,
  'items', (
    select coalesce(jsonb_agg(
      to_jsonb(item) || jsonb_build_object(
        'tiers', (
          select coalesce(jsonb_agg(to_jsonb(tier) order by tier.sort_order), '[]'::jsonb)
          from public.sales_pricing_catalog_tiers tier
          where tier.catalog_item_id = item.id
        ),
        'costModels', (
          select coalesce(jsonb_agg(to_jsonb(cost_model) order by cost_model.version), '[]'::jsonb)
          from public.sales_pricing_item_cost_models cost_model
          where cost_model.catalog_item_id = item.id
        )
      ) order by item.sort_order), '[]'::jsonb)
    from public.sales_pricing_catalog_items item
    where item.catalog_version_id = version.id
  )
)
where version.id = '10000000-0000-4000-8000-000000000001'
  and version.catalog_snapshot = '{}'::jsonb;

create or replace function public.clone_sales_pricing_catalog_version_v1(
  p_source_version_id uuid,
  p_name text,
  p_actor_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  source_version public.sales_pricing_catalog_versions%rowtype;
  created_version public.sales_pricing_catalog_versions%rowtype;
  next_version integer;
  item_record record;
  new_item_id uuid;
begin
  if p_actor_user_id is null
     or nullif(btrim(p_name), '') is null
     or char_length(coalesce(p_idempotency_key, '')) < 12 then
    raise exception 'PRICING_CATALOG_INVALID' using errcode = '22023';
  end if;
  select * into source_version
    from public.sales_pricing_catalog_versions
   where id = p_source_version_id;
  if not found then
    raise exception 'PRICING_CATALOG_VERSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  select version_row.* into created_version
    from public.sales_pricing_catalog_audit_events audit
    join public.sales_pricing_catalog_versions version_row
      on version_row.id = (audit.payload->>'createdVersionId')::uuid
   where audit.idempotency_key = p_idempotency_key
     and audit.actor_user_id = p_actor_user_id
   limit 1;
  if found then
    return to_jsonb(created_version);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sales-pricing-catalog-version', 0));
  select coalesce(max(version), 0) + 1 into next_version
    from public.sales_pricing_catalog_versions;
  insert into public.sales_pricing_catalog_versions (
    version, name, status, effective_at, allocation_settings, admin_notes, created_by
  ) values (
    next_version, left(btrim(p_name), 120), 'draft', now(),
    source_version.allocation_settings, source_version.admin_notes, p_actor_user_id
  ) returning * into created_version;
  for item_record in
    select * from public.sales_pricing_catalog_items
     where catalog_version_id = source_version.id
     order by sort_order, item_key
  loop
    new_item_id := gen_random_uuid();
    insert into public.sales_pricing_catalog_items (
      id, catalog_version_id, item_key, public_name, internal_name, public_description,
      pricing_mode, billing_interval, unit_name, included_quantity, maximum_quantity,
      recurring_amount_cents, one_time_amount_cents, sort_order, is_required,
      is_public, is_active, compatible_base_packages, metadata
    ) values (
      new_item_id, created_version.id, item_record.item_key, item_record.public_name,
      item_record.internal_name, item_record.public_description, item_record.pricing_mode,
      item_record.billing_interval, item_record.unit_name, item_record.included_quantity,
      item_record.maximum_quantity, item_record.recurring_amount_cents,
      item_record.one_time_amount_cents, item_record.sort_order, item_record.is_required,
      item_record.is_public, item_record.is_active, item_record.compatible_base_packages,
      item_record.metadata
    );
    insert into public.sales_pricing_catalog_tiers (
      catalog_version_id, catalog_item_id, tier_key, public_name,
      minimum_quantity, maximum_quantity, included_quantity,
      recurring_amount_cents, one_time_amount_cents, sort_order, is_custom, metadata
    )
    select created_version.id, new_item_id, tier_key, public_name,
      minimum_quantity, maximum_quantity, included_quantity,
      recurring_amount_cents, one_time_amount_cents, sort_order, is_custom, metadata
    from public.sales_pricing_catalog_tiers
    where catalog_item_id = item_record.id;
    insert into public.sales_pricing_item_cost_models (
      catalog_version_id, catalog_item_id, version,
      direct_fixed_monthly_cost_cents, direct_cost_per_patient_cents,
      direct_cost_per_clinic_cents, direct_cost_per_usage_unit_cents,
      storage_cost_per_gb_cents, egress_cost_per_gb_cents,
      notification_cost_per_unit_cents, processing_cost_per_unit_cents,
      support_fixed_monthly_cost_cents, support_cost_per_patient_cents,
      operational_fixed_monthly_cost_cents, onboarding_cost_cents,
      shared_cost_allocation_weight, cost_source, source_detail,
      effective_at, created_by
    )
    select created_version.id, new_item_id, 1,
      direct_fixed_monthly_cost_cents, direct_cost_per_patient_cents,
      direct_cost_per_clinic_cents, direct_cost_per_usage_unit_cents,
      storage_cost_per_gb_cents, egress_cost_per_gb_cents,
      notification_cost_per_unit_cents, processing_cost_per_unit_cents,
      support_fixed_monthly_cost_cents, support_cost_per_patient_cents,
      operational_fixed_monthly_cost_cents, onboarding_cost_cents,
      shared_cost_allocation_weight, cost_source, source_detail,
      now(), p_actor_user_id
    from public.sales_pricing_item_cost_models
    where catalog_item_id = item_record.id
    order by version desc
    limit 1;
  end loop;
  insert into public.sales_pricing_catalog_audit_events (
    catalog_version_id, event_type, actor_user_id, payload, idempotency_key
  ) values (
    created_version.id, 'catalog_cloned', p_actor_user_id,
    jsonb_build_object('sourceVersionId', source_version.id, 'createdVersionId', created_version.id),
    p_idempotency_key
  );
  return to_jsonb(created_version);
end
$function$;

create or replace function public.publish_sales_pricing_catalog_version_v1(
  p_catalog_version_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  version_row public.sales_pricing_catalog_versions%rowtype;
  snapshot jsonb;
begin
  if p_actor_user_id is null or char_length(coalesce(p_idempotency_key, '')) < 12 then
    raise exception 'PRICING_CATALOG_INVALID' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sales-pricing-catalog-publish', 0));
  select * into version_row
    from public.sales_pricing_catalog_versions
   where id = p_catalog_version_id
   for update;
  if not found then
    raise exception 'PRICING_CATALOG_VERSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if version_row.status = 'active' then
    return to_jsonb(version_row);
  end if;
  if version_row.status <> 'draft' then
    raise exception 'PRICING_CATALOG_IMMUTABLE' using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.sales_pricing_catalog_items
     where catalog_version_id = p_catalog_version_id
       and item_key = 'clinical_core' and is_required and is_active
  ) or exists (
    select 1 from public.sales_pricing_catalog_items item
     where item.catalog_version_id = p_catalog_version_id
       and item.is_active
       and not exists (
         select 1 from public.sales_pricing_item_cost_models cost
          where cost.catalog_item_id = item.id
       )
  ) then
    raise exception 'PRICING_CATALOG_INVALID' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'version', version_row.version,
    'name', version_row.name,
    'effectiveAt', version_row.effective_at,
    'allocationSettings', version_row.allocation_settings,
    'items', coalesce(jsonb_agg(
      to_jsonb(item) || jsonb_build_object(
        'tiers', (
          select coalesce(jsonb_agg(to_jsonb(tier) order by tier.sort_order), '[]'::jsonb)
          from public.sales_pricing_catalog_tiers tier where tier.catalog_item_id = item.id
        ),
        'costModels', (
          select coalesce(jsonb_agg(to_jsonb(cost_model) order by cost_model.version), '[]'::jsonb)
          from public.sales_pricing_item_cost_models cost_model where cost_model.catalog_item_id = item.id
        )
      ) order by item.sort_order), '[]'::jsonb)
  ) into snapshot
  from public.sales_pricing_catalog_items item
  where item.catalog_version_id = p_catalog_version_id;
  update public.sales_pricing_catalog_versions
     set status = 'archived', archived_at = now()
   where status = 'active' and id <> p_catalog_version_id;
  update public.sales_pricing_catalog_versions
     set status = 'active', published_by = p_actor_user_id,
         published_at = now(), effective_at = now(), catalog_snapshot = snapshot
   where id = p_catalog_version_id
   returning * into version_row;
  insert into public.sales_pricing_catalog_audit_events (
    catalog_version_id, event_type, actor_user_id, payload, idempotency_key
  ) values (
    p_catalog_version_id, 'catalog_published', p_actor_user_id,
    jsonb_build_object('version', version_row.version), p_idempotency_key
  ) on conflict (idempotency_key) do nothing;
  return to_jsonb(version_row);
end
$function$;

create or replace function public.save_sales_pricing_catalog_draft_v1(
  p_catalog_version_id uuid,
  p_action text,
  p_payload jsonb,
  p_actor_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  version_row public.sales_pricing_catalog_versions%rowtype;
  item_row public.sales_pricing_catalog_items%rowtype;
  tier_row public.sales_pricing_catalog_tiers%rowtype;
  cost_row public.sales_pricing_item_cost_models%rowtype;
  next_cost_version integer;
  existing_event public.sales_pricing_catalog_audit_events%rowtype;
  result jsonb;
begin
  if p_actor_user_id is null
     or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object'
     or char_length(coalesce(p_idempotency_key, '')) < 12 then
    raise exception 'PRICING_CATALOG_INVALID' using errcode = '22023';
  end if;
  select * into existing_event
    from public.sales_pricing_catalog_audit_events
   where idempotency_key = p_idempotency_key
     and actor_user_id = p_actor_user_id;
  if found then
    return existing_event.payload->'result';
  end if;
  select * into version_row
    from public.sales_pricing_catalog_versions
   where id = p_catalog_version_id
   for update;
  if not found then
    raise exception 'PRICING_CATALOG_VERSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if version_row.status <> 'draft' then
    raise exception 'PRICING_CATALOG_IMMUTABLE' using errcode = '55000';
  end if;
  if p_action = 'version' then
    if p_payload ? 'allocationSettings'
       and (
         jsonb_typeof(p_payload->'allocationSettings') <> 'object'
         or (
           select count(*) from jsonb_object_keys(
             p_payload->'allocationSettings'
           )
         ) <> 6
         or exists (
           select 1
             from jsonb_each_text(p_payload->'allocationSettings') setting
            where setting.key not in (
              'stripePercentage', 'stripeFixed', 'revenueTax',
              'delinquency', 'sharedPlatformCosts', 'belowEbitda'
            )
               or setting.value not in (
                 'net_revenue', 'gross_revenue', 'configured_weight',
                 'base_package', 'none', 'custom'
               )
         )
       ) then
      raise exception 'PRICING_INVALID_ALLOCATION' using errcode = '22023';
    end if;
    update public.sales_pricing_catalog_versions
       set name = left(coalesce(nullif(btrim(p_payload->>'name'), ''), name), 120),
           effective_at = coalesce(nullif(p_payload->>'effectiveAt', '')::timestamptz, effective_at),
           allocation_settings = coalesce(p_payload->'allocationSettings', allocation_settings),
           admin_notes = case
             when p_payload ? 'adminNotes' then nullif(left(p_payload->>'adminNotes', 2000), '')
             else admin_notes
           end
     where id = p_catalog_version_id
     returning * into version_row;
    result := to_jsonb(version_row);
  elsif p_action = 'item' then
    update public.sales_pricing_catalog_items
       set public_name = left(coalesce(nullif(btrim(p_payload->>'publicName'), ''), public_name), 120),
           public_description = left(coalesce(nullif(btrim(p_payload->>'description'), ''), public_description), 4000),
           recurring_amount_cents = case when p_payload ? 'recurringAmountCents'
             then nullif(p_payload->>'recurringAmountCents', '')::integer else recurring_amount_cents end,
           one_time_amount_cents = case when p_payload ? 'oneTimeAmountCents'
             then nullif(p_payload->>'oneTimeAmountCents', '')::integer else one_time_amount_cents end,
           is_active = case when p_payload ? 'isActive'
             then (p_payload->>'isActive')::boolean else is_active end
     where id = (p_payload->>'itemId')::uuid
       and catalog_version_id = p_catalog_version_id
     returning * into item_row;
    if not found then
      raise exception 'PRICING_ITEM_NOT_FOUND' using errcode = 'P0002';
    end if;
    result := to_jsonb(item_row);
  elsif p_action = 'tier' then
    update public.sales_pricing_catalog_tiers
       set public_name = left(coalesce(nullif(btrim(p_payload->>'publicName'), ''), public_name), 120),
           minimum_quantity = case when p_payload ? 'minimumQuantity'
             then (p_payload->>'minimumQuantity')::integer else minimum_quantity end,
           maximum_quantity = case when p_payload ? 'maximumQuantity'
             then nullif(p_payload->>'maximumQuantity', '')::integer else maximum_quantity end,
           included_quantity = case when p_payload ? 'includedQuantity'
             then nullif(p_payload->>'includedQuantity', '')::integer else included_quantity end,
           recurring_amount_cents = case when p_payload ? 'recurringAmountCents'
             then nullif(p_payload->>'recurringAmountCents', '')::integer else recurring_amount_cents end,
           one_time_amount_cents = case when p_payload ? 'oneTimeAmountCents'
             then nullif(p_payload->>'oneTimeAmountCents', '')::integer else one_time_amount_cents end
     where id = (p_payload->>'tierId')::uuid
       and catalog_version_id = p_catalog_version_id
     returning * into tier_row;
    if not found then
      raise exception 'PRICING_TIER_NOT_FOUND' using errcode = 'P0002';
    end if;
    result := to_jsonb(tier_row);
  elsif p_action = 'cost_model' then
    select * into item_row
      from public.sales_pricing_catalog_items
     where id = (p_payload->>'itemId')::uuid
       and catalog_version_id = p_catalog_version_id;
    if not found then
      raise exception 'PRICING_ITEM_NOT_FOUND' using errcode = 'P0002';
    end if;
    select coalesce(max(version), 0) + 1 into next_cost_version
      from public.sales_pricing_item_cost_models
     where catalog_item_id = item_row.id;
    insert into public.sales_pricing_item_cost_models (
      catalog_version_id, catalog_item_id, version,
      direct_fixed_monthly_cost_cents, direct_cost_per_patient_cents,
      direct_cost_per_clinic_cents, direct_cost_per_usage_unit_cents,
      storage_cost_per_gb_cents, egress_cost_per_gb_cents,
      notification_cost_per_unit_cents, processing_cost_per_unit_cents,
      support_fixed_monthly_cost_cents, support_cost_per_patient_cents,
      operational_fixed_monthly_cost_cents, onboarding_cost_cents,
      shared_cost_allocation_weight, cost_source, source_detail,
      effective_at, created_by
    ) values (
      p_catalog_version_id, item_row.id, next_cost_version,
      nullif(p_payload->>'directFixedMonthlyCostCents', '')::integer,
      nullif(p_payload->>'directCostPerPatientCents', '')::integer,
      nullif(p_payload->>'directCostPerClinicCents', '')::integer,
      nullif(p_payload->>'directCostPerUsageUnitCents', '')::integer,
      nullif(p_payload->>'storageCostPerGbCents', '')::integer,
      nullif(p_payload->>'egressCostPerGbCents', '')::integer,
      nullif(p_payload->>'notificationCostPerUnitCents', '')::integer,
      nullif(p_payload->>'processingCostPerUnitCents', '')::integer,
      nullif(p_payload->>'supportFixedMonthlyCostCents', '')::integer,
      nullif(p_payload->>'supportCostPerPatientCents', '')::integer,
      nullif(p_payload->>'operationalFixedMonthlyCostCents', '')::integer,
      nullif(p_payload->>'onboardingCostCents', '')::integer,
      coalesce((p_payload->>'sharedCostAllocationWeight')::numeric, 1),
      coalesce(nullif(p_payload->>'costSource', ''), 'unavailable'),
      left(coalesce(nullif(btrim(p_payload->>'sourceDetail'), ''), 'Custo ainda não informado.'), 500),
      now(), p_actor_user_id
    ) returning * into cost_row;
    result := to_jsonb(cost_row);
  else
    raise exception 'PRICING_CATALOG_INVALID' using errcode = '22023';
  end if;
  insert into public.sales_pricing_catalog_audit_events (
    catalog_version_id, catalog_item_id, event_type,
    actor_user_id, payload, idempotency_key
  ) values (
    p_catalog_version_id,
    case when p_action in ('item', 'cost_model')
      then (p_payload->>'itemId')::uuid else null end,
    'catalog_draft_' || p_action || '_saved',
    p_actor_user_id,
    jsonb_build_object('request', p_payload, 'result', result),
    p_idempotency_key
  );
  return result;
end
$function$;

create or replace function public.save_sales_modular_simulation_v1(
  p_simulation jsonb,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  existing_row public.sales_offer_simulations%rowtype;
  created_row public.sales_offer_simulations%rowtype;
  item jsonb;
begin
  if jsonb_typeof(p_simulation) <> 'object'
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1 then
    raise exception 'PROPOSAL_SIMULATION_INVALID' using errcode = '22023';
  end if;
  select * into existing_row
    from public.sales_offer_simulations
   where created_by = (p_simulation->>'createdBy')::uuid
     and idempotency_key = p_simulation->>'idempotencyKey';
  if found then
    if existing_row.request_hash is distinct from p_simulation->>'requestHash' then
      raise exception 'PROPOSAL_SNAPSHOT_CONFLICT' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'simulation', to_jsonb(existing_row),
      'items', (
        select coalesce(jsonb_agg(to_jsonb(stored) order by stored.sort_order), '[]'::jsonb)
        from public.sales_offer_simulation_items stored where stored.simulation_id = existing_row.id
      ),
      'idempotent', true
    );
  end if;
  insert into public.sales_offer_simulations (
    lead_id, created_by, status, assumption_set_id, model_version,
    initial_active_patient_quantity, base_unit_amount_cents, currency,
    discount_type, discount_percentage, discount_duration_months,
    offer_validity_days, usage_profile, custom_monthly_cost_cents,
    onboarding_cost_cents, assumptions_snapshot, results_snapshot,
    profitability_rating, internal_justification, internal_notes,
    idempotency_key, simulation_type, scenario_name, catalog_version_id,
    request_hash, modular_input_snapshot, public_notes
  ) values (
    (p_simulation->>'leadId')::uuid,
    (p_simulation->>'createdBy')::uuid,
    'saved',
    (p_simulation->>'assumptionSetId')::uuid,
    p_simulation->>'modelVersion',
    (p_simulation->>'patientQuantity')::integer,
    (p_simulation->>'baseAmountCents')::integer,
    'BRL',
    p_simulation->>'discountType',
    (p_simulation->>'discountPercentage')::numeric,
    nullif(p_simulation->>'discountDurationMonths', '')::integer,
    (p_simulation->>'offerValidityDays')::integer,
    p_simulation->>'usageProfile',
    0,
    0,
    p_simulation->'assumptionsSnapshot',
    p_simulation->'resultsSnapshot',
    p_simulation->>'profitabilityRating',
    nullif(p_simulation->>'internalJustification', ''),
    nullif(p_simulation->>'internalNotes', ''),
    p_simulation->>'idempotencyKey',
    'modular',
    left(coalesce(nullif(btrim(p_simulation->>'scenarioName'), ''), 'Cenário modular'), 120),
    (p_simulation->>'catalogVersionId')::uuid,
    p_simulation->>'requestHash',
    p_simulation->'inputSnapshot',
    nullif(p_simulation->>'publicNotes', '')
  ) returning * into created_row;
  for item in select value from jsonb_array_elements(p_items)
  loop
    insert into public.sales_offer_simulation_items (
      simulation_id, catalog_version_id, catalog_item_id, tier_id,
      item_key, public_name_snapshot, public_description_snapshot,
      pricing_mode_snapshot, quantity, limit_quantity, included_quantity,
      gross_recurring_amount_cents, recurring_amount_cents,
      post_promotion_recurring_amount_cents, one_time_amount_cents,
      item_discount_basis_points, item_discount_cents,
      allocated_global_discount_cents, direct_cost_cents,
      transaction_tax_cost_allocated_cents, shared_cost_allocated_cents,
      contribution_margin_cents, contribution_margin_basis_points,
      ebitda_cents, ebitda_margin_basis_points,
      below_ebitda_cost_allocated_cents, profit_tax_allocated_cents,
      net_income_cents, net_margin_basis_points, cost_source,
      cost_model_snapshot, result_snapshot, public_metadata, sort_order
    ) values (
      created_row.id, created_row.catalog_version_id,
      (item->>'catalogItemId')::uuid, nullif(item->>'tierId', '')::uuid,
      item->>'itemKey', item->>'publicName', item->>'description',
      item->>'pricingMode', (item->>'quantity')::integer,
      nullif(item->>'limitQuantity', '')::integer,
      nullif(item->>'includedQuantity', '')::integer,
      (item->>'grossRecurringRevenueCents')::integer,
      (item->>'promotionalRecurringRevenueCents')::integer,
      (item->>'postPromotionRecurringRevenueCents')::integer,
      (item->>'oneTimeRevenueCents')::integer,
      (item->>'itemDiscountBasisPoints')::integer,
      (item->>'itemDiscountCents')::integer,
      (item->>'allocatedGlobalDiscountCents')::integer,
      nullif(item#>>'{promotional,directCostCents}', '')::integer,
      nullif(item#>>'{promotional,transactionAndTaxCostAllocatedCents}', '')::integer,
      nullif(item#>>'{promotional,sharedPlatformCostAllocatedCents}', '')::integer,
      nullif(item#>>'{promotional,contributionMarginCents}', '')::integer,
      nullif(item#>>'{promotional,contributionMarginBasisPoints}', '')::integer,
      nullif(item#>>'{promotional,ebitdaCents}', '')::integer,
      nullif(item#>>'{promotional,ebitdaMarginBasisPoints}', '')::integer,
      nullif(item#>>'{promotional,belowEbitdaCostAllocatedCents}', '')::integer,
      nullif(item#>>'{promotional,profitTaxAllocatedCents}', '')::integer,
      nullif(item#>>'{promotional,netIncomeCents}', '')::integer,
      nullif(item#>>'{promotional,netMarginBasisPoints}', '')::integer,
      item->>'costSource', item->'costModelSnapshot',
      item, coalesce(item->'publicMetadata', '{}'::jsonb),
      coalesce((item->>'sortOrder')::integer, 0)
    );
  end loop;
  insert into public.sales_lead_events (
    lead_id, event_type, actor_user_id, metadata, idempotency_key
  ) values (
    created_row.lead_id, 'lead_updated', created_row.created_by,
    jsonb_build_object(
      'action', 'modular_profitability_simulation_created',
      'simulation_id', created_row.id,
      'catalog_version_id', created_row.catalog_version_id,
      'profitability_rating', created_row.profitability_rating
    ),
    'modular-simulation-created:' || created_row.id::text
  ) on conflict (idempotency_key) do nothing;
  return jsonb_build_object(
    'simulation', to_jsonb(created_row),
    'items', (
      select coalesce(jsonb_agg(to_jsonb(stored) order by stored.sort_order), '[]'::jsonb)
      from public.sales_offer_simulation_items stored where stored.simulation_id = created_row.id
    ),
    'idempotent', false
  );
end
$function$;

create or replace function public.create_sales_modular_offer_v1(
  p_simulation_id uuid,
  p_lead_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_public_token_hash text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  simulation public.sales_offer_simulations%rowtype;
  existing_offer public.sales_offers%rowtype;
  created_offer public.sales_offers%rowtype;
  result jsonb;
  base_line public.sales_offer_simulation_items%rowtype;
begin
  if p_actor_user_id is null or char_length(coalesce(p_idempotency_key, '')) < 12
     or char_length(coalesce(p_request_hash, '')) <> 64
     or char_length(coalesce(p_public_token_hash, '')) <> 64 then
    raise exception 'PROPOSAL_SIMULATION_INVALID' using errcode = '22023';
  end if;
  select * into simulation from public.sales_offer_simulations
   where id = p_simulation_id and lead_id = p_lead_id
     and simulation_type = 'modular' and deleted_at is null
   for update;
  if not found then
    raise exception 'PROPOSAL_SIMULATION_INVALID' using errcode = 'P0002';
  end if;
  select * into existing_offer from public.sales_offers
   where created_by = p_actor_user_id and idempotency_key = p_idempotency_key;
  if found then
    if existing_offer.request_hash is distinct from p_request_hash
       or existing_offer.simulation_id is distinct from p_simulation_id then
      raise exception 'PROPOSAL_SNAPSHOT_CONFLICT' using errcode = '23505';
    end if;
    return jsonb_build_object('offer', to_jsonb(existing_offer), 'idempotent', true);
  end if;
  if exists (select 1 from public.sales_offers where simulation_id = p_simulation_id) then
    select * into existing_offer from public.sales_offers where simulation_id = p_simulation_id;
    return jsonb_build_object('offer', to_jsonb(existing_offer), 'idempotent', true);
  end if;
  select * into base_line from public.sales_offer_simulation_items
   where simulation_id = simulation.id and item_key = 'clinical_core'
   limit 1;
  if not found then
    raise exception 'PROPOSAL_SIMULATION_INVALID' using errcode = '22023';
  end if;
  result := simulation.results_snapshot;
  insert into public.sales_offers (
    lead_id, simulation_id, simulation_snapshot, status,
    base_unit_amount_cents, currency, initial_active_patient_quantity,
    discount_duration_months, discount_type, discount_percentage,
    promotional_unit_amount_cents, promotional_monthly_amount_cents,
    post_discount_monthly_amount_cents, internal_justification,
    public_token_hash, commercial_notes, expires_at, created_by,
    idempotency_key, offer_type, catalog_version_id, proposal_name,
    public_notes, modular_checkout_enabled, modular_snapshot, request_hash
  ) values (
    simulation.lead_id, simulation.id,
    jsonb_build_object(
      'catalogVersionId', simulation.catalog_version_id,
      'assumptionSetId', simulation.assumption_set_id,
      'modelVersion', simulation.model_version,
      'input', simulation.modular_input_snapshot,
      'results', simulation.results_snapshot,
      'createdAt', simulation.created_at
    ),
    'ready', base_line.gross_recurring_amount_cents, simulation.currency,
    simulation.initial_active_patient_quantity,
    simulation.discount_duration_months, simulation.discount_type,
    simulation.discount_percentage, null,
    (result->>'promotionalRecurringRevenueCents')::integer,
    (result->>'postPromotionRecurringRevenueCents')::integer,
    simulation.internal_justification, p_public_token_hash,
    simulation.public_notes, p_expires_at, p_actor_user_id,
    p_idempotency_key, 'modular', simulation.catalog_version_id,
    simulation.scenario_name, simulation.public_notes, false,
    jsonb_build_object(
      'catalogVersionId', simulation.catalog_version_id,
      'catalogVersion', result->'catalogVersion',
      'basePackage', result->'basePackage',
      'promotionalRecurringRevenueCents', result->'promotionalRecurringRevenueCents',
      'postPromotionRecurringRevenueCents', result->'postPromotionRecurringRevenueCents',
      'oneTimeRevenueCents', result->'oneTimeRevenueCents',
      'globalDiscountCents', result->'globalDiscountCents',
      'discountDurationMonths', simulation.discount_duration_months,
      'onboardingInstallments',
        coalesce((simulation.modular_input_snapshot->>'onboardingInstallments')::integer, 1),
      'offerValidityDays', simulation.offer_validity_days
    ),
    p_request_hash
  ) returning * into created_offer;
  insert into public.sales_offer_items (
    offer_id, simulation_item_id, catalog_version_id, catalog_item_id,
    tier_id, item_key, public_name_snapshot, public_description_snapshot,
    pricing_mode_snapshot, quantity, limit_quantity, included_quantity,
    gross_recurring_amount_cents, recurring_amount_cents,
    post_promotion_recurring_amount_cents, one_time_amount_cents,
    item_discount_basis_points, allocated_global_discount_cents,
    public_metadata, internal_result_snapshot, sort_order
  )
  select created_offer.id, item.id, item.catalog_version_id, item.catalog_item_id,
    item.tier_id, item.item_key, item.public_name_snapshot,
    item.public_description_snapshot, item.pricing_mode_snapshot, item.quantity,
    item.limit_quantity, item.included_quantity,
    item.gross_recurring_amount_cents, item.recurring_amount_cents,
    item.post_promotion_recurring_amount_cents, item.one_time_amount_cents,
    item.item_discount_basis_points, item.allocated_global_discount_cents,
    item.public_metadata, item.result_snapshot, item.sort_order
  from public.sales_offer_simulation_items item
  where item.simulation_id = simulation.id;
  update public.sales_offer_simulations
     set status = 'offered', updated_at = now()
   where id = simulation.id;
  update public.sales_leads
     set status = 'proposal_preparing', updated_at = now()
   where id = simulation.lead_id and deleted_at is null;
  insert into public.sales_lead_events (
    lead_id, event_type, actor_user_id, metadata, idempotency_key
  ) values (
    simulation.lead_id, 'proposal_created', p_actor_user_id,
    jsonb_build_object(
      'offer_id', created_offer.id,
      'simulation_id', simulation.id,
      'offer_type', 'modular',
      'catalog_version_id', simulation.catalog_version_id
    ),
    'modular-proposal-created:' || created_offer.id::text
  ) on conflict (idempotency_key) do nothing;
  return jsonb_build_object('offer', to_jsonb(created_offer), 'idempotent', false);
end
$function$;

create or replace view public.sales_feature_profitability_summary_v1
with (security_invoker = true)
as
select
  simulation_item.item_key,
  simulation_item.public_name_snapshot as public_name,
  count(distinct simulation_item.simulation_id)::bigint as simulated_count,
  count(distinct offer_item.offer_id)::bigint as proposed_count,
  round(avg(simulation_item.recurring_amount_cents))::bigint as average_proposed_revenue_cents,
  round(avg(simulation_item.item_discount_basis_points))::integer as average_item_discount_basis_points,
  round(avg(simulation_item.direct_cost_cents))::bigint as average_direct_cost_cents,
  round(avg(simulation_item.ebitda_cents))::bigint as average_ebitda_cents,
  round(avg(simulation_item.ebitda_margin_basis_points))::integer as average_ebitda_margin_basis_points,
  min(simulation_item.ebitda_margin_basis_points) as minimum_ebitda_margin_basis_points,
  max(simulation_item.ebitda_margin_basis_points) as maximum_ebitda_margin_basis_points,
  round(avg(simulation_item.recurring_amount_cents))::bigint as average_ticket_cents,
  round(
    10000.0 * count(distinct simulation_item.simulation_id)
      filter (where simulation.status in ('selected', 'offered'))
    / nullif(count(distinct simulation_item.simulation_id), 0)
  )::integer as selected_basis_points,
  round(
    10000.0 * count(distinct offer_item.offer_id)
    / nullif(count(distinct simulation_item.simulation_id), 0)
  )::integer as proposed_basis_points,
  bool_or(simulation_item.direct_cost_cents is null) as has_insufficient_data,
  'simulated_and_proposed_only'::text as data_scope
from public.sales_offer_simulation_items simulation_item
join public.sales_offer_simulations simulation on simulation.id = simulation_item.simulation_id
left join public.sales_offer_items offer_item on offer_item.simulation_item_id = simulation_item.id
where simulation.deleted_at is null
group by simulation_item.item_key, simulation_item.public_name_snapshot;

alter table public.sales_pricing_catalog_versions enable row level security;
alter table public.sales_pricing_catalog_items enable row level security;
alter table public.sales_pricing_catalog_tiers enable row level security;
alter table public.sales_pricing_item_cost_models enable row level security;
alter table public.sales_pricing_catalog_audit_events enable row level security;
alter table public.sales_offer_simulation_items enable row level security;
alter table public.sales_offer_items enable row level security;

revoke all on public.sales_pricing_catalog_versions from public, anon, authenticated;
revoke all on public.sales_pricing_catalog_items from public, anon, authenticated;
revoke all on public.sales_pricing_catalog_tiers from public, anon, authenticated;
revoke all on public.sales_pricing_item_cost_models from public, anon, authenticated;
revoke all on public.sales_pricing_catalog_audit_events from public, anon, authenticated;
revoke all on public.sales_offer_simulation_items from public, anon, authenticated;
revoke all on public.sales_offer_items from public, anon, authenticated;
revoke all on public.sales_feature_profitability_summary_v1 from public, anon, authenticated;

revoke all on function public.prevent_sales_modular_snapshot_mutation_v1()
  from public, anon, authenticated;
revoke all on function public.protect_sales_modular_simulation_financials_v1()
  from public, anon, authenticated;
revoke all on function public.protect_sales_modular_offer_financials_v1()
  from public, anon, authenticated;
revoke all on function public.protect_sales_catalog_version_v1()
  from public, anon, authenticated;
revoke all on function public.protect_published_sales_catalog_v1()
  from public, anon, authenticated;

grant all on public.sales_pricing_catalog_versions to service_role;
grant all on public.sales_pricing_catalog_items to service_role;
grant all on public.sales_pricing_catalog_tiers to service_role;
grant all on public.sales_pricing_item_cost_models to service_role;
grant all on public.sales_pricing_catalog_audit_events to service_role;
grant all on public.sales_offer_simulation_items to service_role;
grant all on public.sales_offer_items to service_role;
grant select on public.sales_feature_profitability_summary_v1 to service_role;

revoke all on function public.clone_sales_pricing_catalog_version_v1(uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.publish_sales_pricing_catalog_version_v1(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.save_sales_pricing_catalog_draft_v1(uuid, text, jsonb, uuid, text)
  from public, anon, authenticated;
revoke all on function public.save_sales_modular_simulation_v1(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.create_sales_modular_offer_v1(uuid, uuid, uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.clone_sales_pricing_catalog_version_v1(uuid, text, uuid, text)
  to service_role;
grant execute on function public.publish_sales_pricing_catalog_version_v1(uuid, uuid, text)
  to service_role;
grant execute on function public.save_sales_pricing_catalog_draft_v1(uuid, text, jsonb, uuid, text)
  to service_role;
grant execute on function public.save_sales_modular_simulation_v1(jsonb, jsonb)
  to service_role;
grant execute on function public.create_sales_modular_offer_v1(uuid, uuid, uuid, text, text, text, timestamptz)
  to service_role;

comment on table public.sales_pricing_catalog_versions is
  'Catálogo comercial versionado. Versões publicadas são congeladas para propostas históricas.';
comment on table public.sales_pricing_item_cost_models is
  'Custos internos versionados por funcionalidade; valores indisponíveis permanecem nulos.';
comment on table public.sales_offer_simulation_items is
  'Linhas financeiras imutáveis da simulação modular. Não alimentam DRE realizada.';
comment on table public.sales_offer_items is
  'Linhas comerciais congeladas da proposta modular; resultados internos não são expostos publicamente.';
comment on view public.sales_feature_profitability_summary_v1 is
  'Relatório interno de rentabilidade simulada e proposta; não representa receita contratada ou realizada.';
comment on column public.sales_offers.modular_checkout_enabled is
  'Mantido false nesta etapa. Checkout modular não deve acessar Stripe.';

notify pgrst, 'reload schema';

commit;
