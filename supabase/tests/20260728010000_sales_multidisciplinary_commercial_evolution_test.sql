-- Execute manually only after applying
-- 20260728010000_sales_multidisciplinary_commercial_evolution.sql.
-- All catalog mutations happen inside BEGIN/ROLLBACK.

drop table if exists pg_temp.verto_capacity_v3_baseline;
create temporary table verto_capacity_v3_baseline (
  active_catalog_ids jsonb not null,
  v1_v2_content_hash jsonb not null,
  historical_snapshot_hash text not null,
  dre_hash text not null,
  stripe_hash text not null
) on commit preserve rows;

insert into verto_capacity_v3_baseline (
  active_catalog_ids,
  v1_v2_content_hash,
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
  (
    select coalesce(
      jsonb_object_agg(
        catalog.version::text,
        encode(
          digest(
            (
              to_jsonb(catalog)
              - array[
                  'status',
                  'archived_at',
                  'custom_capacity_policy'
                ]::text[]
            )::text,
            'sha256'
          ),
          'hex'
        )
      ),
      '{}'::jsonb
    )
      from public.sales_pricing_catalog_versions catalog
     where catalog.version in (1, 2)
  ),
  (
    select encode(
      digest(
        coalesce(
          string_agg(snapshot_value, '|' order by snapshot_key),
          ''
        ),
        'sha256'
      ),
      'hex'
    )
      from (
        select
          'simulation:' || simulation.id::text as snapshot_key,
          concat_ws(
            ':',
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
            'requestHash', to_jsonb(offer)->'request_hash'
          )::text
          from public.sales_offers offer
      ) snapshots
  ),
  (
    select encode(
      digest(
        concat_ws(
          '|',
          (
            select coalesce(
              string_agg(to_jsonb(payment)::text, '|' order by payment.id),
              ''
            )
              from public.payments payment
          ),
          (
            select coalesce(
              string_agg(to_jsonb(payment)::text, '|' order by payment.id),
              ''
            )
              from public.professional_payments payment
          ),
          (
            select coalesce(
              string_agg(to_jsonb(entry)::text, '|' order by entry.id),
              ''
            )
              from public.clinic_financial_entries entry
          )
        ),
        'sha256'
      ),
      'hex'
    )
  ),
  (
    select encode(
      digest(
        concat_ws(
          '|',
          (
            select coalesce(
              string_agg(
                jsonb_build_object(
                  'id', offer.id,
                  'stripeCustomerId', to_jsonb(offer)->'stripe_customer_id',
                  'stripeCheckoutSessionId',
                    to_jsonb(offer)->'stripe_checkout_session_id',
                  'stripeSubscriptionId',
                    to_jsonb(offer)->'stripe_subscription_id'
                )::text,
                '|' order by offer.id
              ),
              ''
            )
              from public.sales_offers offer
          ),
          (
            select coalesce(
              string_agg(to_jsonb(link)::text, '|' order by link.id),
              ''
            )
              from public.sales_checkout_links link
          )
        ),
        'sha256'
      ),
      'hex'
    )
  );

begin;

do $test$
declare
  baseline verto_capacity_v3_baseline%rowtype;
  actor_user_id uuid;
  source_catalog_id uuid;
  source_version integer;
  test_catalog_id uuid;
  clone_result jsonb;
  retry_result jsonb;
  saved_result jsonb;
  published_result jsonb;
  clone_key text := 'capacity-v3-clone:' || gen_random_uuid()::text;
  policy jsonb :=
    '{"enabled":true,"blockSizePatients":10,"blockPriceCents":7990,"includedStorageMbPerPatient":100,"gracePeriodDays":7,"billingAdjustment":"next_cycle","blocksClinicalAccess":false}'::jsonb;
  invalid_policy jsonb;
  invalid_rejected boolean;
  conflict_detected boolean := false;
  immutable_blocked boolean := false;
  capacity_case record;
  calculated_blocks integer;
  current_hash jsonb;
  current_text_hash text;
begin
  select * into baseline
    from verto_capacity_v3_baseline
   limit 1;
  if not found then
    raise exception 'CAPACITY_V3_BASELINE_MISSING';
  end if;

  if not exists (
    select 1
      from pg_trigger trigger_info
     where trigger_info.tgrelid =
       'public.sales_pricing_catalog_versions'::regclass
       and trigger_info.tgname =
         'sales_pricing_catalog_versions_immutable_v1'
       and trigger_info.tgenabled <> 'D'
       and not trigger_info.tgisinternal
  ) then
    raise exception 'CATALOG_IMMUTABILITY_TRIGGER_NOT_ACTIVE';
  end if;

  if (
    select is_nullable
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'sales_pricing_catalog_versions'
       and column_name = 'custom_capacity_policy'
  ) <> 'YES' then
    raise exception 'CUSTOM_CAPACITY_POLICY_MUST_REMAIN_NULLABLE';
  end if;

  if exists (
    select 1
      from public.sales_pricing_catalog_versions
     where version in (1, 2)
       and custom_capacity_policy is not null
  ) then
    raise exception 'HISTORICAL_CATALOG_POLICY_WAS_BACKFILLED';
  end if;

  if not public.sales_custom_capacity_policy_valid_v1(policy) then
    raise exception 'DEFAULT_CAPACITY_POLICY_REJECTED';
  end if;

  foreach invalid_policy in array array[
    policy || '{"extra":true}'::jsonb,
    policy - 'blockPriceCents',
    jsonb_set(policy, '{blockPriceCents}', '-1'::jsonb),
    jsonb_set(policy, '{blockSizePatients}', '0'::jsonb),
    jsonb_set(policy, '{blocksClinicalAccess}', 'true'::jsonb),
    jsonb_set(policy, '{billingAdjustment}', '"immediate"'::jsonb)
  ]
  loop
    if public.sales_custom_capacity_policy_valid_v1(invalid_policy) then
      raise exception 'INVALID_CAPACITY_POLICY_ACCEPTED:%', invalid_policy;
    end if;
  end loop;

  select id into actor_user_id
    from public.users
   where role in ('owner', 'admin')
   order by id
   limit 1;
  if actor_user_id is null then
    select id into actor_user_id
      from public.users
     order by id
     limit 1;
  end if;
  if actor_user_id is null then
    raise exception 'CAPACITY_V3_TEST_REQUIRES_EXISTING_USER';
  end if;

  select id, version into source_catalog_id, source_version
    from public.sales_pricing_catalog_versions
   where status = 'active'
   order by version desc
   limit 1;
  if source_catalog_id is null or source_version <> 2 then
    raise exception 'EXPECTED_ACTIVE_CATALOG_V2';
  end if;

  begin
    update public.sales_pricing_catalog_versions
       set custom_capacity_policy = policy
     where id = source_catalog_id;
  exception when others then
    immutable_blocked :=
      position('PRICING_CATALOG_IMMUTABLE' in sqlerrm) > 0;
  end;
  if not immutable_blocked then
    raise exception 'ACTIVE_CATALOG_MUTATION_WAS_NOT_BLOCKED';
  end if;
  if (
    select custom_capacity_policy
      from public.sales_pricing_catalog_versions
     where id = source_catalog_id
  ) is not null then
    raise exception 'ACTIVE_V2_POLICY_CHANGED_AFTER_BLOCK';
  end if;

  clone_result := public.clone_sales_pricing_catalog_version_v2(
    source_catalog_id,
    'Catálogo comercial v3 — blocos de capacidade',
    actor_user_id,
    clone_key
  );
  test_catalog_id := (clone_result->>'id')::uuid;
  if test_catalog_id is null then
    raise exception 'CLONE_V2_DID_NOT_RETURN_V3';
  end if;
  if (clone_result->>'status') <> 'draft'
     or (clone_result->>'version')::integer <> source_version + 1 then
    raise exception 'CLONE_V2_DID_NOT_CREATE_NEXT_DRAFT';
  end if;
  if (
    select custom_capacity_policy
      from public.sales_pricing_catalog_versions
     where id = test_catalog_id
  ) is distinct from policy then
    raise exception 'CLONED_V3_DEFAULT_POLICY_MISSING';
  end if;
  if (
    select custom_capacity_policy
      from public.sales_pricing_catalog_versions
     where id = source_catalog_id
  ) is not null then
    raise exception 'CLONE_MUTATED_SOURCE_V2';
  end if;

  retry_result := public.clone_sales_pricing_catalog_version_v2(
    source_catalog_id,
    'Catálogo comercial v3 — blocos de capacidade',
    actor_user_id,
    clone_key
  );
  if (retry_result->>'id')::uuid is distinct from test_catalog_id then
    raise exception 'CLONE_V2_RETRY_NOT_IDEMPOTENT';
  end if;
  begin
    perform public.clone_sales_pricing_catalog_version_v2(
      source_catalog_id,
      'Nome divergente com a mesma chave',
      actor_user_id,
      clone_key
    );
  exception when others then
    conflict_detected :=
      position('PRICING_CATALOG_IDEMPOTENCY_CONFLICT' in sqlerrm) > 0;
  end;
  if not conflict_detected then
    raise exception 'CLONE_V2_DIFFERENT_PAYLOAD_DID_NOT_CONFLICT';
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
         order by cost.version desc
         limit 1
      ) source_cost on true
      left join lateral (
        select cost.driver_config, cost.other_variable_cost_cents
          from public.sales_pricing_item_cost_models cost
         where cost.catalog_item_id = target_item.id
         order by cost.version desc
         limit 1
      ) target_cost on true
     where source_item.catalog_version_id = source_catalog_id
       and (
         source_cost.driver_config is distinct from target_cost.driver_config
         or source_cost.other_variable_cost_cents
           is distinct from target_cost.other_variable_cost_cents
       )
  ) then
    raise exception 'CLONE_V2_DID_NOT_PRESERVE_COST_DRIVERS';
  end if;
  if (
    select modular_cost_settings
      from public.sales_pricing_catalog_versions
     where id = test_catalog_id
  ) is distinct from (
    select modular_cost_settings
      from public.sales_pricing_catalog_versions
     where id = source_catalog_id
  ) then
    raise exception 'CLONE_V2_DID_NOT_PRESERVE_COST_SETTINGS';
  end if;

  invalid_rejected := false;
  begin
    perform public.save_sales_pricing_catalog_draft_v2(
      test_catalog_id,
      'version',
      jsonb_build_object(
        'customCapacityPolicy',
        jsonb_set(policy, '{blocksClinicalAccess}', 'true'::jsonb)
      ),
      actor_user_id,
      'capacity-v3-invalid:' || gen_random_uuid()::text
    );
  exception when others then
    invalid_rejected :=
      position('PRICING_CUSTOM_CAPACITY_POLICY_INVALID' in sqlerrm) > 0;
  end;
  if not invalid_rejected then
    raise exception 'INVALID_DRAFT_POLICY_WAS_NOT_REJECTED';
  end if;

  saved_result := public.save_sales_pricing_catalog_draft_v2(
    test_catalog_id,
    'version',
    jsonb_build_object(
      'name',
      'Catálogo comercial v3 — blocos de capacidade',
      'customCapacityPolicy',
      policy
    ),
    actor_user_id,
    'capacity-v3-save:' || gen_random_uuid()::text
  );
  if saved_result->'custom_capacity_policy' is distinct from policy then
    raise exception 'SAVE_V2_DID_NOT_PERSIST_CAPACITY_POLICY';
  end if;

  for capacity_case in
    select * from (values
      (150, 0, 150, 159900, 15000),
      (151, 1, 160, 167890, 16000),
      (160, 1, 160, 167890, 16000),
      (161, 2, 170, 175880, 17000),
      (200, 5, 200, 199850, 20000)
    ) as cases(demand, blocks, total_limit, monthly_price, storage_mb)
  loop
    calculated_blocks := ceil(
      greatest(capacity_case.demand - 150, 0)::numeric / 10
    )::integer;
    if calculated_blocks <> capacity_case.blocks
       or 150 + calculated_blocks * 10 <> capacity_case.total_limit
       or 159900 + calculated_blocks * 7990 <> capacity_case.monthly_price
       or (150 + calculated_blocks * 10) * 100
         <> capacity_case.storage_mb then
      raise exception 'CUSTOM_CAPACITY_FORMULA_FAILED:%',
        capacity_case.demand;
    end if;
  end loop;

  published_result := public.publish_sales_pricing_catalog_version_v2(
    test_catalog_id,
    actor_user_id,
    'capacity-v3-publish:' || gen_random_uuid()::text
  );
  if published_result->>'status' <> 'active' then
    raise exception 'PUBLISHED_V3_NOT_ACTIVE';
  end if;
  if (
    select catalog_snapshot->'customCapacityPolicy'
      from public.sales_pricing_catalog_versions
     where id = test_catalog_id
  ) is distinct from policy then
    raise exception 'PUBLISHED_SNAPSHOT_POLICY_MISSING';
  end if;
  if (
    select count(*)
      from public.sales_pricing_catalog_versions
     where status = 'active'
  ) <> 1 then
    raise exception 'MORE_THAN_ONE_ACTIVE_CATALOG';
  end if;
  if (
    select status
      from public.sales_pricing_catalog_versions
     where id = source_catalog_id
  ) <> 'archived' then
    raise exception 'V2_NOT_ARCHIVED_BY_NORMAL_PUBLISH_FLOW';
  end if;
  if exists (
    select 1
      from public.sales_pricing_catalog_versions
     where version in (1, 2)
       and custom_capacity_policy is not null
  ) then
    raise exception 'V1_OR_V2_POLICY_CHANGED_DURING_PUBLISH';
  end if;

  select coalesce(
    jsonb_object_agg(
      catalog.version::text,
      encode(
        digest(
          (
            to_jsonb(catalog)
            - array[
                'status',
                'archived_at',
                'custom_capacity_policy'
              ]::text[]
          )::text,
          'sha256'
        ),
        'hex'
      )
    ),
    '{}'::jsonb
  ) into current_hash
    from public.sales_pricing_catalog_versions catalog
   where catalog.version in (1, 2);
  if current_hash is distinct from baseline.v1_v2_content_hash then
    raise exception 'V1_V2_CONTENT_HASH_CHANGED';
  end if;

  select encode(
    digest(
      coalesce(
        string_agg(snapshot_value, '|' order by snapshot_key),
        ''
      ),
      'sha256'
    ),
    'hex'
  ) into current_text_hash
    from (
      select
        'simulation:' || simulation.id::text as snapshot_key,
        concat_ws(
          ':',
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
          'requestHash', to_jsonb(offer)->'request_hash'
        )::text
        from public.sales_offers offer
    ) snapshots;
  if current_text_hash is distinct from baseline.historical_snapshot_hash then
    raise exception 'HISTORICAL_PROPOSAL_SNAPSHOT_CHANGED';
  end if;

  select encode(
    digest(
      concat_ws(
        '|',
        (
          select coalesce(
            string_agg(to_jsonb(payment)::text, '|' order by payment.id),
            ''
          )
            from public.payments payment
        ),
        (
          select coalesce(
            string_agg(to_jsonb(payment)::text, '|' order by payment.id),
            ''
          )
            from public.professional_payments payment
        ),
        (
          select coalesce(
            string_agg(to_jsonb(entry)::text, '|' order by entry.id),
            ''
          )
            from public.clinic_financial_entries entry
        )
      ),
      'sha256'
    ),
    'hex'
  ) into current_text_hash;
  if current_text_hash is distinct from baseline.dre_hash then
    raise exception 'REALIZED_DRE_CHANGED';
  end if;

  select encode(
    digest(
      concat_ws(
        '|',
        (
          select coalesce(
            string_agg(
              jsonb_build_object(
                'id', offer.id,
                'stripeCustomerId', to_jsonb(offer)->'stripe_customer_id',
                'stripeCheckoutSessionId',
                  to_jsonb(offer)->'stripe_checkout_session_id',
                'stripeSubscriptionId',
                  to_jsonb(offer)->'stripe_subscription_id'
              )::text,
              '|' order by offer.id
            ),
            ''
          )
            from public.sales_offers offer
        ),
        (
          select coalesce(
            string_agg(to_jsonb(link)::text, '|' order by link.id),
            ''
          )
            from public.sales_checkout_links link
        )
      ),
      'sha256'
    ),
    'hex'
  ) into current_text_hash;
  if current_text_hash is distinct from baseline.stripe_hash then
    raise exception 'STRIPE_STATE_CHANGED_BY_CATALOG_TEST';
  end if;

  if not pg_get_functiondef(
    'public.enrich_sales_modular_offer_snapshot_v1()'::regprocedure
  ) like '%results_snapshot#>''{basePackage,capacity}''%' then
    raise exception 'PROPOSAL_DOES_NOT_FREEZE_CAPACITY_SNAPSHOT';
  end if;

  if not exists (
    select 1
      from pg_trigger trigger_info
     where trigger_info.tgrelid =
       'public.patient_professional_links'::regclass
       and trigger_info.tgname =
         'enforce_patient_professional_link_limit_v1'
       and not trigger_info.tgisinternal
  ) then
    raise exception 'PROFESSIONAL_LIMIT_TRIGGER_MISSING';
  end if;
  if not exists (
    select 1
      from pg_class relation_info
     where relation_info.oid = 'public.sales_checkout_links'::regclass
       and relation_info.relrowsecurity
  ) then
    raise exception 'CHECKOUT_LINK_RLS_DISABLED';
  end if;
  if has_table_privilege(
       'authenticated',
       'public.sales_checkout_links',
       'select'
     )
     or has_table_privilege(
       'anon',
       'public.sales_checkout_links',
       'select'
     ) then
    raise exception 'CHECKOUT_LINK_CLIENT_ACCESS_LEAK';
  end if;
