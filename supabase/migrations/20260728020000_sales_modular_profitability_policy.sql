-- Verto: versioned modular EBITDA policy and clinic-core cost allocation.
-- Additive/idempotent. Apply manually only after 20260728010000.
-- Published catalogs are never backfilled or changed by this migration.

begin;

create or replace function public.sales_profitability_policy_valid_v1(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $function$
declare
  expected_keys constant text[] := array[
    'capacityMinimumIncrementalMarginBasisPoints',
    'clinicMinimumEbitdaMarginBasisPoints',
    'driverExpansionPolicies',
    'fixedPaymentFeeAllocation',
    'moduleMinimumIncrementalMarginBasisPoints',
    'moduleTargetIncrementalMarginBasisPoints',
    'postPromotionMinimumEbitdaMarginBasisPoints',
    'pricingProfile',
    'recurringTargetEbitdaMarginBasisPoints',
    'schemaVersion',
    'sharedCostAllocation'
  ];
  expansion_keys constant text[] := array[
    'blockPriceCents','blockSizeUnits','driverKey','effectiveAt','enabled',
    'includedUnits','source','sourceDetail','version'
  ];
  known_expansions constant jsonb := '{
    "appointments_communication":"monthlyAppointments",
    "financial_management":"financialEntries",
    "insurance_tiss":"tissGuides",
    "school_management":"schoolPatients",
    "additional_storage":"expectedStorageGb"
  }'::jsonb;
  received_keys text[];
  expansion record;
  received_expansion_keys text[];
  numeric_key text;
begin
  if value is null or jsonb_typeof(value) <> 'object' then return false; end if;
  select array_agg(key order by key) into received_keys
    from jsonb_object_keys(value) key;
  if received_keys is distinct from expected_keys then return false; end if;
  if value->'schemaVersion' is distinct from '1'::jsonb
     or value->>'pricingProfile' <> 'intensive'
     or value->>'sharedCostAllocation' <> 'clinical_core'
     or value->>'fixedPaymentFeeAllocation' <> 'clinical_core'
     or jsonb_typeof(value->'driverExpansionPolicies') <> 'object' then
    return false;
  end if;
  if exists (
    select 1
      from unnest(array[
        'clinicMinimumEbitdaMarginBasisPoints',
        'recurringTargetEbitdaMarginBasisPoints',
        'moduleTargetIncrementalMarginBasisPoints',
        'moduleMinimumIncrementalMarginBasisPoints',
        'capacityMinimumIncrementalMarginBasisPoints',
        'postPromotionMinimumEbitdaMarginBasisPoints'
      ]) margin_key
     where coalesce(value->>margin_key, '') !~ '^[0-9]+$'
        or (value->>margin_key)::integer not between 0 and 9999
  ) then
    return false;
  end if;
  if (value->>'clinicMinimumEbitdaMarginBasisPoints')::integer
       > (value->>'recurringTargetEbitdaMarginBasisPoints')::integer
     or (value->>'recurringTargetEbitdaMarginBasisPoints')::integer
       > (value->>'moduleMinimumIncrementalMarginBasisPoints')::integer
     or (value->>'moduleMinimumIncrementalMarginBasisPoints')::integer
       > (value->>'moduleTargetIncrementalMarginBasisPoints')::integer
     or (value->>'capacityMinimumIncrementalMarginBasisPoints')::integer
       < (value->>'clinicMinimumEbitdaMarginBasisPoints')::integer
     or (value->>'postPromotionMinimumEbitdaMarginBasisPoints')::integer
       < (value->>'clinicMinimumEbitdaMarginBasisPoints')::integer then
    return false;
  end if;
  for expansion in
    select key, value
      from jsonb_each(value->'driverExpansionPolicies')
  loop
    if not known_expansions ? expansion.key
       or jsonb_typeof(expansion.value) <> 'object' then
      return false;
    end if;
    select array_agg(key order by key) into received_expansion_keys
      from jsonb_object_keys(expansion.value) key;
    if received_expansion_keys is distinct from expansion_keys
       or expansion.value->>'driverKey'
         is distinct from known_expansions->>expansion.key
       or jsonb_typeof(expansion.value->'enabled') <> 'boolean'
       or coalesce(expansion.value->>'source', '') not in (
         'actual','calculated','estimated','manual','unavailable'
       )
       or char_length(btrim(coalesce(expansion.value->>'sourceDetail', ''))) < 2
       or coalesce(expansion.value->>'version', '') !~ '^[1-9][0-9]{0,9}$'
       or coalesce(expansion.value->>'effectiveAt', '') = '' then
      return false;
    end if;
    perform (expansion.value->>'effectiveAt')::timestamptz;
    foreach numeric_key in array array[
      'includedUnits','blockSizeUnits','blockPriceCents'
    ]
    loop
      if jsonb_typeof(expansion.value->numeric_key) <> 'null'
         and (
           jsonb_typeof(expansion.value->numeric_key) <> 'number'
           or coalesce(expansion.value->>numeric_key, '')
             !~ '^[0-9]+([.][0-9]+)?$'
         ) then
        return false;
      end if;
    end loop;
    if jsonb_typeof(expansion.value->'blockPriceCents') <> 'null'
       and coalesce(expansion.value->>'blockPriceCents', '') !~ '^[0-9]+$' then
      return false;
    end if;
    if expansion.value->>'enabled' = 'true' and (
      expansion.value->>'source' = 'unavailable'
      or coalesce(expansion.value->>'includedUnits', '') !~ '^[0-9]+([.][0-9]+)?$'
      or coalesce(expansion.value->>'blockSizeUnits', '') !~ '^[0-9]+([.][0-9]+)?$'
      or (expansion.value->>'blockSizeUnits')::numeric <= 0
      or coalesce(expansion.value->>'blockPriceCents', '') !~ '^[0-9]+$'
    ) then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end
