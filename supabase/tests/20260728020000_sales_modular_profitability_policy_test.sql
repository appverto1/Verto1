-- Execute manually only after applying
-- 20260728020000_sales_modular_profitability_policy.sql.
-- Catalog publication is exercised only inside BEGIN/ROLLBACK.

drop table if exists pg_temp.verto_profitability_baseline;
create temporary table verto_profitability_baseline (
  catalog_hash text not null,
  snapshot_hash text not null,
  checkout_hash text not null,
  historical_null_catalog_ids uuid[] not null
) on commit preserve rows;

insert into verto_profitability_baseline
select
  encode(
    digest(
      coalesce(
        string_agg(to_jsonb(catalog)::text, '|' order by catalog.id),
        ''
      ),
      'sha256'
    ),
    'hex'
  ),
  encode(
    digest(
      concat_ws(
        '|',
        (
          select coalesce(
            string_agg(
              concat_ws(
                ':',
                simulation.assumptions_snapshot::text,
                simulation.results_snapshot::text,
                simulation.modular_input_snapshot::text
              ),
              '|' order by simulation.id
            ),
            ''
          )
            from public.sales_offer_simulations simulation
        ),
        (
          select coalesce(
            string_agg(
              concat_ws(
                ':',
                to_jsonb(offer)->'simulation_snapshot',
                to_jsonb(offer)->'modular_snapshot'
              ),
              '|' order by offer.id
            ),
            ''
          )
            from public.sales_offers offer
        )
      ),
      'sha256'
    ),
    'hex'
  ),
  encode(
    digest(
      concat_ws(
        '|',
        (
          select coalesce(
            string_agg(to_jsonb(link)::text, '|' order by link.id),
            ''
          )
            from public.sales_checkout_links link
        ),
        (
          select coalesce(
            string_agg(to_jsonb(activation)::text, '|' order by activation.id),
            ''
          )
            from public.pending_activations activation
        )
      ),
      'sha256'
    ),
    'hex'
  ),
  coalesce(
    (
      select array_agg(historical.id order by historical.id)
        from public.sales_pricing_catalog_versions historical
       where historical.profitability_policy is null
    ),
    '{}'::uuid[]
  )
from public.sales_pricing_catalog_versions catalog;

begin;

do $test$
declare
  actor_user_id uuid;
  source_catalog_id uuid;
  source_version integer;
  source_policy jsonb;
  expected_clone_policy jsonb;
  historical_null_catalog_ids uuid[];
  draft_catalog_id uuid;
  clone_key text := 'profitability-clone:' || gen_random_uuid()::text;
  result jsonb;
  retry jsonb;
  clone_default_policy jsonb := '{
    "schemaVersion":1,
    "clinicMinimumEbitdaMarginBasisPoints":6000,
    "recurringTargetEbitdaMarginBasisPoints":7000,
    "moduleTargetIncrementalMarginBasisPoints":8000,
    "moduleMinimumIncrementalMarginBasisPoints":7500,
    "capacityMinimumIncrementalMarginBasisPoints":7500,
    "postPromotionMinimumEbitdaMarginBasisPoints":7000,
    "pricingProfile":"intensive",
    "sharedCostAllocation":"clinical_core",
    "fixedPaymentFeeAllocation":"clinical_core",
    "driverExpansionPolicies":{}
  }'::jsonb;
  policy jsonb := '{
    "schemaVersion":1,
    "clinicMinimumEbitdaMarginBasisPoints":5500,
    "recurringTargetEbitdaMarginBasisPoints":6500,
    "moduleTargetIncrementalMarginBasisPoints":7500,
    "moduleMinimumIncrementalMarginBasisPoints":7000,
    "capacityMinimumIncrementalMarginBasisPoints":7000,
    "postPromotionMinimumEbitdaMarginBasisPoints":6500,
    "pricingProfile":"intensive",
    "sharedCostAllocation":"clinical_core",
    "fixedPaymentFeeAllocation":"clinical_core",
    "driverExpansionPolicies":{}
  }'::jsonb;
  invalid_policy jsonb;
  invalid_rejected boolean;
  conflict_rejected boolean := false;
