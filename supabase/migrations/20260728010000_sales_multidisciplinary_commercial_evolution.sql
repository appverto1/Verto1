-- Verto: commercial capacity, item discount phases, assisted modular Checkout,
-- multidisciplinary plans and immutable ABA specialty attribution.
-- Additive/idempotent. Apply manually only after 20260727040000.

begin;

create extension if not exists pgcrypto;

create or replace function public.sales_custom_capacity_policy_valid_v1(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  expected_keys constant text[] := array[
    'billingAdjustment','blockPriceCents','blockSizePatients',
    'blocksClinicalAccess','enabled','gracePeriodDays',
    'includedStorageMbPerPatient'
  ];
  received_keys text[];
begin
  if value is null or jsonb_typeof(value) <> 'object' then return false; end if;
  select array_agg(key order by key) into received_keys
  from jsonb_object_keys(value) key;
  if received_keys is distinct from expected_keys then return false; end if;
  return jsonb_typeof(value->'enabled') = 'boolean'
    and (value->>'blockSizePatients') ~ '^\d+$'
    and (value->>'blockSizePatients')::integer between 1 and 10000
    and (value->>'blockPriceCents') ~ '^\d+$'
    and (value->>'blockPriceCents')::bigint between 0 and 1000000000
    and (value->>'includedStorageMbPerPatient') ~ '^\d+$'
    and (value->>'includedStorageMbPerPatient')::integer between 1 and 1000000
    and (value->>'gracePeriodDays') ~ '^\d+$'
    and (value->>'gracePeriodDays')::integer between 0 and 365
    and value->>'billingAdjustment' = 'next_cycle'
    and value->'blocksClinicalAccess' = 'false'::jsonb;
exception when others then
  return false;
end;
$$;

alter table public.sales_pricing_catalog_versions
  add column if not exists custom_capacity_policy jsonb;

alter table public.sales_pricing_catalog_versions
  alter column custom_capacity_policy drop default,
  alter column custom_capacity_policy drop not null;

alter table public.sales_pricing_catalog_versions
  drop constraint if exists sales_pricing_catalog_custom_capacity_valid;
alter table public.sales_pricing_catalog_versions
  add constraint sales_pricing_catalog_custom_capacity_valid
  check (
    custom_capacity_policy is null
    or public.sales_custom_capacity_policy_valid_v1(custom_capacity_policy)
  );

-- Keep the published v2 cloning contract and include the new versioned policy.
create or replace function public.clone_sales_pricing_catalog_version_v2(
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
  result jsonb;
  created_id uuid;
begin
  result := public.clone_sales_pricing_catalog_version_v1(
    p_source_version_id, p_name, p_actor_user_id, p_idempotency_key
  );
  created_id := (result->>'id')::uuid;
  if result->>'name' is distinct from left(btrim(p_name), 120)
     or exists (
       select 1
         from public.sales_pricing_catalog_audit_events audit
        where audit.idempotency_key = p_idempotency_key
          and audit.actor_user_id = p_actor_user_id
          and audit.payload->>'sourceVersionId'
            is distinct from p_source_version_id::text
     ) then
    raise exception 'PRICING_CATALOG_IDEMPOTENCY_CONFLICT'
      using errcode = '23505';
  end if;
  update public.sales_pricing_catalog_versions target
     set modular_cost_settings = source.modular_cost_settings,
         custom_capacity_policy = coalesce(
           source.custom_capacity_policy,
           '{"enabled":true,"blockSizePatients":10,"blockPriceCents":7990,"includedStorageMbPerPatient":100,"gracePeriodDays":7,"billingAdjustment":"next_cycle","blocksClinicalAccess":false}'::jsonb
         )
    from public.sales_pricing_catalog_versions source
   where target.id = created_id
     and source.id = p_source_version_id
     and target.status = 'draft';
  update public.sales_pricing_item_cost_models target_cost
     set driver_config = source_cost.driver_config,
         other_variable_cost_cents = source_cost.other_variable_cost_cents
    from public.sales_pricing_catalog_items target_item,
         public.sales_pricing_catalog_items source_item,
         lateral (
           select cost.driver_config, cost.other_variable_cost_cents
             from public.sales_pricing_item_cost_models cost
            where cost.catalog_item_id = source_item.id
            order by cost.version desc
            limit 1
         ) source_cost
   where target_cost.catalog_version_id = created_id
     and target_cost.catalog_item_id = target_item.id
     and target_item.catalog_version_id = created_id
     and source_item.catalog_version_id = p_source_version_id
     and source_item.item_key = target_item.item_key;
  select to_jsonb(version_row) into result
    from public.sales_pricing_catalog_versions version_row
   where version_row.id = created_id;
  update public.sales_pricing_catalog_audit_events
     set payload = jsonb_set(payload, '{result}', result, true)
   where idempotency_key = p_idempotency_key
     and actor_user_id = p_actor_user_id;
  return result;
end
$function$;

-- Extend the existing draft contract without mutating active/archived versions.
create or replace function public.save_sales_pricing_catalog_draft_v2(
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
  result jsonb;
  saved_id uuid;
  version_status text;
  item_key text;
  existing_event public.sales_pricing_catalog_audit_events%rowtype;
begin
  if p_actor_user_id is null
     or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) is distinct from 'object'
     or char_length(coalesce(p_idempotency_key, '')) < 12 then
    raise exception 'PRICING_CATALOG_INVALID' using errcode = '22023';
  end if;
  select * into existing_event
    from public.sales_pricing_catalog_audit_events
   where idempotency_key = p_idempotency_key
     and actor_user_id = p_actor_user_id;
  if found then
    if existing_event.catalog_version_id <> p_catalog_version_id
       or existing_event.event_type <> ('catalog_draft_' || p_action || '_saved')
       or existing_event.payload->'request' is distinct from p_payload then
      raise exception 'PRICING_CATALOG_IDEMPOTENCY_CONFLICT'
        using errcode = '23505';
    end if;
    return existing_event.payload->'result';
  end if;
  select status into version_status
    from public.sales_pricing_catalog_versions
   where id = p_catalog_version_id
   for update;
  if not found then
    raise exception 'PRICING_CATALOG_VERSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if version_status <> 'draft' then
    raise exception 'PRICING_CATALOG_IMMUTABLE' using errcode = '55000';
  end if;
  if p_action = 'version' then
    if p_payload ? 'modularCostSettings'
       and not public.sales_modular_cost_settings_valid_v2(
         p_payload->'modularCostSettings'
       ) then
      raise exception 'PRICING_MODULAR_COST_SETTINGS_INVALID' using errcode = '22023';
    end if;
    if p_payload ? 'customCapacityPolicy'
       and not public.sales_custom_capacity_policy_valid_v1(
         p_payload->'customCapacityPolicy'
       ) then
      raise exception 'PRICING_CUSTOM_CAPACITY_POLICY_INVALID' using errcode = '22023';
    end if;
  end if;
  if p_action = 'cost_model' then
    select catalog_item.item_key into item_key
      from public.sales_pricing_catalog_items catalog_item
     where catalog_item.id = (p_payload->>'itemId')::uuid
       and catalog_item.catalog_version_id = p_catalog_version_id;
    if not found then
      raise exception 'PRICING_ITEM_NOT_FOUND' using errcode = 'P0002';
    end if;
    if jsonb_typeof(p_payload->'driverConfig') is distinct from 'object'
       or p_payload#>'{driverConfig,schemaVersion}' is distinct from '2'::jsonb
       or jsonb_typeof(p_payload#>'{driverConfig,profiles}') is distinct from 'object'
       or jsonb_typeof(
         coalesce(p_payload#>'{driverConfig,unitCostsCents}', '{}'::jsonb)
       ) is distinct from 'object'
       or (
         nullif(btrim(p_payload->>'otherVariableCostCents'), '') is not null
         and (
           btrim(p_payload->>'otherVariableCostCents') !~ '^[0-9]+$'
           or (p_payload->>'otherVariableCostCents')::numeric > 2147483647
         )
       )
       or exists (
         select 1
           from jsonb_each_text(
             coalesce(p_payload#>'{driverConfig,unitCostsCents}', '{}'::jsonb)
           ) unit_cost
          where nullif(unit_cost.value, '')::numeric < 0
       ) then
      raise exception 'PRICING_DRIVER_CONFIG_INVALID' using errcode = '22023';
    end if;
  end if;
  result := public.save_sales_pricing_catalog_draft_v1(
    p_catalog_version_id, p_action, p_payload, p_actor_user_id, p_idempotency_key
  );
  if p_action = 'version'
     and (
       p_payload ? 'modularCostSettings'
       or p_payload ? 'customCapacityPolicy'
     ) then
    update public.sales_pricing_catalog_versions
       set modular_cost_settings = case
             when p_payload ? 'modularCostSettings'
               then p_payload->'modularCostSettings'
             else modular_cost_settings
           end,
           custom_capacity_policy = case
             when p_payload ? 'customCapacityPolicy'
               then p_payload->'customCapacityPolicy'
             else custom_capacity_policy
           end
     where id = p_catalog_version_id
       and status = 'draft'
     returning to_jsonb(sales_pricing_catalog_versions) into result;
  elsif p_action = 'cost_model' then
    saved_id := (result->>'id')::uuid;
    update public.sales_pricing_item_cost_models
       set driver_config = p_payload->'driverConfig',
           other_variable_cost_cents =
             nullif(p_payload->>'otherVariableCostCents', '')::integer
     where id = saved_id
       and catalog_version_id = p_catalog_version_id
     returning to_jsonb(sales_pricing_item_cost_models) into result;
  end if;
  update public.sales_pricing_catalog_audit_events
     set payload = jsonb_set(payload, '{result}', result, true)
   where idempotency_key = p_idempotency_key
     and actor_user_id = p_actor_user_id;
  return result;
end
$function$;

create or replace function public.publish_sales_pricing_catalog_version_v2(
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
  duplicate_key text;
begin
  if p_actor_user_id is null
     or char_length(coalesce(p_idempotency_key, '')) < 12 then
    raise exception 'PRICING_CATALOG_INVALID' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('sales-pricing-catalog-publish', 0)
  );
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
  if version_row.custom_capacity_policy is null
     or not public.sales_custom_capacity_policy_valid_v1(
       version_row.custom_capacity_policy
     )
     or version_row.custom_capacity_policy->'blocksClinicalAccess'
       is distinct from 'false'::jsonb then
    raise exception 'PRICING_CATALOG_PUBLICATION_BLOCKED:CUSTOM_CAPACITY_POLICY'
      using errcode = '22023';
  end if;
  if not public.sales_modular_cost_settings_valid_v2(
    version_row.modular_cost_settings
  ) then
    raise exception 'PRICING_CATALOG_PUBLICATION_BLOCKED:COST_SETTINGS'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
      from public.sales_pricing_catalog_items
     where catalog_version_id = p_catalog_version_id
       and item_key = 'clinical_core'
       and is_required
       and is_active
  ) then
    raise exception 'PRICING_CATALOG_PUBLICATION_BLOCKED:BASE_PACKAGE'
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from public.sales_pricing_catalog_items item
      left join lateral (
        select cost.*
          from public.sales_pricing_item_cost_models cost
         where cost.catalog_item_id = item.id
         order by cost.version desc
         limit 1
      ) cost on true
     where item.catalog_version_id = p_catalog_version_id
       and item.is_active
       and (
         cost.id is null
         or cost.cost_source = 'unavailable'
         or not public.sales_modular_driver_config_valid_v2(
           item.item_key,
           cost.driver_config
         )
         or not public.sales_modular_cost_model_complete_v2(
           item.item_key,
           to_jsonb(cost),
           version_row.modular_cost_settings
         )
       )
  ) then
    raise exception 'PRICING_CATALOG_PUBLICATION_BLOCKED:COST_OR_DRIVER'
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from public.sales_pricing_catalog_items item
      join lateral (
        select cost.*
          from public.sales_pricing_item_cost_models cost
         where cost.catalog_item_id = item.id
         order by cost.version desc
         limit 1
      ) cost on true
     where item.catalog_version_id = p_catalog_version_id
       and item.is_active
       and item.item_key = 'clinical_core'
       and (
         (
           version_row.modular_cost_settings#>>'{ownership,storageCost}'
             = 'item_direct'
           and cost.storage_cost_per_gb_cents is null
         )
         or (
           version_row.modular_cost_settings#>>'{ownership,egressCost}'
             = 'item_direct'
           and cost.egress_cost_per_gb_cents is null
         )
       )
  ) then
    raise exception 'PRICING_CATALOG_PUBLICATION_BLOCKED:INCLUDED_STORAGE'
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from public.sales_pricing_catalog_items item
      join lateral (
        select cost.*
          from public.sales_pricing_item_cost_models cost
         where cost.catalog_item_id = item.id
         order by cost.version desc
         limit 1
      ) cost on true
      cross join unnest(array['light', 'standard', 'intensive'])
        profile(profile_key)
     where item.catalog_version_id = p_catalog_version_id
       and item.is_active
       and public.sales_modular_cost_category_applies_v2(
         item.item_key,
         'egressCost'
       )
       and version_row.modular_cost_settings#>>'{ownership,egressCost}'
         <> 'excluded'
       and coalesce(
         nullif(
           cost.driver_config#>>array[
             'usageProfileOverrides',
             profile.profile_key,
             'expectedEgressMultiplier'
           ],
           ''
         )::numeric,
         nullif(
           version_row.modular_cost_settings#>>array[
             'usageProfiles',
             profile.profile_key,
             'expectedEgressMultiplier'
           ],
           ''
         )::numeric
       ) is null
  ) then
    raise exception 'PRICING_CATALOG_PUBLICATION_BLOCKED:EGRESS'
      using errcode = '22023';
  end if;
  for duplicate_key in
    select ownership.key
      from jsonb_each_text(
        version_row.modular_cost_settings->'ownership'
      ) ownership
     where ownership.value = 'shared'
       and coalesce(
         char_length(
           btrim(
             version_row.modular_cost_settings#>>array[
               'ownershipJustifications',
               ownership.key
             ]
           )
         ),
         0
       ) < 12
       and public.sales_modular_has_direct_cost_v2(
         p_catalog_version_id,
         ownership.key
       )
  loop
    raise exception 'PRICING_CATALOG_PUBLICATION_BLOCKED:DUPLICATE:%',
      duplicate_key using errcode = '22023';
  end loop;
  if exists (
    select 1
      from public.sales_offer_simulations simulation
     where simulation.catalog_version_id = p_catalog_version_id
       and simulation.simulation_type = 'modular'
       and simulation.model_version = '2026-07-27-v2'
       and coalesce(
         (simulation.results_snapshot->>'totalsReconciled')::boolean,
         false
       ) is false
  ) then
    raise exception 'PRICING_CATALOG_PUBLICATION_BLOCKED:TOTAL_MISMATCH'
      using errcode = '22023';
  end if;
  select jsonb_build_object(
    'version', version_row.version,
    'name', version_row.name,
    'effectiveAt', version_row.effective_at,
    'allocationSettings', version_row.allocation_settings,
    'modularCostSettings', version_row.modular_cost_settings,
    'customCapacityPolicy', version_row.custom_capacity_policy,
    'items', coalesce(
      jsonb_agg(
        to_jsonb(item) || jsonb_build_object(
          'tiers', (
            select coalesce(
              jsonb_agg(to_jsonb(tier) order by tier.sort_order),
              '[]'::jsonb
            )
              from public.sales_pricing_catalog_tiers tier
             where tier.catalog_item_id = item.id
          ),
          'costModels', (
            select coalesce(
              jsonb_agg(to_jsonb(cost_model) order by cost_model.version),
              '[]'::jsonb
            )
              from public.sales_pricing_item_cost_models cost_model
             where cost_model.catalog_item_id = item.id
          )
        )
        order by item.sort_order
      ),
      '[]'::jsonb
    )
  ) into snapshot
    from public.sales_pricing_catalog_items item
   where item.catalog_version_id = p_catalog_version_id;
  update public.sales_pricing_catalog_versions
     set status = 'archived',
         archived_at = now()
   where status = 'active'
     and id <> p_catalog_version_id;
  update public.sales_pricing_catalog_versions
     set status = 'active',
         published_by = p_actor_user_id,
         published_at = now(),
         effective_at = now(),
         catalog_snapshot = snapshot
   where id = p_catalog_version_id
   returning * into version_row;
  insert into public.sales_pricing_catalog_audit_events (
    catalog_version_id,
    event_type,
    actor_user_id,
    payload,
    idempotency_key
  ) values (
    p_catalog_version_id,
    'catalog_published_v2',
    p_actor_user_id,
    jsonb_build_object(
      'version',
      version_row.version,
      'modelVersion',
      '2026-07-28-v3'
    ),
    p_idempotency_key
  )
  on conflict (idempotency_key) do nothing;
  return to_jsonb(version_row);
