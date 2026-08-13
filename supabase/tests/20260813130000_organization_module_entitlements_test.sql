-- Structural/integrity test for 20260813130000_organization_module_entitlements.sql.
-- Run manually only after applying the migration, preferably in staging/test.
-- This test does not delete or rewrite domain data.

begin;

do $schema_assertions$
declare
  v_table text;
  v_function_definition text;
begin
  foreach v_table in array array[
    'organization_module_access_profiles',
    'organization_module_entitlements',
    'organization_module_entitlement_events'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'TEST_TABLE_MISSING: %', v_table;
    end if;
    if not exists (
      select 1
        from pg_catalog.pg_class relation
        join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
       where namespace.nspname = 'public'
         and relation.relname = v_table
         and relation.relrowsecurity
    ) then
      raise exception 'TEST_RLS_NOT_ENABLED: %', v_table;
    end if;
  end loop;

  if exists (
    select 1
      from public.clinics c
      left join public.organization_module_access_profiles p
        on p.organization_id = c.id
     where p.organization_id is null
  ) then
    raise exception 'TEST_LEGACY_BACKFILL_INCOMPLETE';
  end if;

  if exists (
    select 1
      from public.organization_module_access_profiles
     where mode not in ('legacy_full', 'contract')
        or version < 1
  ) then
    raise exception 'TEST_ACCESS_PROFILE_INVALID';
  end if;

  if exists (
    select 1
      from public.organization_module_entitlements
     where module_key not in (
       'clinical_core','appointments_communication','financial_management','insurance_tiss','school_management'
     )
        or status not in ('active','trial','grace','suspended','cancelled')
  ) then
    raise exception 'TEST_ENTITLEMENT_ENUM_INVALID';
  end if;

  if has_function_privilege('anon', 'public.get_organization_module_access_v1(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.get_organization_module_access_v1(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.apply_sales_offer_module_entitlements_v1(uuid,uuid,text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.apply_sales_offer_module_entitlements_v1(uuid,uuid,text,text,text)', 'EXECUTE') then
    raise exception 'TEST_MODULE_RPC_EXPOSED_TO_BROWSER';
  end if;

  if not has_function_privilege('service_role', 'public.get_organization_module_access_v1(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.apply_sales_offer_module_entitlements_v1(uuid,uuid,text,text,text)', 'EXECUTE') then
    raise exception 'TEST_MODULE_RPC_SERVICE_ROLE_GRANT_MISSING';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_trigger trigger_info
     where trigger_info.tgrelid = 'public.organization_module_entitlement_events'::regclass
       and trigger_info.tgname = 'organization_module_entitlement_events_append_only_v1'
       and not trigger_info.tgisinternal
       and trigger_info.tgenabled <> 'D'
  ) then
    raise exception 'TEST_ENTITLEMENT_EVENT_APPEND_ONLY_TRIGGER_MISSING';
  end if;

  select pg_get_functiondef('public.apply_sales_offer_module_entitlements_v1(uuid,uuid,text,text,text)'::regprocedure)
    into v_function_definition;
  if position('sales_offer_items' in v_function_definition) = 0
     or position('on conflict (organization_id, module_key)' in lower(v_function_definition)) = 0
     or position('converted_clinic_id' in v_function_definition) = 0 then
    raise exception 'TEST_ENTITLEMENT_RPC_CANONICAL_SOURCE_OR_IDEMPOTENCY_MISSING';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.sales_offers'::regclass
       and conname = 'sales_offers_trial_days_check'
  ) then
    raise exception 'TEST_TRIAL_DAYS_CONSTRAINT_MISSING';
  end if;
end;
$schema_assertions$;

rollback;
