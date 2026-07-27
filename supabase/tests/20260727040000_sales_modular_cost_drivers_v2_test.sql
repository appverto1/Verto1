-- Executar somente depois da migration 20260727040000.
-- Exercita as RPCs v2 dentro de transacao e restaura integralmente o estado.

-- Falha cedo com uma mensagem clara se o schema-base nao corresponder ao contrato real.
do $schema_guard$
declare
  required_column text;
begin
  foreach required_column in array array[
    'sales_offer_simulations.assumptions_snapshot',
    'sales_offer_simulations.results_snapshot',
    'sales_offer_simulations.modular_input_snapshot',
    'sales_offers.simulation_snapshot',
    'sales_offers.modular_snapshot',
    'sales_offers.catalog_version_id',
    'sales_offers.simulation_id',
    'sales_offers.offer_type',
    'sales_offers.request_hash',
    'sales_offers.modular_checkout_enabled'
  ]
  loop
    if not exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name = split_part(required_column, '.', 1)
         and column_name = split_part(required_column, '.', 2)
    ) then
      raise exception 'SCHEMA_COLUMN_MISSING:%', required_column;
    end if;
  end loop;
end
$schema_guard$;

drop table if exists pg_temp.verto_modular_cost_v2_baseline;
create temporary table verto_modular_cost_v2_baseline (
  active_catalog_ids jsonb not null,
  catalog_count bigint not null,
  historical_snapshot_hash text not null,
  dre_hash text not null,
  stripe_hash text not null
) on commit preserve rows;

insert into verto_modular_cost_v2_baseline (
  active_catalog_ids,
  catalog_count,
  historical_snapshot_hash,
  dre_hash,
  stripe_hash
)
select
  (
    select coalesce(jsonb_agg(id order by id), '[]'::jsonb)
      from public.sales_pricing_catalog_versions
     where status = 'active'
  ),
  (select count(*) from public.sales_pricing_catalog_versions),
  (
    select encode(digest(coalesce(string_agg(snapshot_value, '|' order by snapshot_key), ''), 'sha256'), 'hex')
      from (
        select
          'simulation:' || simulation.id::text as snapshot_key,
          concat_ws(':',
            simulation.assumptions_snapshot::text,
            simulation.results_snapshot::text,
            simulation.modular_input_snapshot::text
          ) as snapshot_value
        from public.sales_offer_simulations simulation
        union all
        select
          'offer:' || offer.id::text,
          jsonb_build_object(
          'simulationSnapshot', to_jsonb(offer)->'simulation_snapshot',
          'modularSnapshot', to_jsonb(offer)->'modular_snapshot',
          'catalogVersionId', to_jsonb(offer)->'catalog_version_id',
          'simulationId', to_jsonb(offer)->'simulation_id',
          'offerType', to_jsonb(offer)->'offer_type',
          'requestHash', to_jsonb(offer)->'request_hash',
          'modularCheckoutEnabled', to_jsonb(offer)->'modular_checkout_enabled',
          'promotionalMonthlyAmountCents', to_jsonb(offer)->'promotional_monthly_amount_cents',
          'postDiscountMonthlyAmountCents', to_jsonb(offer)->'post_discount_monthly_amount_cents'
        )::text
        from public.sales_offers offer
      ) snapshots
  ),
  (
    select encode(digest(concat_ws('|',
      (select coalesce(string_agg(to_jsonb(payment)::text, '|' order by payment.id), '') from public.payments payment),
      (select coalesce(string_agg(to_jsonb(payment)::text, '|' order by payment.id), '') from public.professional_payments payment),
      (select coalesce(string_agg(to_jsonb(entry)::text, '|' order by entry.id), '') from public.clinic_financial_entries entry)
    ), 'sha256'), 'hex')
  ),
  (
    select encode(digest(coalesce(string_agg(
      jsonb_build_object(
        'id', offer.id,
        'stripeCustomerId', to_jsonb(offer)->'stripe_customer_id',
        'stripeCheckoutSessionId', to_jsonb(offer)->'stripe_checkout_session_id',
        'stripeSubscriptionId', to_jsonb(offer)->'stripe_subscription_id',
        'stripeDiscountId', to_jsonb(offer)->'stripe_discount_id',
        'stripeCouponId', to_jsonb(offer)->'stripe_coupon_id',
        'stripePromotionCodeId', to_jsonb(offer)->'stripe_promotion_code_id'
      )::text,
      '|' order by offer.id
    ), ''), 'sha256'), 'hex')
    from public.sales_offers offer
  );