end
$function$;

revoke all on function public.sales_custom_capacity_policy_valid_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.sales_custom_capacity_policy_valid_v1(jsonb)
  to service_role;

revoke all on function public.clone_sales_pricing_catalog_version_v2(
  uuid, text, uuid, text
) from public, anon, authenticated;
revoke all on function public.save_sales_pricing_catalog_draft_v2(
  uuid, text, jsonb, uuid, text
) from public, anon, authenticated;
revoke all on function public.publish_sales_pricing_catalog_version_v2(
  uuid, uuid, text
) from public, anon, authenticated;

grant execute on function public.clone_sales_pricing_catalog_version_v2(
  uuid, text, uuid, text
) to service_role;
grant execute on function public.save_sales_pricing_catalog_draft_v2(
  uuid, text, jsonb, uuid, text
) to service_role;
grant execute on function public.publish_sales_pricing_catalog_version_v2(
  uuid, uuid, text
) to service_role;

alter table public.sales_offers
  add column if not exists accepted_terms_at timestamptz,
  add column if not exists accepted_terms_snapshot jsonb;

create table if not exists public.sales_offer_item_discounts (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.sales_offers(id) on delete restrict,
  offer_item_id uuid references public.sales_offer_items(id) on delete restrict,
  item_key text not null,
  discount_type text not null check (discount_type in ('percentage','fixed_amount','free')),
  percentage_basis_points integer check (percentage_basis_points between 0 and 10000),
  amount_off_cents integer check (amount_off_cents >= 0),
  starts_at timestamptz not null,
  ends_at timestamptz,
  duration_count integer check (duration_count between 1 and 1200),
  duration_unit text check (duration_unit in ('days','months','billing_cycles')),
  price_before_discount_cents integer not null check (price_before_discount_cents >= 0),
  discounted_price_cents integer not null check (discounted_price_cents >= 0),
  price_after_expiration_cents integer not null check (price_after_expiration_cents >= 0),
  reason text not null,
  internal_notes text,
  status text not null check (status in ('scheduled','active','expired','revoked')),
  snapshot_version integer not null default 1 check (snapshot_version > 0),
  snapshot jsonb not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_offer_item_discount_dates check (ends_at is null or ends_at > starts_at),
  constraint sales_offer_item_discount_duration check (
    (duration_count is null and duration_unit is null)
    or (duration_count is not null and duration_unit is not null)
  ),
  constraint sales_offer_item_discount_reason check (char_length(trim(reason)) >= 3),
  constraint sales_offer_item_discount_kind check (
    (
      discount_type = 'percentage'
      and percentage_basis_points is not null
      and amount_off_cents is null
    )
    or (
      discount_type = 'fixed_amount'
      and percentage_basis_points is null
      and amount_off_cents is not null
      and amount_off_cents <= price_before_discount_cents
    )
    or (
      discount_type = 'free'
      and percentage_basis_points is null
      and amount_off_cents is null
      and discounted_price_cents = 0
    )
  ),
  constraint sales_offer_item_discount_price check (
    discounted_price_cents <= price_before_discount_cents
    and price_after_expiration_cents = price_before_discount_cents
  ),
  unique (offer_id, item_key, snapshot_version)
);