$function$;

alter table public.sales_pricing_catalog_versions
  add column if not exists profitability_policy jsonb;

alter table public.sales_pricing_catalog_versions
  alter column profitability_policy drop default,
  alter column profitability_policy drop not null;

alter table public.sales_pricing_catalog_versions
  drop constraint if exists sales_pricing_catalog_profitability_policy_valid;
alter table public.sales_pricing_catalog_versions
  add constraint sales_pricing_catalog_profitability_policy_valid
  check (
    profitability_policy is null
    or public.sales_profitability_policy_valid_v1(profitability_policy)
  );

create or replace function public.protect_sales_profitability_publication_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if old.status = 'draft' and new.status = 'active' then
    if old.profitability_policy is null
       or not public.sales_profitability_policy_valid_v1(
         old.profitability_policy
       ) then
      raise exception 'PRICING_CATALOG_PUBLICATION_BLOCKED:PROFITABILITY_POLICY'
        using errcode = '22023';
    end if;
    new.catalog_snapshot := jsonb_set(
      coalesce(new.catalog_snapshot, '{}'::jsonb),
      '{profitabilityPolicy}',
      old.profitability_policy,
      true
    );
  end if;
  return new;
end
$function$;

drop trigger if exists sales_pricing_catalog_profitability_publish_v1
  on public.sales_pricing_catalog_versions;
create trigger sales_pricing_catalog_profitability_publish_v1
before update on public.sales_pricing_catalog_versions
for each row execute function public.protect_sales_profitability_publication_v1();