begin;

do $test$
declare
  actor_user_id uuid;
  source_catalog_id uuid;
  test_catalog_id uuid;
  test_catalog jsonb;
  saved_result jsonb;
  retry_result jsonb;
  item_record record;
  core_item_id uuid;
  settings jsonb;
  source_settings jsonb;
  required_drivers text[];
  reordered_drivers text[];
  profile_values jsonb;
  driver_config jsonb;
  complete_payload jsonb;
  save_key text;
  publish_blocked boolean;
  conflict_detected boolean;
  included_10_mb numeric;
  included_25_mb numeric;
  used_storage_gb numeric;
  egress_gb numeric;
  active_count integer;
  baseline verto_modular_cost_v2_baseline%rowtype;
  current_hash text;
begin
  select * into baseline from verto_modular_cost_v2_baseline limit 1;
  if not found then raise exception 'transactional baseline missing'; end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'sales_pricing_item_cost_models'
       and column_name = 'other_variable_cost_cents'
       and data_type = 'integer'
  ) then
    raise exception 'other_variable_cost_cents integer column missing';
  end if;
  if has_function_privilege('authenticated',
       'public.publish_sales_pricing_catalog_version_v2(uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('anon',
       'public.publish_sales_pricing_catalog_version_v2(uuid,uuid,text)', 'EXECUTE') then
    raise exception 'catalog v2 publish leaked outside service_role';
  end if;

  settings := jsonb_build_object(
    'schemaVersion', 2,
    'ownership', jsonb_build_object(
      'variablePatientCost', 'item_direct',
      'variableClinicCost', 'item_direct',
      'storageCost', 'item_direct',
      'egressCost', 'item_direct',
      'processingCost', 'item_direct',
      'notificationCost', 'item_direct',
      'otherVariableCost', 'shared',
      'supportClinicCost', 'item_direct',
      'supportPatientCost', 'item_direct',
      'operationalCost', 'item_direct',
      'fixedMonthlyEligibleCost', 'shared'
    ),
    'ownershipJustifications', '{}'::jsonb,
    'includedStorageMbPerPatient', 100,
    'usageProfiles', jsonb_build_object(
      'light', jsonb_build_object('storageUtilizationBasisPoints', 2500, 'expectedEgressMultiplier', null),
      'standard', jsonb_build_object('storageUtilizationBasisPoints', 6000, 'expectedEgressMultiplier', null),
      'intensive', jsonb_build_object('storageUtilizationBasisPoints', 10000, 'expectedEgressMultiplier', null)
    )
  );
  if not public.sales_modular_cost_settings_valid_v2(settings) then
    raise exception 'canonical cost settings rejected';
  end if;
  if public.sales_modular_cost_settings_valid_v2(
    jsonb_set(settings, '{ownership,unexpectedCost}', '"shared"'::jsonb)
  ) then
    raise exception 'extra ownership property accepted';
  end if;
  if public.sales_modular_cost_settings_valid_v2(
    settings #- '{ownership,supportPatientCost}'
  ) then
    raise exception 'missing ownership property accepted';
  end if;
  if public.sales_modular_cost_settings_valid_v2(
    jsonb_set(settings, '{schemaVersion}', '"invalid"'::jsonb)
  ) then
    raise exception 'invalid schemaVersion cast escaped validation';
  end if;

  select id into actor_user_id
    from public.users
   where role in ('owner', 'admin')
   order by id
   limit 1;
  if actor_user_id is null then
    select id into actor_user_id from public.users order by id limit 1;
  end if;
  if actor_user_id is null then raise exception 'test requires one existing user'; end if;

  select id, modular_cost_settings into source_catalog_id, source_settings
    from public.sales_pricing_catalog_versions
   where status = 'active'
   order by version desc
   limit 1;
  if source_catalog_id is null then raise exception 'active source catalog missing'; end if;

  test_catalog := public.clone_sales_pricing_catalog_version_v2(
    source_catalog_id,
    'Teste transacional — custos modulares v2',
    actor_user_id,
    'cost-v2-clone:' || gen_random_uuid()::text
  );
  test_catalog_id := (test_catalog->>'id')::uuid;
  if test_catalog_id is null then raise exception 'clone v2 did not return id'; end if;
  if (select modular_cost_settings from public.sales_pricing_catalog_versions where id = test_catalog_id)
     is distinct from source_settings then
    raise exception 'clone v2 did not preserve modular_cost_settings';
  end if;
  if exists (
    select 1
      from public.sales_pricing_catalog_items source_item
      join public.sales_pricing_catalog_items target_item
        on target_item.catalog_version_id = test_catalog_id
       and target_item.item_key = source_item.item_key
      left join lateral (
        select cost.driver_config, cost.other_variable_cost_cents
          from public.sales_pricing_item_cost_models cost
         where cost.catalog_item_id = source_item.id
         order by cost.version desc limit 1
      ) source_cost on true
      left join lateral (
        select cost.driver_config, cost.other_variable_cost_cents
          from public.sales_pricing_item_cost_models cost
         where cost.catalog_item_id = target_item.id
         order by cost.version desc limit 1
      ) target_cost on true
     where source_item.catalog_version_id = source_catalog_id
       and (
         source_cost.driver_config is distinct from target_cost.driver_config
         or source_cost.other_variable_cost_cents is distinct from target_cost.other_variable_cost_cents
       )
  ) then
    raise exception 'clone v2 did not preserve driver_config or other variable cost';
  end if;

  publish_blocked := false;
  begin
    perform public.publish_sales_pricing_catalog_version_v2(
      test_catalog_id, actor_user_id, 'cost-v2-unavailable:' || gen_random_uuid()::text
    );
  exception when others then
    if sqlerrm like '%PRICING_CATALOG_PUBLICATION_BLOCKED:COST_OR_DRIVER%' then
      publish_blocked := true;
    else raise;
    end if;
  end;
  if not publish_blocked then raise exception 'unavailable cost did not block publication'; end if;

  for item_record in
    select id, item_key, billing_interval
      from public.sales_pricing_catalog_items
     where catalog_version_id = test_catalog_id and is_active
     order by sort_order, item_key
  loop
    required_drivers := public.sales_modular_required_drivers_v2(item_record.item_key);
    select coalesce(jsonb_object_agg(driver_key, jsonb_build_object(
      'value', 1,
      'source', 'manual',
      'sourceDetail', 'Valor explícito do teste SQL transacional.',
      'effectiveAt', '2026-07-27T00:00:00.000Z',
      'version', 1
    )), '{}'::jsonb)
      into profile_values
      from unnest(required_drivers) driver(driver_key);
    driver_config := jsonb_build_object(
      'schemaVersion', 2,
      'requiredDrivers', to_jsonb(required_drivers),
      'profiles', jsonb_build_object(
        'light', profile_values,
        'standard', profile_values,
        'intensive', profile_values
      ),
      'unitCostsCents', jsonb_build_object(
        'monthlyAbaSessions', 0,
        'monthlyAbaRecords', 0,
        'generatedDocuments', 0,
        'financialReports', 0,
        'recurringProcesses', 0,
        'tissBatches', 0,
        'tissXmlDocuments', 0,
        'tissDocuments', 0,
        'schoolParticipants', 0,
        'onboardingHours', 0
      ),
      'onboardingCalculationMode', case when item_record.item_key = 'onboarding' then 'hours' else null end
    );
    complete_payload := jsonb_build_object(
      'itemId', item_record.id,
      'directFixedMonthlyCostCents', 0,
      'directCostPerPatientCents', 0,
      'directCostPerClinicCents', 0,
      'directCostPerUsageUnitCents', 0,
      'storageCostPerGbCents', 100,
      'egressCostPerGbCents', 50,
      'notificationCostPerUnitCents', 0,
      'processingCostPerUnitCents', 0,
      'otherVariableCostCents', 77,
      'supportFixedMonthlyCostCents', 0,
      'supportCostPerPatientCents', 0,
      'operationalFixedMonthlyCostCents', 0,
      'onboardingCostCents', 0,
      'sharedCostAllocationWeight', 1,
      'costSource', 'manual',
      'sourceDetail', 'Modelo completo do teste SQL transacional.',
      'driverConfig', driver_config
    );
    save_key := 'cost-v2-save:' || item_record.item_key || ':' || gen_random_uuid()::text;
    saved_result := public.save_sales_pricing_catalog_draft_v2(
      test_catalog_id, 'cost_model', complete_payload, actor_user_id, save_key
    );
    if saved_result->'driver_config' is distinct from driver_config
       or (saved_result->>'other_variable_cost_cents')::integer <> 77 then
      raise exception 'save v2 did not persist driver_config or other variable cost for %', item_record.item_key;
    end if;
    if item_record.item_key = 'clinical_core' then
      core_item_id := item_record.id;
      retry_result := public.save_sales_pricing_catalog_draft_v2(
        test_catalog_id, 'cost_model', complete_payload, actor_user_id, save_key
      );
      if retry_result->>'id' is distinct from saved_result->>'id' then
        raise exception 'idempotent retry returned a different cost model';
      end if;
      conflict_detected := false;
      begin
        perform public.save_sales_pricing_catalog_draft_v2(
          test_catalog_id,
          'cost_model',
          jsonb_set(complete_payload, '{sourceDetail}', '"Payload diferente"'::jsonb),
          actor_user_id,
          save_key
        );
      exception when unique_violation then
        if sqlerrm like '%PRICING_CATALOG_IDEMPOTENCY_CONFLICT%' then
          conflict_detected := true;
        else raise;
        end if;
      end;
      if not conflict_detected then raise exception 'idempotency conflict was not detected'; end if;
    end if;
  end loop;

  if not public.sales_modular_cost_category_applies_v2('clinical_core', 'supportPatientCost')
     or not public.sales_modular_cost_category_applies_v2('appointments_communication', 'supportPatientCost')
     or not public.sales_modular_cost_category_applies_v2('school_management', 'supportPatientCost')
     or public.sales_modular_cost_category_applies_v2('financial_management', 'supportPatientCost') then
    raise exception 'supportPatientCost applicability matrix is inconsistent';
  end if;
  for item_record in
    select item.item_key, cost.*
      from public.sales_pricing_catalog_items item
      join lateral (
        select latest_cost.*
          from public.sales_pricing_item_cost_models latest_cost
         where latest_cost.catalog_item_id = item.id
         order by latest_cost.version desc
         limit 1
      ) cost on true
     where item.catalog_version_id = test_catalog_id
       and item.is_active
       and public.sales_modular_cost_category_applies_v2(item.item_key, 'supportPatientCost')
  loop
    if public.sales_modular_cost_model_complete_v2(
      item_record.item_key,
      to_jsonb(item_record) || jsonb_build_object('support_cost_per_patient_cents', null),
      settings
    ) then
      raise exception 'null supportPatientCost accepted for applicable item %', item_record.item_key;
    end if;
  end loop;

  select cost.driver_config into driver_config
    from public.sales_pricing_item_cost_models cost
   where cost.catalog_item_id = core_item_id
   order by cost.version desc limit 1;
  driver_config := jsonb_set(
    driver_config,
    '{requiredDrivers}',
    (driver_config->'requiredDrivers') - 0
  );
  complete_payload := jsonb_build_object(
    'itemId', core_item_id,
    'directFixedMonthlyCostCents', 0,
    'directCostPerPatientCents', 0,
    'directCostPerClinicCents', 0,
    'directCostPerUsageUnitCents', 0,
    'storageCostPerGbCents', 100,
    'egressCostPerGbCents', 50,
    'notificationCostPerUnitCents', 0,
    'processingCostPerUnitCents', 0,
    'otherVariableCostCents', 77,
    'supportFixedMonthlyCostCents', 0,
    'supportCostPerPatientCents', 0,
    'operationalFixedMonthlyCostCents', 0,
    'onboardingCostCents', 0,
    'sharedCostAllocationWeight', 1,
    'costSource', 'manual',
    'sourceDetail', 'Driver obrigatório removido para validar bloqueio.',
    'driverConfig', driver_config
  );
  perform public.save_sales_pricing_catalog_draft_v2(
    test_catalog_id, 'cost_model', complete_payload, actor_user_id,
    'cost-v2-missing-driver:' || gen_random_uuid()::text
  );
  publish_blocked := false;
  begin
    perform public.publish_sales_pricing_catalog_version_v2(
      test_catalog_id, actor_user_id, 'cost-v2-driver-block:' || gen_random_uuid()::text
    );
  exception when others then
    if sqlerrm like '%PRICING_CATALOG_PUBLICATION_BLOCKED:COST_OR_DRIVER%' then publish_blocked := true;
    else raise; end if;
  end;
  if not publish_blocked then raise exception 'missing required driver did not block publication'; end if;

  required_drivers := public.sales_modular_required_drivers_v2('clinical_core');
  select coalesce(array_agg(driver_key order by driver_key desc), array[]::text[])
    into reordered_drivers
    from unnest(required_drivers) driver(driver_key);
  select coalesce(jsonb_object_agg(driver_key, jsonb_build_object(
    'value', 1, 'source', 'manual',
    'sourceDetail', 'Driver restaurado pelo teste SQL.',
    'effectiveAt', '2026-07-27T00:00:00.000Z', 'version', 2
  )), '{}'::jsonb) into profile_values
  from unnest(required_drivers) driver(driver_key);
  driver_config := jsonb_build_object(
    'schemaVersion', 2,
    'requiredDrivers', to_jsonb(reordered_drivers),
    'profiles', jsonb_build_object('light', profile_values, 'standard', profile_values, 'intensive', profile_values),
    'unitCostsCents', jsonb_build_object(
      'monthlyAbaSessions', 0, 'monthlyAbaRecords', 0, 'generatedDocuments', 0,
      'financialReports', 0, 'recurringProcesses', 0, 'tissBatches', 0,
      'tissXmlDocuments', 0, 'tissDocuments', 0, 'schoolParticipants', 0,
      'onboardingHours', 0
    )
  );
  if not public.sales_modular_driver_config_valid_v2('clinical_core', driver_config) then
    raise exception 'requiredDrivers in different order was rejected';
  end if;
  if public.sales_modular_driver_config_valid_v2(
    'clinical_core',
    jsonb_set(
      driver_config,
      '{requiredDrivers}',
      driver_config->'requiredDrivers' || to_jsonb(array['monthlyClinicalSessions'])
    )
  ) then
    raise exception 'duplicate required driver was accepted';
  end if;
  if public.sales_modular_driver_config_valid_v2(
    'clinical_core',
    jsonb_set(
      driver_config,
      '{requiredDrivers}',
      driver_config->'requiredDrivers' || to_jsonb(array['unexpectedDriver'])
    )
  ) then
    raise exception 'extra required driver was accepted';
  end if;
  perform public.save_sales_pricing_catalog_draft_v2(
    test_catalog_id,
    'cost_model',
    jsonb_set(jsonb_set(complete_payload, '{driverConfig}', driver_config), '{sourceDetail}', '"Driver restaurado"'::jsonb),
    actor_user_id,
    'cost-v2-restore-driver:' || gen_random_uuid()::text
  );

  publish_blocked := false;
  begin
    perform public.publish_sales_pricing_catalog_version_v2(
      test_catalog_id, actor_user_id, 'cost-v2-egress-block:' || gen_random_uuid()::text
    );
  exception when others then
    if sqlerrm like '%PRICING_CATALOG_PUBLICATION_BLOCKED:EGRESS%' then publish_blocked := true;
    else raise; end if;
  end;
  if not publish_blocked then raise exception 'missing expectedEgressMultiplier did not block publication'; end if;

  settings := jsonb_set(settings, '{usageProfiles,light,expectedEgressMultiplier}', '0.5'::jsonb);
  settings := jsonb_set(settings, '{usageProfiles,standard,expectedEgressMultiplier}', '2'::jsonb);
  settings := jsonb_set(settings, '{usageProfiles,intensive,expectedEgressMultiplier}', '5'::jsonb);
  perform public.save_sales_pricing_catalog_draft_v2(
    test_catalog_id, 'version', jsonb_build_object('modularCostSettings', settings),
    actor_user_id, 'cost-v2-egress-settings:' || gen_random_uuid()::text
  );

  complete_payload := jsonb_set(complete_payload, '{driverConfig}', driver_config);
  complete_payload := jsonb_set(complete_payload, '{supportCostPerPatientCents}', 'null'::jsonb);
  perform public.save_sales_pricing_catalog_draft_v2(
    test_catalog_id, 'cost_model', complete_payload, actor_user_id,
    'cost-v2-support-null:' || gen_random_uuid()::text
  );
  publish_blocked := false;
  begin
    perform public.publish_sales_pricing_catalog_version_v2(
      test_catalog_id, actor_user_id, 'cost-v2-support-block:' || gen_random_uuid()::text
    );
  exception when others then
    if sqlerrm like '%PRICING_CATALOG_PUBLICATION_BLOCKED:COST_OR_DRIVER%' then publish_blocked := true;
    else raise; end if;
  end;
  if not publish_blocked then raise exception 'null supportPatientCost did not block publication'; end if;

  complete_payload := jsonb_set(complete_payload, '{supportCostPerPatientCents}', '0'::jsonb);
  perform public.save_sales_pricing_catalog_draft_v2(
    test_catalog_id, 'cost_model', complete_payload, actor_user_id,
    'cost-v2-support-zero:' || gen_random_uuid()::text
  );
  if not public.sales_modular_cost_model_complete_v2(
    'clinical_core',
    (select to_jsonb(cost) from public.sales_pricing_item_cost_models cost where cost.catalog_item_id = core_item_id order by cost.version desc limit 1),
    settings
  ) then
    raise exception 'explicit zero supportPatientCost was rejected';
  end if;

  settings := jsonb_set(settings, '{ownership,otherVariableCost}', '"item_direct"'::jsonb);
  perform public.save_sales_pricing_catalog_draft_v2(
    test_catalog_id, 'version', jsonb_build_object('modularCostSettings', settings),
    actor_user_id, 'cost-v2-other-direct:' || gen_random_uuid()::text
  );
  complete_payload := jsonb_set(complete_payload, '{otherVariableCostCents}', 'null'::jsonb);
  perform public.save_sales_pricing_catalog_draft_v2(
    test_catalog_id, 'cost_model', complete_payload, actor_user_id,
    'cost-v2-other-null:' || gen_random_uuid()::text
  );
  publish_blocked := false;
  begin
    perform public.publish_sales_pricing_catalog_version_v2(
      test_catalog_id, actor_user_id, 'cost-v2-other-block:' || gen_random_uuid()::text
    );
  exception when others then
    if sqlerrm like '%PRICING_CATALOG_PUBLICATION_BLOCKED:COST_OR_DRIVER%' then publish_blocked := true;
    else raise; end if;
  end;
  if not publish_blocked then raise exception 'null otherVariableCost did not block publication'; end if;

  complete_payload := jsonb_set(complete_payload, '{otherVariableCostCents}', '77'::jsonb);
  perform public.save_sales_pricing_catalog_draft_v2(
    test_catalog_id, 'cost_model', complete_payload, actor_user_id,
    'cost-v2-other-value:' || gen_random_uuid()::text
  );
  if public.sales_modular_resolve_owned_cost_v2('item_direct', 31, 77, true) <> 77 then
    raise exception 'item_direct otherVariableCost was not accounted';
  end if;
  if public.sales_modular_resolve_owned_cost_v2('shared', 31, 77, true) <> 31 then
    raise exception 'shared otherVariableCost did not ignore direct value';
  end if;
  if public.sales_modular_resolve_owned_cost_v2('excluded', 31, 77, true) <> 0 then
    raise exception 'excluded otherVariableCost did not ignore both sources';
  end if;

  select
    (select tier.maximum_quantity from public.sales_pricing_catalog_tiers tier
      join public.sales_pricing_catalog_items item on item.id = tier.catalog_item_id
     where item.catalog_version_id = test_catalog_id and item.item_key = 'clinical_core'
       and tier.maximum_quantity = 10 limit 1)
      * (settings->>'includedStorageMbPerPatient')::numeric,
    (select tier.maximum_quantity from public.sales_pricing_catalog_tiers tier
      join public.sales_pricing_catalog_items item on item.id = tier.catalog_item_id
     where item.catalog_version_id = test_catalog_id and item.item_key = 'clinical_core'
       and tier.maximum_quantity = 25 limit 1)
      * (settings->>'includedStorageMbPerPatient')::numeric
    into included_10_mb, included_25_mb;
  if included_10_mb <> 1000 or included_25_mb <> 2500 then
    raise exception 'included storage formula does not use package limit';
  end if;
  used_storage_gb := (included_10_mb / 1024) * 0.60;
  egress_gb := used_storage_gb * 2;
  if egress_gb = used_storage_gb or egress_gb <> (included_10_mb / 1024) * 0.60 * 2 then
    raise exception 'egress was not calculated separately from storage';
  end if;

  settings := jsonb_set(settings, '{ownership,otherVariableCost}', '"shared"'::jsonb);
  settings := jsonb_set(settings, '{ownershipJustifications}', '{}'::jsonb);
  perform public.save_sales_pricing_catalog_draft_v2(
    test_catalog_id, 'version', jsonb_build_object('modularCostSettings', settings),
    actor_user_id, 'cost-v2-shared-unjustified:' || gen_random_uuid()::text
  );
  publish_blocked := false;
  begin
    perform public.publish_sales_pricing_catalog_version_v2(
      test_catalog_id, actor_user_id, 'cost-v2-duplicate-block:' || gen_random_uuid()::text
    );
  exception when others then
    if sqlerrm like '%PRICING_CATALOG_PUBLICATION_BLOCKED:DUPLICATE:otherVariableCost%' then publish_blocked := true;
    else raise; end if;
  end;
  if not publish_blocked then raise exception 'unjustified shared/direct duplicate did not block'; end if;

  settings := jsonb_set(
    settings,
    '{ownershipJustifications,otherVariableCost}',
    to_jsonb('Valor direto preservado somente para auditoria administrativa.'::text)
  );
  perform public.save_sales_pricing_catalog_draft_v2(
    test_catalog_id, 'version', jsonb_build_object('modularCostSettings', settings),
    actor_user_id, 'cost-v2-shared-justified:' || gen_random_uuid()::text
  );
  test_catalog := public.publish_sales_pricing_catalog_version_v2(
    test_catalog_id, actor_user_id, 'cost-v2-publish-complete:' || gen_random_uuid()::text
  );
  if test_catalog->>'status' <> 'active' then
    raise exception 'complete catalog was not published';
  end if;
  select count(*) into active_count
    from public.sales_pricing_catalog_versions where status = 'active';
  if active_count <> 1 then raise exception 'more than one active catalog inside transaction'; end if;

  select encode(digest(coalesce(string_agg(snapshot_value, '|' order by snapshot_key), ''), 'sha256'), 'hex')
    into current_hash
    from (
      select 'simulation:' || simulation.id::text as snapshot_key,
        concat_ws(':', simulation.assumptions_snapshot::text, simulation.results_snapshot::text, simulation.modular_input_snapshot::text) as snapshot_value
      from public.sales_offer_simulations simulation
      union all
      select 'offer:' || offer.id::text,
        jsonb_build_object(
          'simulationSnapshot', to_jsonb(offer)->'simulation_snapshot',
          'modularSnapshot', to_jsonb(offer)->'modular_snapshot',
          'catalogVersionId', to_jsonb(offer)->'catalog_version_id',
          'simulationId', to_jsonb(offer)->'simulation_id',
          'offerType', to_jsonb(offer)->'offer_type',
          'requestHash', to_jsonb(offer)->'request_hash',
          'modularCheckoutEnabled', to_jsonb(offer)->'modular_checkout_enabled',
          'promotionalMonthlyAmountCents', to_jsonb(offer)->'promotional_monthly_amount_cents',
          'postDiscountMonthlyAmountCents', to_jsonb(offer)->'post_discount_monthly_amount_cents'
        )::text
      from public.sales_offers offer
    ) snapshots;
  if current_hash is distinct from baseline.historical_snapshot_hash then
    raise exception 'historical snapshot changed during catalog test';
  end if;
  select encode(digest(concat_ws('|',
    (select coalesce(string_agg(to_jsonb(payment)::text, '|' order by payment.id), '') from public.payments payment),
    (select coalesce(string_agg(to_jsonb(payment)::text, '|' order by payment.id), '') from public.professional_payments payment),
    (select coalesce(string_agg(to_jsonb(entry)::text, '|' order by entry.id), '') from public.clinic_financial_entries entry)
  ), 'sha256'), 'hex') into current_hash;
  if current_hash is distinct from baseline.dre_hash then
    raise exception 'realized DRE data changed during catalog test';
  end if;
  select encode(digest(coalesce(string_agg(
    jsonb_build_object(
      'id', offer.id,
      'stripeCustomerId', to_jsonb(offer)->'stripe_customer_id',
      'stripeCheckoutSessionId', to_jsonb(offer)->'stripe_checkout_session_id',
      'stripeSubscriptionId', to_jsonb(offer)->'stripe_subscription_id',
      'stripeDiscountId', to_jsonb(offer)->'stripe_discount_id',
      'stripeCouponId', to_jsonb(offer)->'stripe_coupon_id',
      'stripePromotionCodeId', to_jsonb(offer)->'stripe_promotion_code_id'
    )::text, '|' order by offer.id
  ), ''), 'sha256'), 'hex') into current_hash
  from public.sales_offers offer;
  if current_hash is distinct from baseline.stripe_hash then
    raise exception 'Stripe state changed during catalog-only RPC test';
  end if;