create index if not exists idx_sales_offer_item_discounts_due
  on public.sales_offer_item_discounts (status, ends_at)
  where status in ('scheduled','active') and ends_at is not null;
create index if not exists idx_sales_offer_item_discounts_offer
  on public.sales_offer_item_discounts (offer_id, item_key);

create or replace function public.enrich_sales_modular_offer_snapshot_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare simulation_row public.sales_offer_simulations%rowtype;
begin
  if new.offer_type <> 'modular' or new.simulation_id is null then return new; end if;
  select * into simulation_row
  from public.sales_offer_simulations
  where id = new.simulation_id and lead_id = new.lead_id;
  if not found then raise exception 'PROPOSAL_SIMULATION_INVALID'; end if;
  new.modular_snapshot := coalesce(new.modular_snapshot, '{}'::jsonb)
    || jsonb_build_object(
      'modelVersion', simulation_row.model_version,
      'assumptionSetId', simulation_row.assumption_set_id,
      'assumptionsSnapshotVersion', simulation_row.assumptions_snapshot->'version',
      'input', simulation_row.modular_input_snapshot,
      'capacity', simulation_row.results_snapshot#>'{basePackage,capacity}',
      'commercialPhases', simulation_row.results_snapshot->'commercialPhases',
      'horizons', simulation_row.results_snapshot->'horizons'
    );
  return new;
end;
$$;
drop trigger if exists enrich_sales_modular_offer_snapshot_v1 on public.sales_offers;
create trigger enrich_sales_modular_offer_snapshot_v1
before insert on public.sales_offers
for each row execute function public.enrich_sales_modular_offer_snapshot_v1();