end
$test$;

rollback;

-- The transaction above published a temporary v3 and archived v2, then this
-- post-ROLLBACK assertion proves the original active catalog was restored.
do $rollback_test$
declare
  baseline verto_capacity_v3_baseline%rowtype;
  current_active_ids jsonb;
  current_v1_v2_hash jsonb;
begin
  select * into baseline
    from verto_capacity_v3_baseline
   limit 1;
  select coalesce(jsonb_agg(id order by id), '[]'::jsonb)
    into current_active_ids
    from public.sales_pricing_catalog_versions
   where status = 'active';
  if current_active_ids is distinct from baseline.active_catalog_ids then
    raise exception 'ROLLBACK_DID_NOT_RESTORE_ACTIVE_CATALOG';
  end if;
  select coalesce(
    jsonb_object_agg(
      catalog.version::text,
      encode(
        digest(
          (
            to_jsonb(catalog)
            - array[
                'status',
                'archived_at',
                'custom_capacity_policy'
              ]::text[]
          )::text,
          'sha256'
        ),
        'hex'
      )
    ),
    '{}'::jsonb
  ) into current_v1_v2_hash
    from public.sales_pricing_catalog_versions catalog
   where catalog.version in (1, 2);
  if current_v1_v2_hash is distinct from baseline.v1_v2_content_hash then
    raise exception 'ROLLBACK_DID_NOT_RESTORE_V1_V2';
  end if;
  if exists (
    select 1
      from public.sales_pricing_catalog_versions
     where version in (1, 2)
       and custom_capacity_policy is not null
  ) then
    raise exception 'ROLLBACK_LEFT_POLICY_ON_V1_OR_V2';
  end if;
end
$rollback_test$;