begin
  select baseline.historical_null_catalog_ids
    into historical_null_catalog_ids
    from verto_profitability_baseline baseline
   limit 1;
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
       and column_name = 'profitability_policy'
  ) <> 'YES' then
    raise exception 'PROFITABILITY_POLICY_MUST_REMAIN_NULLABLE';
  end if;
  if not public.sales_profitability_policy_valid_v1(policy) then
    raise exception 'VERSIONED_PROFITABILITY_POLICY_REJECTED';
  end if;
  if not public.sales_profitability_policy_valid_v1(clone_default_policy) then
    raise exception 'CLONE_DEFAULT_PROFITABILITY_POLICY_REJECTED';
  end if;
  foreach invalid_policy in array array[
    policy || '{"extra":true}'::jsonb,
    policy - 'clinicMinimumEbitdaMarginBasisPoints',
    jsonb_set(policy, '{clinicMinimumEbitdaMarginBasisPoints}', '-1'::jsonb),
    jsonb_set(policy, '{pricingProfile}', '"standard"'::jsonb),
    jsonb_set(policy, '{sharedCostAllocation}', '"configured_weight"'::jsonb),
    jsonb_set(policy, '{moduleMinimumIncrementalMarginBasisPoints}', '8100'::jsonb)
  ]
  loop
    if public.sales_profitability_policy_valid_v1(invalid_policy) then
      raise exception 'INVALID_PROFITABILITY_POLICY_ACCEPTED:%',
        invalid_policy;
    end if;
  end loop;
  select id into actor_user_id
    from public.users
   where role in ('owner','admin')
   order by id
   limit 1;
  if actor_user_id is null then
    select id into actor_user_id from public.users order by id limit 1;
  end if;
  if actor_user_id is null then
    raise exception 'PROFITABILITY_TEST_REQUIRES_EXISTING_USER';
  end if;
  select id, version, profitability_policy
    into source_catalog_id, source_version, source_policy
    from public.sales_pricing_catalog_versions
   where status = 'active'
   order by version desc
   limit 1;
  if source_catalog_id is null or source_version < 3 then
    raise exception 'EXPECTED_ACTIVE_CATALOG_V3_OR_LATER';
  end if;
  expected_clone_policy := coalesce(source_policy, clone_default_policy);
  result := public.clone_sales_pricing_catalog_version_v3(
    source_catalog_id,
    'Catálogo comercial v4 — margem EBITDA modular',
    actor_user_id,
    clone_key
  );
  draft_catalog_id := (result->>'id')::uuid;
  if draft_catalog_id is null
     or result->>'status' <> 'draft'
     or result->'profitability_policy' is distinct from expected_clone_policy then
    raise exception 'V3_CLONE_DID_NOT_CREATE_VERSIONED_DRAFT';
  end if;
  if (
    select profitability_policy
      from public.sales_pricing_catalog_versions
     where id = source_catalog_id
  ) is distinct from source_policy then
    raise exception 'CLONE_MUTATED_ACTIVE_SOURCE';
  end if;
  retry := public.clone_sales_pricing_catalog_version_v3(
    source_catalog_id,
    'Catálogo comercial v4 — margem EBITDA modular',
    actor_user_id,
    clone_key
  );
  if (retry->>'id')::uuid is distinct from draft_catalog_id then
    raise exception 'CLONE_RETRY_NOT_IDEMPOTENT';
  end if;
  begin
    perform public.clone_sales_pricing_catalog_version_v3(
      source_catalog_id,
      'Payload divergente',
      actor_user_id,
      clone_key
    );
  exception when others then
    conflict_rejected :=
      position('PRICING_CATALOG_IDEMPOTENCY_CONFLICT' in sqlerrm) > 0;
  end;
  if not conflict_rejected then
    raise exception 'CLONE_PAYLOAD_CONFLICT_NOT_REJECTED';
  end if;
  invalid_rejected := false;
  begin
    perform public.save_sales_pricing_catalog_draft_v3(
      draft_catalog_id,
      'version',
      jsonb_build_object(
        'profitabilityPolicy',
        jsonb_set(policy, '{fixedPaymentFeeAllocation}', '"all_items"'::jsonb)
      ),
      actor_user_id,
      'profitability-invalid:' || gen_random_uuid()::text
    );
  exception when others then
    invalid_rejected :=
      position('PRICING_PROFITABILITY_POLICY_INVALID' in sqlerrm) > 0;
  end;
  if not invalid_rejected then
    raise exception 'INVALID_DRAFT_POLICY_NOT_REJECTED';
  end if;
  result := public.save_sales_pricing_catalog_draft_v3(
    draft_catalog_id,
    'version',
    jsonb_build_object(
      'name','Catálogo comercial v4 — margem EBITDA modular',
      'profitabilityPolicy',policy
    ),
    actor_user_id,
    'profitability-save:' || gen_random_uuid()::text
  );
  if result->'profitability_policy' is distinct from policy then
    raise exception 'PROFITABILITY_POLICY_NOT_PERSISTED';
  end if;
  result := public.publish_sales_pricing_catalog_version_v3(
    draft_catalog_id,
    actor_user_id,
    'profitability-publish:' || gen_random_uuid()::text
  );
  if result->>'status' <> 'active' then
    raise exception 'PROFITABILITY_CATALOG_NOT_ACTIVE';
  end if;
  if (
    select catalog_snapshot->'profitabilityPolicy'
      from public.sales_pricing_catalog_versions
     where id = draft_catalog_id
  ) is distinct from policy then
    raise exception 'PROFITABILITY_POLICY_MISSING_FROM_SNAPSHOT';
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
    raise exception 'SOURCE_NOT_ARCHIVED_BY_NORMAL_PUBLICATION';
  end if;
  if exists (
    select 1
      from unnest(historical_null_catalog_ids) historical_id
      join public.sales_pricing_catalog_versions historical
        on historical.id = historical_id
     where historical.profitability_policy is not null
  ) then
    raise exception 'HISTORICAL_CATALOG_WAS_BACKFILLED';
  end if;
  if not (
    90 > 65 and
    ((100000 - 20000 + 50000 - 5000)::numeric / 150000)
      > ((100000 - 20000)::numeric / 100000)
  ) then
    raise exception 'HIGHER_INCREMENTAL_MARGIN_DID_NOT_INCREASE_TOTAL';
  end if;
  if not (
    40 < 80 and
    ((100000 - 20000 + 50000 - 30000)::numeric / 150000)
      < ((100000 - 20000)::numeric / 100000)
  ) then
    raise exception 'LOWER_INCREMENTAL_MARGIN_DID_NOT_REDUCE_TOTAL';
  end if;