create or replace function public.persist_sales_offer_item_discount_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare discount jsonb;
begin
  discount := new.internal_result_snapshot->'offerDiscount';
  if discount is null or discount = 'null'::jsonb then return new; end if;
  insert into public.sales_offer_item_discounts (
    offer_id, offer_item_id, item_key, discount_type,
    percentage_basis_points, amount_off_cents, starts_at, ends_at,
    duration_count, duration_unit, price_before_discount_cents,
    discounted_price_cents, price_after_expiration_cents, reason,
    internal_notes, status, snapshot, created_by
  )
  select new.offer_id, new.id, new.item_key, discount->>'type',
    nullif(discount->>'percentageBasisPoints', '')::integer,
    nullif(discount->>'amountOffCents', '')::integer,
    (discount->>'startsAt')::timestamptz,
    nullif(discount->>'endsAt', '')::timestamptz,
    nullif(discount->>'durationCount', '')::integer,
    nullif(discount->>'durationUnit', ''),
    (discount->>'priceBeforeDiscountCents')::integer,
    (discount->>'discountedPriceCents')::integer,
    (discount->>'priceAfterExpirationCents')::integer,
    discount->>'reason', nullif(discount->>'internalNotes', ''),
    discount->>'status', discount, offer.created_by
  from public.sales_offers offer where offer.id = new.offer_id
  on conflict (offer_id, item_key, snapshot_version) do nothing;
  return new;
end;
$$;
drop trigger if exists persist_sales_offer_item_discount_v1 on public.sales_offer_items;
create trigger persist_sales_offer_item_discount_v1
after insert on public.sales_offer_items
for each row execute function public.persist_sales_offer_item_discount_v1();

create table if not exists public.sales_checkout_links (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.sales_offers(id) on delete restrict,
  lead_id uuid not null references public.sales_leads(id) on delete restrict,
  environment text not null check (environment in ('test','live')),
  status text not null default 'active'
    check (status in ('active','sent','opened','payment_pending','completed','expired','failed')),
  request_hash text not null check (length(request_hash) = 64),
  idempotency_key text not null,
  stripe_checkout_session_id text,
  stripe_subscription_id text,
  stripe_schedule_id text,
  stripe_customer_id text,
  checkout_url text,
  public_token_hash text check (public_token_hash is null or length(public_token_hash) = 64),
  catalog_snapshot_version text not null,
  assumptions_snapshot_version text not null,
  checkout_plan_snapshot jsonb not null,
  initial_amount_cents integer not null check (initial_amount_cents >= 0),
  promotional_monthly_cents integer not null check (promotional_monthly_cents >= 0),
  future_monthly_cents integer not null check (future_monthly_cents >= 0),
  one_time_cents integer not null check (one_time_cents >= 0),
  expires_at timestamptz,
  last_opened_at timestamptz,
  payment_completed_at timestamptz,
  logically_expired_at timestamptz,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (created_by, idempotency_key),
  unique (stripe_checkout_session_id)
);

alter table public.sales_checkout_links
  add column if not exists public_token_hash text;
alter table public.sales_checkout_links
  drop constraint if exists sales_checkout_links_public_token_hash_check;
alter table public.sales_checkout_links
  add constraint sales_checkout_links_public_token_hash_check
  check (public_token_hash is null or length(public_token_hash) = 64);
create unique index if not exists idx_sales_checkout_links_public_token
  on public.sales_checkout_links (public_token_hash)
  where public_token_hash is not null;

create unique index if not exists idx_sales_checkout_links_one_active
  on public.sales_checkout_links (offer_id, environment)
  where status in ('active','sent','opened','payment_pending');
create index if not exists idx_sales_checkout_links_offer_history
  on public.sales_checkout_links (offer_id, created_at desc);

alter table public.sales_discount_notifications
  add column if not exists offer_id uuid
    references public.sales_offers(id) on delete cascade,
  add column if not exists subscription_discount_id uuid
    references public.sales_subscription_discounts(id) on delete cascade,
  add column if not exists notification_window text,
  add column if not exists discount_ends_at timestamptz,
  add column if not exists notification_window_days integer,
  add column if not exists status text not null default 'pending',
  add column if not exists offer_item_discount_id uuid
    references public.sales_offer_item_discounts(id) on delete cascade,
  add column if not exists notification_type text,
  add column if not exists recipient_scope text not null default 'internal',
  add column if not exists scheduled_for timestamptz;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales_discount_notifications'
      and column_name = 'subscription_id'
  ) then
    alter table public.sales_discount_notifications
      alter column subscription_id drop not null;
  end if;
  alter table public.sales_discount_notifications
    alter column subscription_discount_id drop not null;
end $$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.sales_discount_notifications'::regclass
      and conname = 'sales_discount_notifications_window_check'
  ) then
    alter table public.sales_discount_notifications
      drop constraint sales_discount_notifications_window_check;
  end if;
end $$;

alter table public.sales_discount_notifications
  drop constraint if exists sales_discount_notifications_type_check;
alter table public.sales_discount_notifications
  add constraint sales_discount_notifications_type_check
  check (notification_type is null or notification_type in (
    'before_end','ends_today','normal_price_applied'
  ));
alter table public.sales_discount_notifications
  drop constraint if exists sales_discount_notifications_status_check;
alter table public.sales_discount_notifications
  add constraint sales_discount_notifications_status_check
  check (status in ('pending','processing','sent','failed','cancelled'));

create or replace function public.schedule_offer_item_discount_notifications_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare window_days integer;
declare notification_kind text;
begin
  if new.ends_at is null or new.status = 'revoked' then return new; end if;
  foreach window_days in array array[30,15,7,0,-1]
  loop
    notification_kind := case
      when window_days > 0 then 'before_end'
      when window_days = 0 then 'ends_today'
      else 'normal_price_applied'
    end;
    insert into public.sales_discount_notifications (
      offer_id, subscription_discount_id, discount_ends_at,
      notification_window, notification_window_days, notification_type, recipient_scope,
      scheduled_for, status, idempotency_key, offer_item_discount_id
    ) values (
      new.offer_id, null, new.ends_at, window_days::text || 'd', window_days, notification_kind,
      'owner_internal_and_client', new.ends_at - make_interval(days => window_days),
      'pending', 'offer-item-discount:' || new.id::text || ':' || window_days::text,
      new.id
    ) on conflict (idempotency_key) do nothing;
  end loop;
  return new;
end;
$$;
drop trigger if exists schedule_offer_item_discount_notifications_v1
  on public.sales_offer_item_discounts;
create trigger schedule_offer_item_discount_notifications_v1
after insert on public.sales_offer_item_discounts
for each row execute function public.schedule_offer_item_discount_notifications_v1();

-- Reusable clinical templates. Existing template rows remain valid.
alter table public.aba_program_templates
  add column if not exists specialty text,
  add column if not exists tags text[] not null default '{}'::text[],
  add column if not exists structure_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists template_version integer not null default 1,
  add column if not exists parent_template_id text references public.aba_program_templates(id) on delete set null,
  add column if not exists visibility text,
  add column if not exists archived_at timestamptz,
  add column if not exists contains_identifiable_content boolean not null default false,
  add column if not exists privacy_warning_acknowledged_at timestamptz;

update public.aba_program_templates
set visibility = case when source_scope = 'PERSONAL' then 'private' else 'clinic' end
where visibility is null;
alter table public.aba_program_templates
  alter column visibility set default 'clinic',
  alter column visibility set not null;

alter table public.aba_program_templates
  drop constraint if exists aba_program_templates_visibility_check;
alter table public.aba_program_templates
  add constraint aba_program_templates_visibility_check
  check (visibility in ('private','clinic'));

