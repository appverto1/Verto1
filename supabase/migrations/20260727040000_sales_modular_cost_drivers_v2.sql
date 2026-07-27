-- Motor modular v2: propriedade explicita de custos, drivers e storage/egress.
-- Revisao: compatibilidade PostgreSQL/Supabase e validacao coerente com ownership.
-- Migration aditiva. Nao recria catalogos, nao recalcula snapshots e nao toca a DRE realizada.
begin;

do $migration_guard$
begin
  if to_regclass('public.sales_pricing_catalog_versions') is null
     or to_regclass('public.sales_pricing_item_cost_models') is null
     or to_regprocedure('public.save_sales_pricing_catalog_draft_v1(uuid,text,jsonb,uuid,text)') is null then
    raise exception 'MIGRATION_DEPENDENCY_MISSING:20260727030000_sales_modular_proposal_builder.sql';
  end if;
end
$migration_guard$;

alter table public.sales_pricing_catalog_versions
  add column if not exists modular_cost_settings jsonb not null default
  '{
    "schemaVersion": 2,
    "ownership": {
      "variablePatientCost": "item_direct",
      "variableClinicCost": "item_direct",
      "storageCost": "item_direct",
      "egressCost": "item_direct",
      "processingCost": "item_direct",
      "notificationCost": "item_direct",
      "otherVariableCost": "item_direct",
      "supportClinicCost": "item_direct",
      "supportPatientCost": "item_direct",
      "operationalCost": "item_direct",
      "fixedMonthlyEligibleCost": "shared"
    },
    "ownershipJustifications": {},
    "includedStorageMbPerPatient": 100,
    "usageProfiles": {
      "light": {"storageUtilizationBasisPoints": 2500, "expectedEgressMultiplier": null},
      "standard": {"storageUtilizationBasisPoints": 6000, "expectedEgressMultiplier": null},
      "intensive": {"storageUtilizationBasisPoints": 10000, "expectedEgressMultiplier": null}
    }
  }'::jsonb;

alter table public.sales_pricing_item_cost_models
  add column if not exists driver_config jsonb not null default '{}'::jsonb,
  add column if not exists other_variable_cost_cents integer;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.sales_pricing_catalog_versions'::regclass
       and conname = 'sales_pricing_catalog_versions_modular_cost_settings_object_v2'
  ) then
    alter table public.sales_pricing_catalog_versions
      add constraint sales_pricing_catalog_versions_modular_cost_settings_object_v2
      check (jsonb_typeof(modular_cost_settings) = 'object') not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.sales_pricing_item_cost_models'::regclass
       and conname = 'sales_pricing_item_cost_models_driver_config_object_v2'
  ) then
    alter table public.sales_pricing_item_cost_models
      add constraint sales_pricing_item_cost_models_driver_config_object_v2
      check (jsonb_typeof(driver_config) = 'object') not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.sales_pricing_item_cost_models'::regclass
       and conname = 'sales_pricing_item_cost_models_other_variable_non_negative_v2'
  ) then
    alter table public.sales_pricing_item_cost_models
      add constraint sales_pricing_item_cost_models_other_variable_non_negative_v2
      check (other_variable_cost_cents is null or other_variable_cost_cents >= 0) not valid;
  end if;
end
$constraints$;

alter table public.sales_pricing_catalog_versions
  validate constraint sales_pricing_catalog_versions_modular_cost_settings_object_v2;
alter table public.sales_pricing_item_cost_models
  validate constraint sales_pricing_item_cost_models_driver_config_object_v2;
alter table public.sales_pricing_item_cost_models
  validate constraint sales_pricing_item_cost_models_other_variable_non_negative_v2;