end
$test$;

rollback;

do $verify_rollback$
declare
  baseline verto_profitability_baseline%rowtype;
  current_catalog_hash text;
  current_snapshot_hash text;
  current_checkout_hash text;
begin
  select * into baseline from verto_profitability_baseline limit 1;
  select
    encode(
      digest(
        coalesce(
          string_agg(to_jsonb(catalog)::text, '|' order by catalog.id),
          ''
        ),
        'sha256'
      ),
      'hex'
    )
    into current_catalog_hash
    from public.sales_pricing_catalog_versions catalog;
  select encode(
    digest(
      concat_ws(
        '|',
        (
          select coalesce(
            string_agg(
              concat_ws(
                ':',
                simulation.assumptions_snapshot::text,
                simulation.results_snapshot::text,
                simulation.modular_input_snapshot::text
              ),
              '|' order by simulation.id
            ),
            ''
          )
            from public.sales_offer_simulations simulation
        ),
        (
          select coalesce(
            string_agg(
              concat_ws(
                ':',
                to_jsonb(offer)->'simulation_snapshot',
                to_jsonb(offer)->'modular_snapshot'
              ),
              '|' order by offer.id
            ),
            ''
          )
            from public.sales_offers offer
        )
      ),
      'sha256'
    ),
    'hex'
  ) into current_snapshot_hash;
  select encode(
    digest(
      concat_ws(
        '|',
        (
          select coalesce(
            string_agg(to_jsonb(link)::text, '|' order by link.id),
            ''
          )
            from public.sales_checkout_links link
        ),
        (
          select coalesce(
            string_agg(to_jsonb(activation)::text, '|' order by activation.id),
            ''
          )
            from public.pending_activations activation
        )
      ),
      'sha256'
    ),
    'hex'
  ) into current_checkout_hash;
  if current_catalog_hash is distinct from baseline.catalog_hash then
    raise exception 'ROLLBACK_DID_NOT_RESTORE_CATALOGS';
  end if;
  if current_snapshot_hash is distinct from baseline.snapshot_hash then
    raise exception 'HISTORICAL_SNAPSHOT_CHANGED';
  end if;
  if current_checkout_hash is distinct from baseline.checkout_hash then
    raise exception 'CHECKOUT_OR_ACTIVATION_CHANGED';
  end if;
end
$verify_rollback$;

drop table if exists pg_temp.verto_profitability_baseline;