create table if not exists public.aba_program_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id text not null references public.aba_program_templates(id) on delete restrict,
  organization_id text not null,
  clinic_id text not null,
  version integer not null check (version > 0),
  snapshot jsonb not null,
  change_reason text,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (template_id, version)
);
create index if not exists idx_aba_template_versions_history
  on public.aba_program_template_versions (organization_id, template_id, version desc);

-- Up to five active professionals per patient; all identifiers follow the
-- project's existing text/uuid compatibility boundaries.
create table if not exists public.patient_professional_links (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete restrict,
  professional_id text not null,
  specialty text not null,
  case_role text not null,
  relationship_type text not null check (relationship_type in ('primary','collaborator')),
  starts_at date not null default current_date,
  ends_at date,
  status text not null default 'active' check (status in ('active','ended')),
  permissions jsonb not null default '{"read":true,"write":true,"historicalRead":true}'::jsonb,
  created_by text not null,
  ended_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_professional_link_dates check (ends_at is null or ends_at >= starts_at),
  constraint patient_professional_link_permissions check (
    jsonb_typeof(permissions) = 'object'
    and (not (permissions ? 'read') or jsonb_typeof(permissions->'read') = 'boolean')
    and (not (permissions ? 'write') or jsonb_typeof(permissions->'write') = 'boolean')
    and (not (permissions ? 'historicalRead') or jsonb_typeof(permissions->'historicalRead') = 'boolean')
  )
);
create unique index if not exists idx_patient_professional_links_active_unique
  on public.patient_professional_links (organization_id, patient_id, professional_id)
  where status = 'active';
create unique index if not exists idx_patient_professional_links_one_primary
  on public.patient_professional_links (organization_id, patient_id)
  where status = 'active' and relationship_type = 'primary';
create index if not exists idx_patient_professional_links_patient
  on public.patient_professional_links (organization_id, patient_id, status, created_at);
create index if not exists idx_patient_professional_links_professional
  on public.patient_professional_links (organization_id, professional_id, status, patient_id);

create or replace function public.enforce_patient_professional_link_limit_v1()
returns trigger
language plpgsql
set search_path = public
as $$
declare active_count integer;
begin
  if new.status <> 'active' then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.organization_id || ':' || new.patient_id::text, 0));
  select count(*) into active_count
  from public.patient_professional_links link
  where link.organization_id = new.organization_id
    and link.patient_id = new.patient_id
    and link.status = 'active'
    and link.id <> new.id;
  if active_count >= 5 then raise exception 'PATIENT_PROFESSIONAL_LINK_LIMIT_REACHED'; end if;
  return new;
end;
$$;
drop trigger if exists enforce_patient_professional_link_limit_v1 on public.patient_professional_links;
create trigger enforce_patient_professional_link_limit_v1
before insert or update of status, patient_id, organization_id
on public.patient_professional_links
for each row execute function public.enforce_patient_professional_link_limit_v1();

create or replace function public.upsert_patient_professional_link_v1(
  p_actor_id uuid,
  p_patient_id uuid,
  p_professional_id uuid,
  p_specialty text,
  p_case_role text,
  p_relationship_type text,
  p_starts_at date,
  p_permissions jsonb,
  p_replace_primary boolean default false
)
returns public.patient_professional_links
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare actor public.users%rowtype;
declare patient_row public.patients%rowtype;
declare created_row public.patient_professional_links%rowtype;
declare primary_link record;
begin
  if auth.uid() is not null and auth.uid() <> p_actor_id then
    raise exception 'PATIENT_PROFESSIONAL_LINK_ACCESS_DENIED';
  end if;
  select * into actor from public.users where id = p_actor_id;
  if not found or actor.role not in ('coordinator','admin','owner') then
    raise exception 'PATIENT_PROFESSIONAL_LINK_ACCESS_DENIED';
  end if;
  if nullif(trim(p_specialty), '') is null
     or char_length(trim(p_specialty)) < 2
     or nullif(trim(p_case_role), '') is null
     or char_length(trim(p_case_role)) < 2
     or p_relationship_type not in ('primary','collaborator')
     or jsonb_typeof(coalesce(p_permissions, '{}'::jsonb)) <> 'object'
     or exists (
       select 1 from jsonb_object_keys(coalesce(p_permissions, '{}'::jsonb)) key
       where key not in ('read','write','historicalRead')
     )
     or (p_permissions ? 'read' and jsonb_typeof(p_permissions->'read') <> 'boolean')
     or (p_permissions ? 'write' and jsonb_typeof(p_permissions->'write') <> 'boolean')
     or (p_permissions ? 'historicalRead' and jsonb_typeof(p_permissions->'historicalRead') <> 'boolean') then
    raise exception 'PATIENT_PROFESSIONAL_LINK_INVALID';
  end if;
  select * into patient_row from public.patients
  where id = p_patient_id and clinic_id = actor.clinic_id
  for update;
  if not found then raise exception 'PATIENT_NOT_FOUND'; end if;
  if not exists (
    select 1 from public.users professional
    where professional.id = p_professional_id
      and professional.clinic_id = actor.clinic_id
      and professional.role = 'therapist'
  ) then raise exception 'PROFESSIONAL_NOT_FOUND'; end if;
  if exists (
    select 1 from public.patient_professional_links link
    where link.organization_id = actor.clinic_id::text
      and link.patient_id = p_patient_id
      and link.professional_id = p_professional_id::text
      and link.status = 'active'
  ) then raise exception 'PATIENT_PROFESSIONAL_LINK_DUPLICATE'; end if;
  if p_relationship_type = 'primary' and p_replace_primary then
    for primary_link in
      select link.id
      from public.patient_professional_links link
      where link.organization_id = actor.clinic_id::text
        and link.patient_id = p_patient_id
        and link.relationship_type = 'primary'
        and link.status = 'active'
      for update
    loop
      perform public.end_patient_professional_link_v1(
        actor.id,
        primary_link.id,
        p_patient_id,
        current_date
      );
    end loop;
  end if;
  insert into public.patient_professional_links (
    organization_id, clinic_id, patient_id, professional_id, specialty,
    case_role, relationship_type, starts_at, permissions, created_by
  ) values (
    actor.clinic_id::text, actor.clinic_id::text, p_patient_id,
    p_professional_id::text, left(trim(p_specialty), 120),
    left(trim(p_case_role), 160), p_relationship_type,
    coalesce(p_starts_at, current_date), coalesce(p_permissions, '{"read":true,"write":true,"historicalRead":true}'::jsonb),
    actor.id::text
  ) returning * into created_row;
  if p_relationship_type = 'primary' then
    update public.patients set therapist_id = p_professional_id
    where id = p_patient_id and clinic_id = actor.clinic_id;
  end if;
  return created_row;
end;
$$;

