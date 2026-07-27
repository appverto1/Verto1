-- Teste real de banco para 20260727030000_sales_modular_proposal_builder.sql.
-- Execute como conta administrativa apos aplicar a migration. Tudo e revertido ao final.

begin;

set local statement_timeout = '120s';

do $structure$
declare
  required_relation text;
  required_function text;
begin
  foreach required_relation in array array[
    'sales_pricing_catalog_versions',
    'sales_pricing_catalog_items',
    'sales_pricing_catalog_tiers',
    'sales_pricing_item_cost_models',
    'sales_pricing_catalog_audit_events',
    'sales_offer_simulation_items',
    'sales_offer_items',
    'sales_feature_profitability_summary_v1'
  ] loop
    if to_regclass('public.' || required_relation) is null then
      raise exception 'missing relation: %', required_relation;
    end if;
  end loop;
  foreach required_function in array array[
    'clone_sales_pricing_catalog_version_v1(uuid,text,uuid,text)',
    'save_sales_pricing_catalog_draft_v1(uuid,text,jsonb,uuid,text)',
    'publish_sales_pricing_catalog_version_v1(uuid,uuid,text)',
    'save_sales_modular_simulation_v1(jsonb,jsonb)',
    'create_sales_modular_offer_v1(uuid,uuid,uuid,text,text,text,timestamp with time zone)'
  ] loop
    if to_regprocedure('public.' || required_function) is null then
      raise exception 'missing function: %', required_function;
    end if;
  end loop;
end
$structure$;

do $security$
declare
  relation_name text;
  function_name text;
begin
  foreach relation_name in array array[
    'sales_pricing_catalog_versions',
    'sales_pricing_catalog_items',
    'sales_pricing_catalog_tiers',
    'sales_pricing_item_cost_models',
    'sales_pricing_catalog_audit_events',
    'sales_offer_simulation_items',
    'sales_offer_items',
    'sales_feature_profitability_summary_v1'
  ] loop
    if has_table_privilege('anon', 'public.' || relation_name, 'SELECT')
       or has_table_privilege('authenticated', 'public.' || relation_name, 'SELECT') then
      raise exception 'client role can read internal relation: %', relation_name;
    end if;
    if not has_table_privilege('service_role', 'public.' || relation_name, 'SELECT') then
      raise exception 'service_role cannot read internal relation: %', relation_name;
    end if;
  end loop;
  foreach function_name in array array[
    'clone_sales_pricing_catalog_version_v1(uuid,text,uuid,text)',
    'save_sales_pricing_catalog_draft_v1(uuid,text,jsonb,uuid,text)',
    'publish_sales_pricing_catalog_version_v1(uuid,uuid,text)',
    'save_sales_modular_simulation_v1(jsonb,jsonb)',
    'create_sales_modular_offer_v1(uuid,uuid,uuid,text,text,text,timestamp with time zone)'
  ] loop
    if has_function_privilege('anon', 'public.' || function_name, 'EXECUTE')
       or has_function_privilege('authenticated', 'public.' || function_name, 'EXECUTE') then
      raise exception 'client role can execute internal function: %', function_name;
    end if;
    if not has_function_privilege('service_role', 'public.' || function_name, 'EXECUTE') then
      raise exception 'service_role cannot execute internal function: %', function_name;
    end if;
  end loop;
  foreach function_name in array array[
    'prevent_sales_modular_snapshot_mutation_v1()',
    'protect_sales_modular_simulation_financials_v1()',
    'protect_sales_modular_offer_financials_v1()',
    'protect_sales_catalog_version_v1()',
    'protect_published_sales_catalog_v1()'
  ] loop
    if has_function_privilege('anon', 'public.' || function_name, 'EXECUTE')
       or has_function_privilege('authenticated', 'public.' || function_name, 'EXECUTE') then
      raise exception 'client role can execute trigger helper: %', function_name;
    end if;
  end loop;
  if exists (
    select 1
      from pg_proc
     where oid in (
       'public.clone_sales_pricing_catalog_version_v1(uuid,text,uuid,text)'::regprocedure,
       'public.save_sales_pricing_catalog_draft_v1(uuid,text,jsonb,uuid,text)'::regprocedure,
       'public.publish_sales_pricing_catalog_version_v1(uuid,uuid,text)'::regprocedure,
       'public.save_sales_modular_simulation_v1(jsonb,jsonb)'::regprocedure,
       'public.create_sales_modular_offer_v1(uuid,uuid,uuid,text,text,text,timestamptz)'::regprocedure
     )
       and not (
         prosecdef
         and coalesce(proconfig, array[]::text[])
           @> array['search_path=pg_catalog, public']
       )
  ) then
    raise exception 'security definer function without fixed search_path';
  end if;