create or replace function public.sales_modular_cost_settings_valid_v2(p_settings jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
declare
  profile_key text;
  profile_settings jsonb;
  storage_utilization numeric;
  egress_multiplier numeric;
begin
  if jsonb_typeof(p_settings) is distinct from 'object'
     or p_settings->'schemaVersion' is distinct from '2'::jsonb
     or jsonb_typeof(p_settings->'ownership') is distinct from 'object'
     or (select count(*) from jsonb_object_keys(p_settings->'ownership')) <> 11
     or exists (
       select 1
         from jsonb_each_text(p_settings->'ownership') ownership
        where ownership.key not in (
          'variablePatientCost', 'variableClinicCost', 'storageCost',
          'egressCost', 'processingCost', 'notificationCost',
          'otherVariableCost', 'supportClinicCost', 'supportPatientCost',
          'operationalCost', 'fixedMonthlyEligibleCost'
        )
           or ownership.value not in ('shared', 'item_direct', 'excluded')
     )
     or exists (
       select 1
         from unnest(array[
           'variablePatientCost', 'variableClinicCost', 'storageCost',
           'egressCost', 'processingCost', 'notificationCost',
           'otherVariableCost', 'supportClinicCost', 'supportPatientCost',
           'operationalCost', 'fixedMonthlyEligibleCost'
         ]) required_key
        where not (p_settings->'ownership' ? required_key)
     )
     or jsonb_typeof(p_settings->'ownershipJustifications') is distinct from 'object'
     or jsonb_typeof(p_settings->'includedStorageMbPerPatient') is distinct from 'number'
     or (p_settings->>'includedStorageMbPerPatient')::numeric <= 0
     or jsonb_typeof(p_settings->'usageProfiles') is distinct from 'object'
     or (select count(*) from jsonb_object_keys(p_settings->'usageProfiles')) <> 3
     or exists (
       select 1
         from jsonb_object_keys(p_settings->'usageProfiles') profile_name
        where profile_name not in ('light', 'standard', 'intensive')
     ) then
    return false;
  end if;

  foreach profile_key in array array['light', 'standard', 'intensive']
  loop
    profile_settings := p_settings#>array['usageProfiles', profile_key];
    if jsonb_typeof(profile_settings) is distinct from 'object'
       or not (profile_settings ? 'storageUtilizationBasisPoints')
       or not (profile_settings ? 'expectedEgressMultiplier')
       or jsonb_typeof(profile_settings->'storageUtilizationBasisPoints') is distinct from 'number' then
      return false;
    end if;
    storage_utilization := (profile_settings->>'storageUtilizationBasisPoints')::numeric;
    if storage_utilization < 0 or storage_utilization > 10000 then
      return false;
    end if;
    if profile_settings->'expectedEgressMultiplier' is distinct from 'null'::jsonb then
      if jsonb_typeof(profile_settings->'expectedEgressMultiplier') is distinct from 'number' then
        return false;
      end if;
      egress_multiplier := (profile_settings->>'expectedEgressMultiplier')::numeric;
      if egress_multiplier < 0 then return false; end if;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$function$;

create or replace function public.sales_modular_required_drivers_v2(p_item_key text)
returns text[]
language sql
immutable
set search_path = pg_catalog, public
as $function$
  select case p_item_key
    when 'clinical_core' then array[
      'monthlyClinicalSessions', 'monthlyAbaSessions',
      'monthlyAbaRecords', 'generatedDocuments'
    ]
    when 'appointments_communication' then array[
      'monthlyAppointments', 'remindersPerAppointment',
      'internalNotifications', 'emails', 'webPushNotifications'
    ]
    when 'financial_management' then array[
      'financialEntries', 'financialReports', 'recurringProcesses'
    ]
    when 'insurance_tiss' then array[
      'tissGuides', 'tissBatches', 'tissXmlDocuments',
      'tissDocuments', 'expectedStorageGb'
    ]
    when 'school_management' then array[
      'schoolPatients', 'schoolMeetings', 'schoolParticipants',
      'schoolDocuments', 'schoolNotifications', 'expectedStorageGb'
    ]
    when 'onboarding' then array[
      'onboardingConfigurationHours', 'onboardingTrainingHours',
      'onboardingImportHours'
    ]
    else array[]::text[]
  end;
$function$;

create or replace function public.sales_modular_cost_category_applies_v2(
  p_item_key text,
  p_category text
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $function$
  select case p_item_key
    when 'clinical_core' then p_category = any(array[
      'variablePatientCost', 'variableClinicCost', 'storageCost',
      'egressCost', 'otherVariableCost', 'supportClinicCost',
      'supportPatientCost', 'operationalCost', 'fixedMonthlyEligibleCost'
    ])
    when 'appointments_communication' then p_category = any(array[
      'variablePatientCost', 'variableClinicCost', 'notificationCost',
      'otherVariableCost', 'supportClinicCost', 'supportPatientCost',
      'operationalCost', 'fixedMonthlyEligibleCost'
    ])
    when 'financial_management' then p_category = any(array[
      'variableClinicCost', 'processingCost', 'otherVariableCost',
      'supportClinicCost', 'operationalCost', 'fixedMonthlyEligibleCost'
    ])
    when 'insurance_tiss' then p_category = any(array[
      'variableClinicCost', 'storageCost', 'egressCost', 'processingCost',
      'otherVariableCost', 'supportClinicCost', 'operationalCost',
      'fixedMonthlyEligibleCost'
    ])
    when 'school_management' then p_category = any(array[
      'variablePatientCost', 'variableClinicCost', 'storageCost',
      'egressCost', 'processingCost', 'notificationCost',
      'otherVariableCost', 'supportClinicCost', 'supportPatientCost',
      'operationalCost', 'fixedMonthlyEligibleCost'
    ])
    when 'additional_storage' then p_category = any(array[
      'storageCost', 'egressCost', 'otherVariableCost'
    ])
    when 'onboarding' then false
    else false
  end;
$function$;

create or replace function public.sales_modular_resolve_owned_cost_v2(
  p_ownership text,
  p_shared_cost_cents bigint,
  p_direct_cost_cents bigint,
  p_applies boolean default true
)
returns bigint
language sql
immutable
set search_path = pg_catalog, public
as $function$
  select case
    when not coalesce(p_applies, false) then 0
    when p_ownership = 'shared' then p_shared_cost_cents
    when p_ownership = 'item_direct' then p_direct_cost_cents
    when p_ownership = 'excluded' then 0
    else null
  end;
$function$;

create or replace function public.sales_modular_driver_config_valid_v2(
  p_item_key text,
  p_config jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
declare
  required_driver text;
  profile_key text;
  datum jsonb;
  configured_required text[];
  expected_required text[];
  configured_count integer;
  configured_distinct_count integer;
begin
  if jsonb_typeof(p_config) is distinct from 'object'
     or p_config->'schemaVersion' is distinct from '2'::jsonb
     or jsonb_typeof(p_config->'requiredDrivers') is distinct from 'array'
     or jsonb_typeof(p_config->'profiles') is distinct from 'object'
     or jsonb_typeof(coalesce(p_config->'unitCostsCents', '{}'::jsonb)) is distinct from 'object' then
    return false;
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_config->'requiredDrivers') driver(value)
     where jsonb_typeof(value) is distinct from 'string'
  ) then
    return false;
  end if;
  if p_item_key = 'onboarding'
     and coalesce(p_config->>'onboardingCalculationMode', '') not in ('hours', 'manual') then
    return false;
  end if;
  expected_required := case
    when p_item_key = 'onboarding'
      and p_config->>'onboardingCalculationMode' = 'manual'
      then array[]::text[]
    else public.sales_modular_required_drivers_v2(p_item_key)
  end;
  select
    coalesce(array_agg(driver_value order by driver_value), array[]::text[]),
    count(*),
    count(distinct driver_value)
    into configured_required, configured_count, configured_distinct_count
    from jsonb_array_elements_text(p_config->'requiredDrivers') driver(driver_value);
  select coalesce(array_agg(driver_value order by driver_value), array[]::text[])
    into expected_required
    from unnest(expected_required) driver(driver_value);
  if configured_count <> configured_distinct_count
     or configured_required is distinct from expected_required then
    return false;
  end if;
  for profile_key in select unnest(array['light', 'standard', 'intensive'])
  loop
    if jsonb_typeof(p_config#>array['profiles', profile_key]) is distinct from 'object' then
      return false;
    end if;
    foreach required_driver in array configured_required
    loop
      datum := p_config#>array['profiles', profile_key, required_driver];
      if jsonb_typeof(datum) is distinct from 'object'
         or datum->'value' is null
         or datum->>'value' is null
         or (datum->>'value')::numeric < 0
         or datum->>'source' not in ('actual', 'calculated', 'estimated', 'manual')
         or char_length(btrim(coalesce(datum->>'sourceDetail', ''))) < 2
         or coalesce((datum->>'version')::integer, 0) < 1
         or nullif(datum->>'effectiveAt', '')::timestamptz is null then
        return false;
      end if;
    end loop;
  end loop;
  if exists (
    select 1 from jsonb_each_text(coalesce(p_config->'unitCostsCents', '{}'::jsonb)) unit_cost
     where nullif(unit_cost.value, '')::numeric < 0
  ) then
    return false;
  end if;
  return true;
exception when others then
  return false;
end
$function$;

create or replace function public.sales_modular_cost_model_complete_v2(
  p_item_key text,
  p_cost jsonb,
  p_settings jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
declare
  unit_key text;
  category_key text;
  direct_field text;
  direct_value numeric;
begin
  if jsonb_typeof(p_cost) is distinct from 'object'
     or coalesce(p_cost->>'cost_source', 'unavailable') not in (
       'actual', 'calculated', 'estimated', 'manual'
     ) then
    return false;
  end if;
  if p_item_key = 'onboarding' then
    if p_cost#>>'{driver_config,onboardingCalculationMode}' = 'manual' then
      return p_cost->>'onboarding_cost_cents' is not null
        and (p_cost->>'onboarding_cost_cents')::numeric >= 0;
    end if;
    return p_cost#>>'{driver_config,unitCostsCents,onboardingHours}' is not null
      and (p_cost#>>'{driver_config,unitCostsCents,onboardingHours}')::numeric >= 0;
  end if;

  foreach category_key in array array[
    'variablePatientCost', 'variableClinicCost', 'storageCost',
    'egressCost', 'processingCost', 'notificationCost',
    'otherVariableCost', 'supportClinicCost', 'supportPatientCost',
    'operationalCost', 'fixedMonthlyEligibleCost'
  ]
  loop
    if p_settings#>>array['ownership', category_key] = 'item_direct'
       and public.sales_modular_cost_category_applies_v2(
         p_item_key,
         category_key
       ) then
      direct_field := case category_key
        when 'variablePatientCost' then 'direct_cost_per_patient_cents'
        when 'variableClinicCost' then 'direct_cost_per_clinic_cents'
        when 'storageCost' then 'storage_cost_per_gb_cents'
        when 'egressCost' then 'egress_cost_per_gb_cents'
        when 'processingCost' then 'processing_cost_per_unit_cents'
        when 'notificationCost' then 'notification_cost_per_unit_cents'
        when 'otherVariableCost' then 'other_variable_cost_cents'
        when 'supportClinicCost' then 'support_fixed_monthly_cost_cents'
        when 'supportPatientCost' then 'support_cost_per_patient_cents'
        when 'operationalCost' then 'operational_fixed_monthly_cost_cents'
        when 'fixedMonthlyEligibleCost' then 'direct_fixed_monthly_cost_cents'
      end;
      if p_cost->>direct_field is null then return false; end if;
      direct_value := (p_cost->>direct_field)::numeric;
      if direct_value < 0 then return false; end if;
    end if;
  end loop;

  if p_item_key in ('clinical_core', 'appointments_communication', 'financial_management', 'insurance_tiss', 'school_management')
     and (
       p_cost->>'direct_cost_per_usage_unit_cents' is null
       or (p_cost->>'direct_cost_per_usage_unit_cents')::numeric < 0
     ) then return false; end if;
  foreach unit_key in array (case p_item_key
    when 'clinical_core' then array['monthlyAbaSessions', 'monthlyAbaRecords', 'generatedDocuments']
    when 'financial_management' then array['financialReports', 'recurringProcesses']
    when 'insurance_tiss' then array['tissBatches', 'tissXmlDocuments', 'tissDocuments']
    when 'school_management' then array['schoolParticipants']
    else array[]::text[]
  end)
  loop
    if p_cost#>>array['driver_config', 'unitCostsCents', unit_key] is null
       or (p_cost#>>array['driver_config', 'unitCostsCents', unit_key])::numeric < 0 then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end
$function$;

create or replace function public.sales_modular_has_direct_cost_v2(
  p_catalog_version_id uuid,
  p_ownership_key text
)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $function$
  select exists (
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
       and public.sales_modular_cost_category_applies_v2(
         item.item_key,
         p_ownership_key
       )
       and case p_ownership_key
         when 'variablePatientCost' then coalesce(cost.direct_cost_per_patient_cents, 0) > 0
         when 'variableClinicCost' then coalesce(cost.direct_cost_per_clinic_cents, 0) > 0
         when 'storageCost' then coalesce(cost.storage_cost_per_gb_cents, 0) > 0
         when 'egressCost' then coalesce(cost.egress_cost_per_gb_cents, 0) > 0
         when 'processingCost' then coalesce(cost.processing_cost_per_unit_cents, 0) > 0
         when 'notificationCost' then coalesce(cost.notification_cost_per_unit_cents, 0) > 0
         when 'otherVariableCost' then coalesce(cost.other_variable_cost_cents, 0) > 0
         when 'supportClinicCost' then coalesce(cost.support_fixed_monthly_cost_cents, 0) > 0
         when 'supportPatientCost' then coalesce(cost.support_cost_per_patient_cents, 0) > 0
         when 'operationalCost' then coalesce(cost.operational_fixed_monthly_cost_cents, 0) > 0
         when 'fixedMonthlyEligibleCost' then coalesce(cost.direct_fixed_monthly_cost_cents, 0) > 0
         else false
       end
  );
$function$;

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
  update public.sales_pricing_catalog_versions target
     set modular_cost_settings = source.modular_cost_settings
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
       or existing_event.event_type <>
         ('catalog_draft_' || p_action || '_saved')
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
  if p_action = 'version' and p_payload ? 'modularCostSettings'
     and not public.sales_modular_cost_settings_valid_v2(p_payload->'modularCostSettings') then
    raise exception 'PRICING_MODULAR_COST_SETTINGS_INVALID' using errcode = '22023';
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
       or jsonb_typeof(coalesce(p_payload#>'{driverConfig,unitCostsCents}', '{}'::jsonb)) is distinct from 'object'
       or (
         nullif(btrim(p_payload->>'otherVariableCostCents'), '') is not null
         and (
           btrim(p_payload->>'otherVariableCostCents') !~ '^[0-9]+$'
           or (p_payload->>'otherVariableCostCents')::numeric > 2147483647
         )
       )
       or exists (
         select 1
           from jsonb_each_text(coalesce(p_payload#>'{driverConfig,unitCostsCents}', '{}'::jsonb)) unit_cost
          where nullif(unit_cost.value, '')::numeric < 0
       ) then
      raise exception 'PRICING_DRIVER_CONFIG_INVALID' using errcode = '22023';
    end if;
  end if;
  result := public.save_sales_pricing_catalog_draft_v1(
    p_catalog_version_id, p_action, p_payload, p_actor_user_id, p_idempotency_key
  );
  if p_action = 'version' and p_payload ? 'modularCostSettings' then
    update public.sales_pricing_catalog_versions
       set modular_cost_settings = p_payload->'modularCostSettings'
     where id = p_catalog_version_id
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
  if version_row.status = 'active' then return to_jsonb(version_row); end if;
  if version_row.status <> 'draft' then
    raise exception 'PRICING_CATALOG_IMMUTABLE' using errcode = '55000';
  end if;
  if not public.sales_modular_cost_settings_valid_v2(version_row.modular_cost_settings) then
    raise exception 'PRICING_CATALOG_PUBLICATION_BLOCKED:COST_SETTINGS' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.sales_pricing_catalog_items
     where catalog_version_id = p_catalog_version_id
       and item_key = 'clinical_core' and is_required and is_active
  ) then
    raise exception 'PRICING_CATALOG_PUBLICATION_BLOCKED:BASE_PACKAGE' using errcode = '22023';
  end if;
  if exists (
    select 1
      from public.sales_pricing_catalog_items item
      left join lateral (
        select cost.* from public.sales_pricing_item_cost_models cost
         where cost.catalog_item_id = item.id
         order by cost.version desc limit 1
      ) cost on true
     where item.catalog_version_id = p_catalog_version_id
       and item.is_active
       and (
         cost.id is null
         or cost.cost_source = 'unavailable'
         or not public.sales_modular_driver_config_valid_v2(item.item_key, cost.driver_config)
         or not public.sales_modular_cost_model_complete_v2(
           item.item_key,
           to_jsonb(cost),
           version_row.modular_cost_settings
         )
       )
  ) then
    raise exception 'PRICING_CATALOG_PUBLICATION_BLOCKED:COST_OR_DRIVER' using errcode = '22023';
  end if;
  if exists (
    select 1
      from public.sales_pricing_catalog_items item
      join lateral (
        select cost.* from public.sales_pricing_item_cost_models cost
         where cost.catalog_item_id = item.id order by cost.version desc limit 1
      ) cost on true
     where item.catalog_version_id = p_catalog_version_id
       and item.is_active
       and item.item_key = 'clinical_core'
       and (
         (
           version_row.modular_cost_settings#>>'{ownership,storageCost}' = 'item_direct'
           and cost.storage_cost_per_gb_cents is null
         )
         or (
           version_row.modular_cost_settings#>>'{ownership,egressCost}' = 'item_direct'
           and cost.egress_cost_per_gb_cents is null
         )
       )
  ) then
    raise exception 'PRICING_CATALOG_PUBLICATION_BLOCKED:INCLUDED_STORAGE' using errcode = '22023';
  end if;
  if exists (
    select 1
      from public.sales_pricing_catalog_items item
      join lateral (
        select cost.* from public.sales_pricing_item_cost_models cost
         where cost.catalog_item_id = item.id order by cost.version desc limit 1
      ) cost on true
      cross join unnest(array['light', 'standard', 'intensive']) profile(profile_key)
     where item.catalog_version_id = p_catalog_version_id
       and item.is_active
       and public.sales_modular_cost_category_applies_v2(
         item.item_key,
         'egressCost'
       )
       and version_row.modular_cost_settings#>>'{ownership,egressCost}' <> 'excluded'
       and coalesce(
         nullif(cost.driver_config#>>array['usageProfileOverrides', profile.profile_key, 'expectedEgressMultiplier'], '')::numeric,
         nullif(version_row.modular_cost_settings#>>array['usageProfiles', profile.profile_key, 'expectedEgressMultiplier'], '')::numeric
       ) is null
  ) then
    raise exception 'PRICING_CATALOG_PUBLICATION_BLOCKED:EGRESS' using errcode = '22023';
  end if;
  for duplicate_key in
    select ownership.key
      from jsonb_each_text(version_row.modular_cost_settings->'ownership') ownership
     where ownership.value = 'shared'
       and coalesce(char_length(btrim(version_row.modular_cost_settings#>>array['ownershipJustifications', ownership.key])), 0) < 12
       and public.sales_modular_has_direct_cost_v2(
         p_catalog_version_id,
         ownership.key
       )
  loop
    raise exception 'PRICING_CATALOG_PUBLICATION_BLOCKED:DUPLICATE:%', duplicate_key using errcode = '22023';
  end loop;
  if exists (
    select 1 from public.sales_offer_simulations simulation
     where simulation.catalog_version_id = p_catalog_version_id
       and simulation.simulation_type = 'modular'
       and simulation.model_version = '2026-07-27-v2'
       and coalesce((simulation.results_snapshot->>'totalsReconciled')::boolean, false) is false
  ) then
    raise exception 'PRICING_CATALOG_PUBLICATION_BLOCKED:TOTAL_MISMATCH' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'version', version_row.version,
    'name', version_row.name,
    'effectiveAt', version_row.effective_at,
    'allocationSettings', version_row.allocation_settings,
    'modularCostSettings', version_row.modular_cost_settings,
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
    p_catalog_version_id, 'catalog_published_v2', p_actor_user_id,
    jsonb_build_object('version', version_row.version, 'modelVersion', '2026-07-27-v2'),
    p_idempotency_key
  ) on conflict (idempotency_key) do nothing;
  return to_jsonb(version_row);
end
$function$;

revoke all on function public.sales_modular_cost_settings_valid_v2(jsonb)
  from public, anon, authenticated;
revoke all on function public.sales_modular_required_drivers_v2(text)
  from public, anon, authenticated;
revoke all on function public.sales_modular_cost_category_applies_v2(text, text)
  from public, anon, authenticated;
revoke all on function public.sales_modular_resolve_owned_cost_v2(text, bigint, bigint, boolean)
  from public, anon, authenticated;
revoke all on function public.sales_modular_driver_config_valid_v2(text, jsonb)
  from public, anon, authenticated;
revoke all on function public.sales_modular_cost_model_complete_v2(text, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.sales_modular_has_direct_cost_v2(uuid, text)
  from public, anon, authenticated;
revoke all on function public.clone_sales_pricing_catalog_version_v2(uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.save_sales_pricing_catalog_draft_v2(uuid, text, jsonb, uuid, text)
  from public, anon, authenticated;
revoke all on function public.publish_sales_pricing_catalog_version_v2(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.clone_sales_pricing_catalog_version_v2(uuid, text, uuid, text)
  to service_role;
grant execute on function public.save_sales_pricing_catalog_draft_v2(uuid, text, jsonb, uuid, text)
  to service_role;
grant execute on function public.publish_sales_pricing_catalog_version_v2(uuid, uuid, text)
  to service_role;

comment on column public.sales_pricing_catalog_versions.modular_cost_settings is
  'Configuracao versionada do motor modular v2: propriedade e perfis de storage/egress.';
comment on column public.sales_pricing_item_cost_models.driver_config is
  'Drivers versionados por funcionalidade, fontes, criterios, vigencia e custos unitarios.';
comment on column public.sales_pricing_item_cost_models.other_variable_cost_cents is
  'Outros custos variaveis diretamente atribuiveis a funcionalidade, em centavos por mes.';

commit;