create or replace function public.end_patient_professional_link_v1(
  p_actor_id uuid,
  p_link_id uuid,
  p_patient_id uuid,
  p_ends_at date default current_date
)
returns public.patient_professional_links
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare actor public.users%rowtype;
declare ended_row public.patient_professional_links%rowtype;
begin
  if auth.uid() is not null and auth.uid() <> p_actor_id then
    raise exception 'PATIENT_PROFESSIONAL_LINK_ACCESS_DENIED';
  end if;
  select * into actor from public.users where id = p_actor_id;
  if not found or actor.role not in ('coordinator','admin','owner') then
    raise exception 'PATIENT_PROFESSIONAL_LINK_ACCESS_DENIED';
  end if;
  update public.patient_professional_links link
  set status = 'ended', ends_at = greatest(coalesce(p_ends_at, current_date), link.starts_at),
    ended_by = actor.id::text, updated_at = now()
  where link.id = p_link_id
    and link.patient_id = p_patient_id
    and link.organization_id = actor.clinic_id::text
    and link.status = 'active'
  returning * into ended_row;
  if not found then raise exception 'PATIENT_PROFESSIONAL_LINK_NOT_FOUND'; end if;
  if ended_row.relationship_type = 'primary' then
    update public.patients
    set therapist_id = null
    where id = ended_row.patient_id
      and clinic_id = actor.clinic_id
      and therapist_id::text = ended_row.professional_id;
  end if;
  if ended_row.permissions->'historicalRead' = 'true'::jsonb then
    insert into public.patient_therapeutic_plan_versions (
      plan_id, organization_id, patient_id, version, snapshot, authored_by,
      authorized_reader_ids
    )
    select plan.id, plan.organization_id, plan.patient_id, plan.edit_version,
      to_jsonb(plan) || jsonb_build_object(
        'historicalAccessEndedAt', now(),
        'historicalProfessionalId', ended_row.professional_id
      ), actor.id::text,
      array(
        select distinct readers.reader_id
        from unnest(
          array[plan.responsible_professional_id, ended_row.professional_id]
          || coalesce(plan.participant_professional_ids, '{}'::text[])
        ) as readers(reader_id)
        where nullif(readers.reader_id, '') is not null
      )
    from public.patient_therapeutic_plans plan
    where plan.organization_id = actor.clinic_id::text
      and plan.patient_id = ended_row.patient_id
      and (
        plan.responsible_professional_id = ended_row.professional_id
        or ended_row.professional_id = any(plan.participant_professional_ids)
      )
    on conflict (plan_id, version) do nothing;
  end if;
  return ended_row;
end;
$$;