end
$security$;

do $initial_catalog$
declare
  active_id uuid;
begin
  if (select count(*) from public.sales_pricing_catalog_versions where status = 'active') <> 1 then
    raise exception 'there must be exactly one active catalog';
  end if;
  select id into active_id
    from public.sales_pricing_catalog_versions
   where status = 'active';
  if (select count(*) from public.sales_pricing_catalog_items where catalog_version_id = active_id) <> 7 then
    raise exception 'initial catalog must contain seven items';
  end if;
  if not exists (
    select 1
      from public.sales_pricing_catalog_tiers tier
      join public.sales_pricing_catalog_items item on item.id = tier.catalog_item_id
     where item.catalog_version_id = active_id
       and item.item_key = 'clinical_core'
       and tier.maximum_quantity = 25
       and tier.recurring_amount_cents = 39900
  ) then
    raise exception 'clinical package up to 25 is invalid';
  end if;
  if not exists (
    select 1
      from public.sales_pricing_catalog_tiers tier
      join public.sales_pricing_catalog_items item on item.id = tier.catalog_item_id
     where item.catalog_version_id = active_id
       and item.item_key = 'additional_storage'
       and tier.included_quantity = 5120
       and tier.recurring_amount_cents = 990
  ) then
    raise exception '5 GB storage block is invalid';
  end if;
  if exists (
    select 1
      from public.sales_pricing_item_cost_models
     where catalog_version_id = active_id
       and cost_source <> 'unavailable'
  ) then
    raise exception 'initial costs must not be invented';
  end if;
end
$initial_catalog$;

do $catalog_versioning$
declare
  actor_id uuid;
  active_id uuid;
  draft jsonb;
  draft_id uuid;
  published jsonb;
begin
  select id into actor_id from public.users order by created_at nulls last limit 1;
  if actor_id is null then
    raise exception 'test requires one existing user as administrative actor';
  end if;
  select id into active_id from public.sales_pricing_catalog_versions where status = 'active';
  draft := public.clone_sales_pricing_catalog_version_v1(
    active_id,
    'Catalogo de teste transacional',
    actor_id,
    'test-catalog-clone-20260727030000'
  );
  draft_id := (draft->>'id')::uuid;
  perform public.save_sales_pricing_catalog_draft_v1(
    draft_id,
    'cost_model',
    jsonb_build_object(
      'itemId', (
        select id from public.sales_pricing_catalog_items
         where catalog_version_id = draft_id and item_key = 'clinical_core'
      ),
      'directFixedMonthlyCostCents', 1000,
      'directCostPerPatientCents', 100,
      'directCostPerClinicCents', 0,
      'supportFixedMonthlyCostCents', 0,
      'supportCostPerPatientCents', 0,
      'operationalFixedMonthlyCostCents', 0,
      'sharedCostAllocationWeight', 4,
      'costSource', 'manual',
      'sourceDetail', 'Teste transacional'
    ),
    actor_id,
    'test-catalog-cost-20260727030000'
  );
  published := public.publish_sales_pricing_catalog_version_v1(
    draft_id,
    actor_id,
    'test-catalog-publish-20260727030000'
  );
  if published->>'status' <> 'active'
     or (select count(*) from public.sales_pricing_catalog_versions where status = 'active') <> 1
     or (select status from public.sales_pricing_catalog_versions where id = active_id) <> 'archived' then
    raise exception 'catalog publication did not preserve a single active version';
  end if;
  begin
    update public.sales_pricing_catalog_items
       set public_name = 'Mutacao indevida'
     where catalog_version_id = draft_id and item_key = 'clinical_core';
    raise exception 'published catalog mutation should have failed';
  exception
    when sqlstate '55000' then null;
  end;
end
$catalog_versioning$;

do $simulation_and_offer$
declare
  actor_id uuid;
  lead_id uuid;
  assumption_id uuid;
  catalog_id uuid;
  core_item_id uuid;
  core_tier_id uuid;
  save_payload jsonb;
  items_payload jsonb;
  first_result jsonb;
  retry_result jsonb;
  saved_simulation_id uuid;
  offer_result jsonb;
  offer_retry_result jsonb;
  before_failed_count bigint;