create or replace function public.clone_sales_pricing_catalog_version_v3(
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
  existing_event public.sales_pricing_catalog_audit_events%rowtype;
  default_policy constant jsonb := '{
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
begin
  if p_source_version_id is null
     or p_actor_user_id is null
     or char_length(btrim(coalesce(p_name, ''))) < 2
     or char_length(coalesce(p_idempotency_key, '')) < 12 then
    raise exception 'PRICING_CATALOG_INVALID' using errcode = '22023';
  end if;
  select * into existing_event
    from public.sales_pricing_catalog_audit_events
   where idempotency_key = p_idempotency_key
     and actor_user_id = p_actor_user_id;
  if found then
    if existing_event.event_type <> 'catalog_cloned_v3'
       or existing_event.payload->>'sourceVersionId'
         is distinct from p_source_version_id::text
       or existing_event.payload->>'name'
         is distinct from left(btrim(p_name), 120) then
      raise exception 'PRICING_CATALOG_IDEMPOTENCY_CONFLICT'
        using errcode = '23505';
    end if;
    return existing_event.payload->'result';
  end if;
  result := public.clone_sales_pricing_catalog_version_v2(
    p_source_version_id,
    p_name,
    p_actor_user_id,
    left(p_idempotency_key, 180) || ':economics-base'
  );
  created_id := (result->>'id')::uuid;
  update public.sales_pricing_catalog_versions target
     set profitability_policy = coalesce(
       source.profitability_policy,
       default_policy
     )
    from public.sales_pricing_catalog_versions source
   where target.id = created_id
     and source.id = p_source_version_id
     and target.status = 'draft'
   returning to_jsonb(target) into result;
  if result is null then
    raise exception 'PRICING_CATALOG_IMMUTABLE' using errcode = '55000';
  end if;
  insert into public.sales_pricing_catalog_audit_events (
    catalog_version_id,event_type,actor_user_id,payload,idempotency_key
  ) values (
    created_id,
    'catalog_cloned_v3',
    p_actor_user_id,
    jsonb_build_object(
      'sourceVersionId', p_source_version_id,
      'name', left(btrim(p_name), 120),
      'result', result
    ),
    p_idempotency_key
  );
  return result;
end
$function$;

create or replace function public.save_sales_pricing_catalog_draft_v3(
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
  existing_event public.sales_pricing_catalog_audit_events%rowtype;
  version_status text;
begin
  if p_catalog_version_id is null
     or p_actor_user_id is null
     or char_length(coalesce(p_idempotency_key, '')) < 12
     or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'PRICING_CATALOG_INVALID' using errcode = '22023';
  end if;
  select * into existing_event
    from public.sales_pricing_catalog_audit_events
   where idempotency_key = p_idempotency_key
     and actor_user_id = p_actor_user_id;
  if found then
    if existing_event.catalog_version_id <> p_catalog_version_id
       or existing_event.event_type <> ('catalog_draft_' || p_action || '_saved_v3')
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
  if p_action = 'version'
     and p_payload ? 'profitabilityPolicy'
     and not public.sales_profitability_policy_valid_v1(
       p_payload->'profitabilityPolicy'
     ) then
    raise exception 'PRICING_PROFITABILITY_POLICY_INVALID'
      using errcode = '22023';
  end if;
  result := public.save_sales_pricing_catalog_draft_v2(
    p_catalog_version_id,
    p_action,
    p_payload - 'profitabilityPolicy',
    p_actor_user_id,
    left(p_idempotency_key, 180) || ':economics-base'
  );
  if p_action = 'version' and p_payload ? 'profitabilityPolicy' then
    update public.sales_pricing_catalog_versions
       set profitability_policy = p_payload->'profitabilityPolicy'
     where id = p_catalog_version_id
       and status = 'draft'
     returning to_jsonb(sales_pricing_catalog_versions) into result;
  end if;
  insert into public.sales_pricing_catalog_audit_events (
    catalog_version_id,event_type,actor_user_id,payload,idempotency_key
  ) values (
    p_catalog_version_id,
    'catalog_draft_' || p_action || '_saved_v3',
    p_actor_user_id,
    jsonb_build_object('request', p_payload, 'result', result),
    p_idempotency_key
  );
  return result;
end
$function$;

create or replace function public.publish_sales_pricing_catalog_version_v3(
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
  result jsonb;
  version_row public.sales_pricing_catalog_versions%rowtype;
  existing_event public.sales_pricing_catalog_audit_events%rowtype;
begin
  if p_catalog_version_id is null
     or p_actor_user_id is null
     or char_length(coalesce(p_idempotency_key, '')) < 12 then
    raise exception 'PRICING_CATALOG_INVALID' using errcode = '22023';
  end if;
  select * into existing_event
    from public.sales_pricing_catalog_audit_events
   where idempotency_key = p_idempotency_key
     and actor_user_id = p_actor_user_id;
  if found then
    if existing_event.catalog_version_id <> p_catalog_version_id
       or existing_event.event_type <> 'catalog_published_v3' then
      raise exception 'PRICING_CATALOG_IDEMPOTENCY_CONFLICT'
        using errcode = '23505';
    end if;
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
  if version_row.profitability_policy is null
     or not public.sales_profitability_policy_valid_v1(
       version_row.profitability_policy
     ) then
    raise exception 'PRICING_CATALOG_PUBLICATION_BLOCKED:PROFITABILITY_POLICY'
      using errcode = '22023';
  end if;
  result := public.publish_sales_pricing_catalog_version_v2(
    p_catalog_version_id,
    p_actor_user_id,
    left(p_idempotency_key, 180) || ':economics-base'
  );
  select to_jsonb(version) into result
    from public.sales_pricing_catalog_versions version
   where version.id = p_catalog_version_id
     and version.status = 'active'
     and version.catalog_snapshot->'profitabilityPolicy'
       is not distinct from version.profitability_policy;
  if result is null then
    raise exception 'PRICING_CATALOG_PUBLICATION_BLOCKED:SNAPSHOT'
      using errcode = '22023';
  end if;
  insert into public.sales_pricing_catalog_audit_events (
    catalog_version_id,event_type,actor_user_id,payload,idempotency_key
  ) values (
    p_catalog_version_id,
    'catalog_published_v3',
    p_actor_user_id,
    jsonb_build_object(
      'modelVersion','2026-07-28-v5',
      'result',result
    ),
    p_idempotency_key
  );
  return result;
end
$function$;

revoke all on function public.sales_profitability_policy_valid_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.protect_sales_profitability_publication_v1()
  from public, anon, authenticated;
revoke all on function public.clone_sales_pricing_catalog_version_v3(
  uuid,text,uuid,text
) from public, anon, authenticated;
revoke all on function public.save_sales_pricing_catalog_draft_v3(
  uuid,text,jsonb,uuid,text
) from public, anon, authenticated;
revoke all on function public.publish_sales_pricing_catalog_version_v3(
  uuid,uuid,text
) from public, anon, authenticated;

grant execute on function public.sales_profitability_policy_valid_v1(jsonb)
  to service_role;
grant execute on function public.clone_sales_pricing_catalog_version_v3(
  uuid,text,uuid,text
) to service_role;
grant execute on function public.save_sales_pricing_catalog_draft_v3(
  uuid,text,jsonb,uuid,text
) to service_role;
grant execute on function public.publish_sales_pricing_catalog_version_v3(
  uuid,uuid,text
) to service_role;

comment on column public.sales_pricing_catalog_versions.profitability_policy is
  'Versioned EBITDA, clinic-core allocation and driver expansion policy. Null on historical catalogs.';

commit;