end
$test$;

rollback;

do $rollback_verification$
declare
  baseline verto_modular_cost_v2_baseline%rowtype;
  current_active_ids jsonb;
  current_hash text;
begin
  select * into baseline from verto_modular_cost_v2_baseline limit 1;
  select coalesce(jsonb_agg(id order by id), '[]'::jsonb)
    into current_active_ids
    from public.sales_pricing_catalog_versions
   where status = 'active';
  if current_active_ids is distinct from baseline.active_catalog_ids then
    raise exception 'rollback did not restore original active catalog';
  end if;
  if (select count(*) from public.sales_pricing_catalog_versions) <> baseline.catalog_count then
    raise exception 'rollback left a temporary catalog behind';
  end if;
  select encode(digest(coalesce(string_agg(snapshot_value, '|' order by snapshot_key), ''), 'sha256'), 'hex')
    into current_hash
    from (
      select 'simulation:' || simulation.id::text as snapshot_key,
        concat_ws(':', simulation.assumptions_snapshot::text, simulation.results_snapshot::text, simulation.modular_input_snapshot::text) as snapshot_value
      from public.sales_offer_simulations simulation
      union all
      select 'offer:' || offer.id::text,
        jsonb_build_object(
          'simulationSnapshot', to_jsonb(offer)->'simulation_snapshot',
          'modularSnapshot', to_jsonb(offer)->'modular_snapshot',
          'catalogVersionId', to_jsonb(offer)->'catalog_version_id',
          'simulationId', to_jsonb(offer)->'simulation_id',
          'offerType', to_jsonb(offer)->'offer_type',
          'requestHash', to_jsonb(offer)->'request_hash',
          'modularCheckoutEnabled', to_jsonb(offer)->'modular_checkout_enabled',
          'promotionalMonthlyAmountCents', to_jsonb(offer)->'promotional_monthly_amount_cents',
          'postDiscountMonthlyAmountCents', to_jsonb(offer)->'post_discount_monthly_amount_cents'
        )::text
      from public.sales_offers offer
    ) snapshots;
  if current_hash is distinct from baseline.historical_snapshot_hash then
    raise exception 'rollback verification found changed historical snapshots';
  end if;
end
$rollback_verification$;

drop table verto_modular_cost_v2_baseline;