begin
  select id into actor_id from public.users order by created_at nulls last limit 1;
  insert into public.sales_leads (
    name, email, normalized_email, phone, normalized_phone, clinic_name,
    estimated_active_patients, operation_type, acquisition_channel,
    contact_consent_at, contact_consent_version, contact_consent_origin,
    contact_consent_purpose
  ) values (
    'Lead modular teste',
    'modular-20260727030000@example.invalid',
    'modular-20260727030000@example.invalid',
    '+5511999990000',
    '5511999990000',
    'Clinica modular teste',
    17,
    'clinic',
    'database_test',
    now(),
    'test-v1',
    'database_test',
    'sales_contact'
  ) returning id into lead_id;
  insert into public.sales_financial_assumption_sets (
    version, name, values, source_metadata, created_by
  ) values (
    (select coalesce(max(version), 0) + 1000 from public.sales_financial_assumption_sets),
    'Premissas teste modular',
    '{}'::jsonb,
    '{}'::jsonb,
    actor_id
  ) returning id into assumption_id;
  select id into catalog_id from public.sales_pricing_catalog_versions where status = 'active';
  select id into core_item_id
    from public.sales_pricing_catalog_items
   where catalog_version_id = catalog_id and item_key = 'clinical_core';
  select id into core_tier_id
    from public.sales_pricing_catalog_tiers
   where catalog_item_id = core_item_id and maximum_quantity = 25;

  save_payload := jsonb_build_object(
    'leadId', lead_id,
    'createdBy', actor_id,
    'assumptionSetId', assumption_id,
    'catalogVersionId', catalog_id,
    'modelVersion', '2026-07-27-v1',
    'patientQuantity', 17,
    'baseAmountCents', 39900,
    'discountType', 'none',
    'discountPercentage', 0,
    'discountDurationMonths', null,
    'offerValidityDays', 14,
    'usageProfile', 'standard',
    'assumptionsSnapshot', jsonb_build_object('id', assumption_id),
    'resultsSnapshot', jsonb_build_object(
      'modelVersion', '2026-07-27-v1',
      'catalogVersionId', catalog_id,
      'catalogVersion', 2,
      'basePackage', jsonb_build_object(
        'name', 'Verto Clínica até 25',
        'limitQuantity', 25,
        'occupiedQuantity', 17
      ),
      'promotionalRecurringRevenueCents', 39900,
      'postPromotionRecurringRevenueCents', 39900,
      'oneTimeRevenueCents', 0,
      'globalDiscountCents', 0
    ),
    'profitabilityRating', 'healthy',
    'scenarioName', 'Cenario SQL',
    'idempotencyKey', 'test-modular-simulation-20260727030000',
    'requestHash', repeat('1', 64),
    'inputSnapshot', jsonb_build_object(
      'patientQuantity', 17,
      'basePackageTierId', core_tier_id,
      'offerValidityDays', 14
    )
  );
  items_payload := jsonb_build_array(jsonb_build_object(
    'catalogItemId', core_item_id,
    'tierId', core_tier_id,
    'itemKey', 'clinical_core',
    'publicName', 'Verto Clínica',
    'description', 'Estrutura clínica e ABA completa.',
    'pricingMode', 'package_limit',
    'quantity', 17,
    'limitQuantity', 25,
    'includedQuantity', 25,
    'grossRecurringRevenueCents', 39900,
    'promotionalRecurringRevenueCents', 39900,
    'postPromotionRecurringRevenueCents', 39900,
    'oneTimeRevenueCents', 0,
    'itemDiscountBasisPoints', 0,
    'itemDiscountCents', 0,
    'allocatedGlobalDiscountCents', 0,
    'costSource', 'manual',
    'costModelSnapshot', jsonb_build_object('version', 2),
    'promotional', jsonb_build_object(
      'directCostCents', 2700,
      'transactionAndTaxCostAllocatedCents', 0,
      'sharedPlatformCostAllocatedCents', 0,
      'contributionMarginCents', 37200,
      'contributionMarginBasisPoints', 9323,
      'ebitdaCents', 37200,
      'ebitdaMarginBasisPoints', 9323,
      'belowEbitdaCostAllocatedCents', 0,
      'profitTaxAllocatedCents', 0,
      'netIncomeCents', 37200,
      'netMarginBasisPoints', 9323
    ),
    'publicMetadata', jsonb_build_object(
      'tierName', 'Verto Clínica até 25',
      'unitName', 'pacientes'
    ),
    'sortOrder', 10
  ));
  first_result := public.save_sales_modular_simulation_v1(save_payload, items_payload);
  retry_result := public.save_sales_modular_simulation_v1(save_payload, items_payload);
  saved_simulation_id := (first_result#>>'{simulation,id}')::uuid;
  if saved_simulation_id is distinct from (retry_result#>>'{simulation,id}')::uuid
     or coalesce((retry_result->>'idempotent')::boolean, false) <> true
     or (select count(*) from public.sales_offer_simulation_items stored
          where stored.simulation_id = saved_simulation_id) <> 1 then
    raise exception 'simulation retry was not idempotent';
  end if;
  begin
    perform public.save_sales_modular_simulation_v1(
      jsonb_set(save_payload, '{requestHash}', to_jsonb(repeat('2', 64))),
      items_payload
    );
    raise exception 'different payload with same key should have failed';
  exception
    when unique_violation then null;
  end;

  select count(*) into before_failed_count from public.sales_offer_simulations;
  begin
    perform public.save_sales_modular_simulation_v1(
      save_payload
        || jsonb_build_object(
          'idempotencyKey', 'test-modular-rollback-20260727030000',
          'requestHash', repeat('3', 64)
        ),
      jsonb_build_array(
        (items_payload->0) || jsonb_build_object('catalogItemId', gen_random_uuid())
      )
    );
    raise exception 'invalid item should have rolled back';
  exception
    when foreign_key_violation then null;
  end;
  if (select count(*) from public.sales_offer_simulations) <> before_failed_count then
    raise exception 'simulation RPC left a partial row after failure';
  end if;
  begin
    update public.sales_offer_simulation_items
       set recurring_amount_cents = 1
     where simulation_id = saved_simulation_id;
    raise exception 'simulation item mutation should have failed';
  exception
    when sqlstate '55000' then null;
  end;
  begin
    update public.sales_offer_simulations
       set results_snapshot = jsonb_build_object('mutated', true)
     where id = saved_simulation_id;
    raise exception 'simulation financial mutation should have failed';
  exception
    when sqlstate '55000' then null;
  end;

  offer_result := public.create_sales_modular_offer_v1(
    saved_simulation_id,
    lead_id,
    actor_id,
    'test-modular-offer-20260727030000',
    repeat('4', 64),
    repeat('a', 64),
    now() + interval '14 days'
  );
  if offer_result#>>'{offer,offer_type}' <> 'modular'
     or (offer_result#>>'{offer,modular_checkout_enabled}')::boolean <> false
     or nullif(offer_result#>>'{offer,stripe_checkout_session_id}', '') is not null
     or (select count(*) from public.sales_offer_items
          where offer_id = (offer_result#>>'{offer,id}')::uuid) <> 1 then
    raise exception 'modular offer was not frozen without Stripe';
  end if;
  offer_retry_result := public.create_sales_modular_offer_v1(
    saved_simulation_id,
    lead_id,
    actor_id,
    'test-modular-offer-20260727030000',
    repeat('4', 64),
    repeat('a', 64),
    now() + interval '14 days'
  );
  if offer_retry_result#>>'{offer,id}' is distinct from offer_result#>>'{offer,id}'
     or coalesce((offer_retry_result->>'idempotent')::boolean, false) <> true then
    raise exception 'offer retry was not idempotent';
  end if;
  begin
    perform public.create_sales_modular_offer_v1(
      saved_simulation_id,
      lead_id,
      actor_id,
      'test-modular-offer-20260727030000',
      repeat('5', 64),
      repeat('b', 64),
      now() + interval '14 days'
    );
    raise exception 'different offer payload with same key should have failed';
  exception
    when unique_violation then null;
  end;
  begin
    update public.sales_offer_items
       set recurring_amount_cents = 1
     where offer_id = (offer_result#>>'{offer,id}')::uuid;
    raise exception 'offer item mutation should have failed';
  exception
    when sqlstate '55000' then null;
  end;
  begin
    update public.sales_offers
       set post_discount_monthly_amount_cents = 1
     where id = (offer_result#>>'{offer,id}')::uuid;
    raise exception 'modular offer financial mutation should have failed';
  exception
    when sqlstate '55000' then null;
  end;
end
$simulation_and_offer$;

-- O rollback prova que o teste nao deixa catálogo, leads, cenários ou ofertas.
rollback;