insert into public.patient_professional_links (
  organization_id, clinic_id, patient_id, professional_id, specialty,
  case_role, relationship_type, starts_at, status, created_by
)
select p.clinic_id::text, p.clinic_id::text, p.id, p.therapist_id::text,
  coalesce(
    nullif(trim(to_jsonb(u)#>>'{metadata,professionalTitle}'), ''),
    nullif(trim(to_jsonb(u)#>>'{metadata,professional_title}'), ''),
    'Especialidade não informada'
  ),
  'Profissional responsável', 'primary', current_date, 'active', p.therapist_id::text
from public.patients p
left join public.users u on u.id = p.therapist_id
where p.therapist_id is not null
on conflict do nothing;

-- Plan containers avoid overloading individual ABA programs and preserve
-- independent copies and optimistic edit versions.
create table if not exists public.patient_therapeutic_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete restrict,
  mode text not null check (mode in ('specialty','interdisciplinary')),
  specialty text,
  responsible_professional_id text not null,
  participant_professional_ids text[] not null default '{}'::text[],
  participant_specialties text[] not null default '{}'::text[],
  common_objectives jsonb not null default '[]'::jsonb,
  specialty_objectives jsonb not null default '{}'::jsonb,
  scope_snapshot jsonb not null default '{}'::jsonb,
  source_template_id text references public.aba_program_templates(id) on delete set null,
  source_template_version integer,
  status text not null default 'draft' check (status in ('draft','active','paused','completed','archived')),
  edit_version integer not null default 1 check (edit_version > 0),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint therapeutic_plan_mode_scope check (
    (mode = 'specialty' and specialty is not null)
    or (mode = 'interdisciplinary' and specialty is null)
  )
);
create unique index if not exists idx_therapeutic_plan_active_specialty
  on public.patient_therapeutic_plans (organization_id, patient_id, lower(specialty))
  where mode = 'specialty' and status in ('draft','active','paused');
create index if not exists idx_therapeutic_plans_patient
  on public.patient_therapeutic_plans (organization_id, patient_id, status, updated_at desc);

create table if not exists public.patient_therapeutic_plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.patient_therapeutic_plans(id) on delete restrict,
  organization_id text not null,
  patient_id uuid not null references public.patients(id) on delete restrict,
  version integer not null,
  snapshot jsonb not null,
  authored_by text not null,
  authorized_reader_ids text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  unique (plan_id, version)
);
alter table public.patient_therapeutic_plan_versions
  add column if not exists authorized_reader_ids text[] not null default '{}'::text[];
alter table public.aba_programs
  add column if not exists therapeutic_plan_id uuid references public.patient_therapeutic_plans(id) on delete set null,
  add column if not exists source_template_id text references public.aba_program_templates(id) on delete set null,
  add column if not exists source_template_version integer;

create or replace function public.attach_aba_program_scope_v1()
returns trigger
language plpgsql
set search_path = public
as $$
declare requested_plan_id uuid;
begin
  begin
    requested_plan_id := coalesce(
      new.therapeutic_plan_id,
      nullif(new.advanced_settings->>'therapeuticPlanId', '')::uuid
    );
  exception when others then
    raise exception 'THERAPEUTIC_PLAN_SCOPE_INVALID';
  end;
  if requested_plan_id is null then return new; end if;
  if not exists (
    select 1 from public.patient_therapeutic_plans plan
    where plan.id = requested_plan_id
      and plan.organization_id = new.organization_id
      and plan.patient_id = new.patient_id
      and plan.status <> 'archived'
  ) then raise exception 'THERAPEUTIC_PLAN_SCOPE_INVALID'; end if;
  new.therapeutic_plan_id := requested_plan_id;
  return new;
end;
$$;
drop trigger if exists attach_aba_program_scope_v1 on public.aba_programs;
create trigger attach_aba_program_scope_v1
before insert or update of therapeutic_plan_id, advanced_settings on public.aba_programs
for each row execute function public.attach_aba_program_scope_v1();

create or replace function public.snapshot_aba_program_template_version_v1()
returns trigger
language plpgsql
set search_path = public
as $$
declare template_row public.aba_program_templates%rowtype;
begin
  if new.origin_type <> 'template' or nullif(new.origin_id, '') is null then
    return new;
  end if;
  select * into template_row
  from public.aba_program_templates template
  where template.id = new.origin_id
    and (
      template.source_scope = 'VERTO'
      or template.organization_id = new.organization_id
    );
  if not found then raise exception 'THERAPEUTIC_TEMPLATE_NOT_FOUND'; end if;
  new.source_template_id := template_row.id;
  new.source_template_version := template_row.template_version;
  return new;
end;
$$;
drop trigger if exists snapshot_aba_program_template_version_v1 on public.aba_programs;
create trigger snapshot_aba_program_template_version_v1
before insert on public.aba_programs
for each row execute function public.snapshot_aba_program_template_version_v1();

-- Immutable attribution on new ABA records. Old ambiguous data is labelled,
-- never reinterpreted after a professional changes specialty.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'aba_sessions','aba_trials','aba_behavior_events','aba_interval_records',
    'aba_interval_summaries','aba_abc_events','aba_session_summaries',
    'aba_session_metric_snapshots','aba_maintenance_probe_results'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('alter table public.%I add column if not exists professional_id_snapshot text', table_name);
      execute format('alter table public.%I add column if not exists specialty_snapshot text', table_name);
      execute format('alter table public.%I add column if not exists specialty_source text', table_name);
      execute format('alter table public.%I add column if not exists organization_id_snapshot text', table_name);
      execute format('alter table public.%I add column if not exists session_id_snapshot text', table_name);
      execute format('create index if not exists %I on public.%I (clinic_id, patient_id, specialty_snapshot)',
        'idx_' || table_name || '_specialty', table_name);
    end if;
  end loop;
end $$;

alter table public.aba_session_metric_snapshots
  add column if not exists aggregation_weight_snapshot numeric(12,4);
alter table public.aba_session_metric_snapshots
  drop constraint if exists aba_session_metric_snapshot_weight_check;
alter table public.aba_session_metric_snapshots
  add constraint aba_session_metric_snapshot_weight_check
  check (aggregation_weight_snapshot is null or aggregation_weight_snapshot > 0);

create or replace function public.snapshot_aba_metric_aggregation_weight_v1()
returns trigger
language plpgsql
set search_path = public
as $$
declare resolved_weight numeric;
begin
  if new.aggregation_weight_snapshot is not null then return new; end if;
  if new.metric_type in ('TARGET_ACCURACY', 'TARGET_INDEPENDENCE') then
    select count(*)::numeric into resolved_weight
    from public.aba_trials trial
    where trial.clinic_id = new.clinic_id
      and trial.patient_id = new.patient_id
      and trial.session_id = new.session_id
      and trial.target_id is not distinct from new.target_id;
  elsif new.metric_type = 'BEHAVIOR_INTERVAL_OCCURRENCE' then
    select sum(summary.total_intervals)::numeric into resolved_weight
    from public.aba_interval_summaries summary
    where summary.clinic_id = new.clinic_id
      and summary.patient_id = new.patient_id
      and summary.session_id = new.session_id
      and summary.behavior_id is not distinct from new.behavior_id;
  elsif new.metric_type = 'BEHAVIOR_DURATION_AVG' then
    select count(*)::numeric into resolved_weight
    from public.aba_behavior_events event
    where event.clinic_id = new.clinic_id
      and event.patient_id = new.patient_id
      and event.session_id = new.session_id
      and event.behavior_id is not distinct from new.behavior_id
      and event.duration_seconds is not null;
  end if;
  new.aggregation_weight_snapshot := nullif(resolved_weight, 0);
  return new;
end;
$$;

drop trigger if exists snapshot_aba_metric_aggregation_weight_v1
  on public.aba_session_metric_snapshots;
create trigger snapshot_aba_metric_aggregation_weight_v1
before insert on public.aba_session_metric_snapshots
for each row execute function public.snapshot_aba_metric_aggregation_weight_v1();

update public.aba_session_metric_snapshots snapshot
set aggregation_weight_snapshot = case
  when snapshot.metric_type in ('TARGET_ACCURACY', 'TARGET_INDEPENDENCE') then nullif((
    select count(*)::numeric from public.aba_trials trial
    where trial.clinic_id = snapshot.clinic_id
      and trial.patient_id = snapshot.patient_id
      and trial.session_id = snapshot.session_id
      and trial.target_id is not distinct from snapshot.target_id
  ), 0)
  when snapshot.metric_type = 'BEHAVIOR_INTERVAL_OCCURRENCE' then nullif((
    select sum(summary.total_intervals)::numeric from public.aba_interval_summaries summary
    where summary.clinic_id = snapshot.clinic_id
      and summary.patient_id = snapshot.patient_id
      and summary.session_id = snapshot.session_id
      and summary.behavior_id is not distinct from snapshot.behavior_id
  ), 0)
  when snapshot.metric_type = 'BEHAVIOR_DURATION_AVG' then nullif((
    select count(*)::numeric from public.aba_behavior_events event
    where event.clinic_id = snapshot.clinic_id
      and event.patient_id = snapshot.patient_id
      and event.session_id = snapshot.session_id
      and event.behavior_id is not distinct from snapshot.behavior_id
      and event.duration_seconds is not null
  ), 0)
  else null
end
where snapshot.aggregation_weight_snapshot is null;

create or replace function public.snapshot_aba_specialty_v1()
returns trigger
language plpgsql
set search_path = public
as $$
declare resolved_professional text;
declare resolved_specialty text;
begin
  new.organization_id_snapshot := coalesce(
    new.organization_id_snapshot,
    to_jsonb(new)->>'organization_id',
    new.clinic_id::text
  );
  new.session_id_snapshot := coalesce(
    new.session_id_snapshot,
    to_jsonb(new)->>'session_id',
    case when tg_table_name = 'aba_sessions' then to_jsonb(new)->>'id' else null end
  );
  if new.specialty_snapshot is not null then return new; end if;
  resolved_professional := coalesce(new.professional_id_snapshot, to_jsonb(new)->>'therapist_id');
  if resolved_professional is null and nullif(to_jsonb(new)->>'session_id', '') is not null then
    select session.therapist_id into resolved_professional
    from public.aba_sessions session
    where session.id = to_jsonb(new)->>'session_id'
      and session.patient_id = new.patient_id
      and session.clinic_id = new.clinic_id::text
    limit 1;
  end if;
  select link.specialty into resolved_specialty
  from public.patient_professional_links link
  where link.organization_id = new.clinic_id::text
    and link.patient_id = new.patient_id
    and link.professional_id = resolved_professional
    and link.status = 'active'
  order by (link.relationship_type = 'primary') desc, link.created_at
  limit 1;
  new.professional_id_snapshot := resolved_professional;
  new.specialty_snapshot := coalesce(resolved_specialty, 'Especialidade não informada');
  new.specialty_source := case when resolved_specialty is null then 'unavailable' else 'patient_professional_link' end;
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'aba_sessions','aba_trials','aba_behavior_events','aba_interval_records',
    'aba_interval_summaries','aba_abc_events','aba_session_summaries',
    'aba_session_metric_snapshots','aba_maintenance_probe_results'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop trigger if exists snapshot_aba_specialty_v1 on public.%I', table_name);
      execute format('create trigger snapshot_aba_specialty_v1 before insert on public.%I for each row execute function public.snapshot_aba_specialty_v1()', table_name);
      execute format($sql$
        update public.%I record
        set specialty_snapshot = coalesce(record.specialty_snapshot, (
          select min(link.specialty)
          from public.patient_professional_links link
          where link.organization_id = record.clinic_id::text
            and link.patient_id = record.patient_id
            and link.professional_id = coalesce(
              record.professional_id_snapshot,
              to_jsonb(record)->>'therapist_id',
              (select session.therapist_id from public.aba_sessions session
               where session.id = to_jsonb(record)->>'session_id'
                 and session.patient_id = record.patient_id
                 and session.clinic_id = record.clinic_id::text
               limit 1)
            )
          having count(distinct link.specialty) = 1
        ), 'Especialidade não informada'),
        professional_id_snapshot = coalesce(
          record.professional_id_snapshot,
          to_jsonb(record)->>'therapist_id',
          (select session.therapist_id from public.aba_sessions session
           where session.id = to_jsonb(record)->>'session_id'
             and session.patient_id = record.patient_id
             and session.clinic_id = record.clinic_id::text
           limit 1)
        ),
        specialty_source = coalesce(record.specialty_source, 'historical_backfill')
        ,organization_id_snapshot = coalesce(
          record.organization_id_snapshot,
          to_jsonb(record)->>'organization_id',
          record.clinic_id::text
        )
        ,session_id_snapshot = coalesce(
          record.session_id_snapshot,
          to_jsonb(record)->>'session_id',
          case when %L = 'aba_sessions' then to_jsonb(record)->>'id' else null end
        )
        where record.specialty_snapshot is null
           or record.organization_id_snapshot is null
           or record.session_id_snapshot is null
      $sql$, table_name, table_name);
    end if;
  end loop;
end $$;

-- RLS: new structures are tenant-scoped. Commercial payment links stay
-- service-role-only; owners use validated backend routes.
alter table public.sales_offer_item_discounts enable row level security;
alter table public.sales_checkout_links enable row level security;
alter table public.aba_program_template_versions enable row level security;
alter table public.patient_professional_links enable row level security;
alter table public.patient_therapeutic_plans enable row level security;
alter table public.patient_therapeutic_plan_versions enable row level security;

revoke all on public.sales_offer_item_discounts, public.sales_checkout_links from anon, authenticated;
grant all on public.sales_offer_item_discounts, public.sales_checkout_links to service_role;

-- Visibility is enforced in RLS as well as in the API. A private model is
-- visible only to its owner; a clinic model follows the existing publication
-- and management rules. Verto-owned templates remain read-only.
drop policy if exists aba_program_templates_read on public.aba_program_templates;
create policy aba_program_templates_read on public.aba_program_templates
for select to authenticated
using (
  (source_scope = 'VERTO' and status = 'PUBLISHED')
  or exists (
    select 1 from public.users actor
    where actor.id = auth.uid()
      and actor.clinic_id::text = aba_program_templates.organization_id
      and (
        (
          aba_program_templates.visibility = 'clinic'
          and aba_program_templates.source_scope = 'CLINIC'
          and (
            aba_program_templates.status = 'PUBLISHED'
            or actor.role in ('owner', 'admin', 'coordinator')
          )
        )
        or (
          aba_program_templates.visibility = 'private'
          and aba_program_templates.owner_user_id = actor.id::text
        )
      )
  )
);

drop policy if exists aba_program_templates_manage on public.aba_program_templates;
create policy aba_program_templates_manage on public.aba_program_templates
for all to authenticated
using (
  source_scope <> 'VERTO'
  and exists (
    select 1 from public.users actor
    where actor.id = auth.uid()
      and actor.clinic_id::text = aba_program_templates.organization_id
      and (
        actor.role in ('owner', 'admin', 'coordinator')
        or (
          aba_program_templates.visibility = 'private'
          and aba_program_templates.owner_user_id = actor.id::text
        )
      )
  )
)
with check (
  source_scope <> 'VERTO'
  and exists (
    select 1 from public.users actor
    where actor.id = auth.uid()
      and actor.clinic_id::text = aba_program_templates.organization_id
      and (
        actor.role in ('owner', 'admin', 'coordinator')
        or (
          aba_program_templates.visibility = 'private'
          and aba_program_templates.owner_user_id = actor.id::text
        )
      )
  )
);

drop policy if exists aba_program_template_versions_tenant_select
  on public.aba_program_template_versions;
create policy aba_program_template_versions_tenant_select
on public.aba_program_template_versions for select to authenticated using (
  exists (
    select 1
    from public.users actor
    join public.aba_program_templates template
      on template.id = aba_program_template_versions.template_id
    where actor.id = auth.uid()
      and actor.clinic_id::text = aba_program_template_versions.organization_id
      and (
        template.visibility = 'clinic'
        or template.owner_user_id = actor.id::text
      )
  )
);

drop policy if exists patient_professional_links_tenant_select
  on public.patient_professional_links;
create policy patient_professional_links_tenant_select
on public.patient_professional_links for select to authenticated using (
  exists (
    select 1 from public.users actor
    where actor.id = auth.uid()
      and actor.clinic_id::text = patient_professional_links.organization_id
      and (
        actor.role in ('coordinator','admin','owner')
        or patient_professional_links.professional_id = actor.id::text
      )
  )
);

drop policy if exists patient_therapeutic_plans_tenant_select
  on public.patient_therapeutic_plans;
create policy patient_therapeutic_plans_tenant_select
on public.patient_therapeutic_plans for select to authenticated using (
  exists (
    select 1 from public.users actor
    where actor.id = auth.uid()
      and actor.clinic_id::text = patient_therapeutic_plans.organization_id
      and (
        actor.role in ('coordinator','admin','owner')
        or actor.id::text = patient_therapeutic_plans.responsible_professional_id
        or actor.id::text = any(patient_therapeutic_plans.participant_professional_ids)
      )
  )
);

drop policy if exists patient_therapeutic_plan_versions_tenant_select
  on public.patient_therapeutic_plan_versions;
create policy patient_therapeutic_plan_versions_tenant_select
on public.patient_therapeutic_plan_versions for select to authenticated using (
  exists (
    select 1 from public.users actor
    where actor.id = auth.uid()
      and actor.clinic_id::text = patient_therapeutic_plan_versions.organization_id
      and (
        actor.role in ('coordinator','admin','owner')
        or actor.id::text = any(patient_therapeutic_plan_versions.authorized_reader_ids)
      )
  )
);

drop policy if exists patient_professional_links_tenant_write on public.patient_professional_links;
create policy patient_professional_links_tenant_write
on public.patient_professional_links for all to authenticated
using (exists (
  select 1 from public.users actor
  where actor.id = auth.uid()
    and actor.clinic_id::text = patient_professional_links.organization_id
    and actor.role in ('coordinator','admin','owner')
))
with check (exists (
  select 1 from public.users actor
  where actor.id = auth.uid()
    and actor.clinic_id::text = patient_professional_links.organization_id
    and actor.role in ('coordinator','admin','owner')
));

drop policy if exists patient_therapeutic_plans_tenant_write on public.patient_therapeutic_plans;
create policy patient_therapeutic_plans_tenant_write
on public.patient_therapeutic_plans for all to authenticated
using (exists (
  select 1 from public.users actor
  where actor.id = auth.uid()
    and actor.clinic_id::text = patient_therapeutic_plans.organization_id
    and (
      actor.role in ('coordinator','admin','owner')
      or actor.id::text = patient_therapeutic_plans.responsible_professional_id
      or actor.id::text = any(patient_therapeutic_plans.participant_professional_ids)
    )
))
with check (exists (
  select 1 from public.users actor
  where actor.id = auth.uid()
    and actor.clinic_id::text = patient_therapeutic_plans.organization_id
    and (
      actor.role in ('coordinator','admin','owner')
      or actor.id::text = patient_therapeutic_plans.responsible_professional_id
      or actor.id::text = any(patient_therapeutic_plans.participant_professional_ids)
    )
));

grant select on public.patient_professional_links,
  public.patient_therapeutic_plans to authenticated;
grant select on public.aba_program_template_versions,
  public.patient_therapeutic_plan_versions to authenticated;
grant all on public.aba_program_template_versions,
  public.patient_professional_links, public.patient_therapeutic_plans,
  public.patient_therapeutic_plan_versions to service_role;

revoke all on function public.upsert_patient_professional_link_v1(
  uuid, uuid, uuid, text, text, text, date, jsonb, boolean
) from public, anon;
revoke all on function public.end_patient_professional_link_v1(uuid, uuid, uuid, date)
  from public, anon;
grant execute on function public.upsert_patient_professional_link_v1(
  uuid, uuid, uuid, text, text, text, date, jsonb, boolean
) to authenticated, service_role;
grant execute on function public.end_patient_professional_link_v1(uuid, uuid, uuid, date)
  to authenticated, service_role;

commit;
