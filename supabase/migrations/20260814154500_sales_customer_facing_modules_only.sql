-- Keep shared platform economics internal while customer-facing modular offers
-- contain only actually contracted modules. Onboarding stays structurally
-- available for history, but is not part of new customer-facing compositions.
-- Historical simulations/offers keep presentation version 1 semantics.

begin;

do $migration_guard$
begin
  if to_regclass('public.sales_offer_simulations') is null
     or to_regclass('public.sales_offer_simulation_items') is null
     or to_regclass('public.sales_offers') is null
     or to_regclass('public.sales_offer_items') is null then
    raise exception 'SALES_MODULAR_CUSTOMER_FACING_SCHEMA_PENDING'
      using detail = 'Apply the modular proposal schema before this migration';
  end if;
end;
$migration_guard$;

-- If the short-lived zero-foundation compatibility patch was ever applied,
-- repair only those structural base fields before restoring the original
-- positive-value invariant. Snapshots, item prices and customer totals stay
-- unchanged; the structural base now points to a real contracted module.
do $repair_zero_base$
begin
  update public.sales_offer_simulations simulation
     set base_unit_amount_cents = (
           select item.gross_recurring_amount_cents
             from public.sales_offer_simulation_items item
            where item.simulation_id = simulation.id
              and item.item_key not in ('platform_foundation', 'onboarding')
              and coalesce(item.gross_recurring_amount_cents, 0) > 0
            order by
              case when item.item_key = 'clinical_core' then 0 else 1 end,
              item.sort_order,
              item.id
            limit 1
         ),
         updated_at = now()
   where simulation.simulation_type = 'modular'
     and simulation.base_unit_amount_cents <= 0
     and exists (
       select 1
         from public.sales_offer_simulation_items item
        where item.simulation_id = simulation.id
          and item.item_key not in ('platform_foundation', 'onboarding')
          and coalesce(item.gross_recurring_amount_cents, 0) > 0
     );

  if exists (
    select 1
      from public.sales_offer_simulations simulation
     where simulation.base_unit_amount_cents <= 0
  ) then
    raise exception 'SALES_SIMULATION_POSITIVE_BASE_REPAIR_REQUIRED'
      using detail = 'A simulation without a positive contracted recurring module must be reviewed before restoring the invariant';
  end if;

  update public.sales_offers offer_row
     set base_unit_amount_cents = (
           select item.gross_recurring_amount_cents
             from public.sales_offer_items item
            where item.offer_id = offer_row.id
              and item.item_key not in ('platform_foundation', 'onboarding')
              and coalesce(item.gross_recurring_amount_cents, 0) > 0
            order by
              case when item.item_key = 'clinical_core' then 0 else 1 end,
              item.sort_order,
              item.id
            limit 1
         ),
         updated_at = now()
   where offer_row.offer_type = 'modular'
     and offer_row.base_unit_amount_cents <= 0
     and exists (
       select 1
         from public.sales_offer_items item
        where item.offer_id = offer_row.id
          and item.item_key not in ('platform_foundation', 'onboarding')
          and coalesce(item.gross_recurring_amount_cents, 0) > 0
     );

  if exists (
    select 1
      from public.sales_offers offer_row
     where offer_row.base_unit_amount_cents <= 0
  ) then
    raise exception 'SALES_OFFER_POSITIVE_BASE_REPAIR_REQUIRED'
      using detail = 'An offer without a positive contracted recurring module must be reviewed before restoring the invariant';
  end if;
end;
$repair_zero_base$;

alter table public.sales_offer_simulations
  drop constraint if exists sales_offer_simulations_amount_check;

alter table public.sales_offer_simulations
  add constraint sales_offer_simulations_amount_check
  check (
    base_unit_amount_cents > 0
    and custom_monthly_cost_cents >= 0
    and onboarding_cost_cents >= 0
  ) not valid;

alter table public.sales_offer_simulations
  validate constraint sales_offer_simulations_amount_check;

alter table public.sales_offers
  drop constraint if exists sales_offers_base_amount_check;

