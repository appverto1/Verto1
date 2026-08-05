-- Make Fundação Verto the canonical recurring base line for new modular offers.
-- Existing simulations and offers remain immutable; legacy clinical_core-based
-- simulations continue to publish through the fallback below.

begin;

do $migration_guard$
begin
  if to_regclass('public.sales_offer_simulations') is null
     or to_regclass('public.sales_offer_simulation_items') is null
     or to_regclass('public.sales_offers') is null
     or to_regclass('public.sales_offer_items') is null then
    raise exception 'SALES_MODULAR_FOUNDATION_SCHEMA_PENDING'
      using detail = 'Apply the modular proposal schema before this migration';
  end if;
end;
$migration_guard$;

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

  -- New snapshots use the virtual Fundação Verto line. Historical snapshots
  -- without it continue to use clinical_core as the base amount.
  select * into base_line
  from public.sales_offer_simulation_items
  where simulation_id = simulation.id
    and item_key in ('platform_foundation', 'clinical_core')
  order by case item_key
    when 'platform_foundation' then 0
    else 1
  end
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