alter table public.sales_offers
  drop constraint if exists sales_offers_amount_positive;

alter table public.sales_offers
  add constraint sales_offers_base_amount_check
  check (base_unit_amount_cents > 0) not valid;

alter table public.sales_offers
  validate constraint sales_offers_base_amount_check;

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
  presentation_version integer := 1;
begin
  if p_actor_user_id is null
     or char_length(coalesce(p_idempotency_key, '')) < 12
     or char_length(coalesce(p_request_hash, '')) <> 64
     or char_length(coalesce(p_public_token_hash, '')) <> 64 then
    raise exception 'PROPOSAL_SIMULATION_INVALID' using errcode = '22023';
  end if;

  select * into simulation
  from public.sales_offer_simulations
  where id = p_simulation_id
    and lead_id = p_lead_id
    and simulation_type = 'modular'
    and deleted_at is null
  for update;
  if not found then
    raise exception 'PROPOSAL_SIMULATION_INVALID' using errcode = 'P0002';
  end if;

  select * into existing_offer
  from public.sales_offers
  where created_by = p_actor_user_id
    and idempotency_key = p_idempotency_key;
  if found then
    if existing_offer.request_hash is distinct from p_request_hash
       or existing_offer.simulation_id is distinct from p_simulation_id then
      raise exception 'PROPOSAL_SNAPSHOT_CONFLICT' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'offer', to_jsonb(existing_offer),
      'idempotent', true
    );
  end if;

  if exists (
    select 1
    from public.sales_offers
    where simulation_id = p_simulation_id
  ) then
    select * into existing_offer
    from public.sales_offers
    where simulation_id = p_simulation_id;
    return jsonb_build_object(
      'offer', to_jsonb(existing_offer),
      'idempotent', true
    );
  end if;

  result := simulation.results_snapshot;
  if coalesce(result->>'commercialPresentationVersion', '') ~ '^[0-9]+$' then
    presentation_version := (result->>'commercialPresentationVersion')::integer;
  end if;

  if presentation_version >= 2 then
    -- Defense in depth: a v2 customer-facing simulation may retain the virtual
    -- platform line only as a zero-revenue internal cost carrier. Onboarding is
    -- not accepted in new v2 offers while this commercial option is disabled.
    if exists (
      select 1
      from public.sales_offer_simulation_items item
      where item.simulation_id = simulation.id
        and item.item_key = 'onboarding'
    ) then
      raise exception 'PROPOSAL_INTERNAL_ITEM_NOT_ALLOWED' using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.sales_offer_simulation_items item
      where item.simulation_id = simulation.id
        and item.item_key = 'platform_foundation'
        and (
          coalesce(item.gross_recurring_amount_cents, 0) <> 0
          or coalesce(item.recurring_amount_cents, 0) <> 0
          or coalesce(item.post_promotion_recurring_amount_cents, 0) <> 0
          or coalesce(item.one_time_amount_cents, 0) <> 0
        )
    ) then
      raise exception 'PROPOSAL_INTERNAL_ITEM_NONZERO' using errcode = '22023';
    end if;

    -- sales_offers.base_unit_amount_cents is a legacy required positive field.
    -- For v2 use a real contracted recurring module as the structural base,
    -- preferring clinical_core, without turning the platform into a sale item.
    select * into base_line
    from public.sales_offer_simulation_items item
    where item.simulation_id = simulation.id
      and item.item_key not in ('platform_foundation', 'onboarding')
      and coalesce(item.gross_recurring_amount_cents, 0) > 0
    order by
      case when item.item_key = 'clinical_core' then 0 else 1 end,
      item.sort_order,
      item.id
    limit 1;
  else
    -- Immutable historical behavior: version 1 snapshots can keep Fundação
    -- Verto as the customer-visible recurring base line.
    select * into base_line
    from public.sales_offer_simulation_items item
    where item.simulation_id = simulation.id
      and item.item_key in ('platform_foundation', 'clinical_core')
    order by case item.item_key
      when 'platform_foundation' then 0
      else 1
    end
    limit 1;
  end if;

  if not found then
    raise exception 'PROPOSAL_SIMULATION_INVALID' using errcode = '22023';
  end if;

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
    simulation.lead_id,
    simulation.id,
    jsonb_build_object(
      'catalogVersionId', simulation.catalog_version_id,
      'assumptionSetId', simulation.assumption_set_id,
      'modelVersion', simulation.model_version,
      'input', simulation.modular_input_snapshot,
      'results', simulation.results_snapshot,
      'createdAt', simulation.created_at
    ),
    'ready',
    base_line.gross_recurring_amount_cents,
    simulation.currency,
    simulation.initial_active_patient_quantity,
    simulation.discount_duration_months,
    simulation.discount_type,
    simulation.discount_percentage,
    null,
    (result->>'promotionalRecurringRevenueCents')::integer,
    (result->>'postPromotionRecurringRevenueCents')::integer,
    simulation.internal_justification,
    p_public_token_hash,
    simulation.public_notes,
    p_expires_at,
    p_actor_user_id,
    p_idempotency_key,
    'modular',
    simulation.catalog_version_id,
    simulation.scenario_name,
    simulation.public_notes,
    false,
    jsonb_build_object(
      'commercialPresentationVersion', presentation_version,
      'catalogVersionId', simulation.catalog_version_id,
      'catalogVersion', result->'catalogVersion',
      'basePackage', result->'basePackage',
      'platformFoundation', result->'platformFoundation',
      'commercialPhases', result->'commercialPhases',
      'capacityBlockPhases', result#>'{commercialPricing,capacityBlockPhases}',
      'promotionalRecurringRevenueCents',
        result->'promotionalRecurringRevenueCents',
      'postPromotionRecurringRevenueCents',
        result->'postPromotionRecurringRevenueCents',
      'oneTimeRevenueCents', result->'oneTimeRevenueCents',
      'globalDiscountCents', result->'globalDiscountCents',
      'discountDurationMonths', simulation.discount_duration_months,
      'onboardingInstallments',
        coalesce(
          (simulation.modular_input_snapshot->>'onboardingInstallments')::integer,
          1
        ),
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
  select
    created_offer.id,
    item.id,
    item.catalog_version_id,
    item.catalog_item_id,
    item.tier_id,
    item.item_key,
    item.public_name_snapshot,
    item.public_description_snapshot,
    item.pricing_mode_snapshot,
    item.quantity,
    item.limit_quantity,
    item.included_quantity,
    item.gross_recurring_amount_cents,
    item.recurring_amount_cents,
    item.post_promotion_recurring_amount_cents,
    item.one_time_amount_cents,
    item.item_discount_basis_points,
    item.allocated_global_discount_cents,
    item.public_metadata,
    item.result_snapshot,
    item.sort_order
  from public.sales_offer_simulation_items item
  where item.simulation_id = simulation.id;

  update public.sales_offer_simulations
  set status = 'offered', updated_at = now()
  where id = simulation.id;

  update public.sales_leads
  set status = 'proposal_preparing', updated_at = now()
  where id = simulation.lead_id
    and deleted_at is null;

  insert into public.sales_lead_events (
    lead_id, event_type, actor_user_id, metadata, idempotency_key
  ) values (
    simulation.lead_id,
    'proposal_created',
    p_actor_user_id,
    jsonb_build_object(
      'offer_id', created_offer.id,
      'simulation_id', simulation.id,
      'offer_type', 'modular',
      'catalog_version_id', simulation.catalog_version_id,
      'commercial_presentation_version', presentation_version,
      'base_revenue_line', base_line.item_key
    ),
    'modular-proposal-created:' || created_offer.id::text
  ) on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'offer', to_jsonb(created_offer),
    'idempotent', false
  );
end
$function$;

revoke all on function public.create_sales_modular_offer_v1(
  uuid, uuid, uuid, text, text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.create_sales_modular_offer_v1(
  uuid, uuid, uuid, text, text, text, timestamptz
) to service_role;

notify pgrst, 'reload schema';

commit;
