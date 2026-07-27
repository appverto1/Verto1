-- Consultas pos-migration. Nao alteram dados.
select
  version,
  name,
  status,
  public.sales_modular_cost_settings_valid_v2(modular_cost_settings)
    as modular_cost_settings_valid,
  modular_cost_settings->'ownership' as ownership,
  modular_cost_settings->'usageProfiles' as usage_profiles
from public.sales_pricing_catalog_versions
order by version;

select
  constraint_name,
  constraint_type
from information_schema.table_constraints
where table_schema = 'public'
  and table_name = 'sales_pricing_item_cost_models'
  and constraint_name =
    'sales_pricing_item_cost_models_other_variable_non_negative_v2';

select
  catalog.version as catalog_version,
  catalog.name as catalog_name,
  item.item_key,
  item.public_name,
  cost.version as cost_version,
  cost.cost_source,
  cost.other_variable_cost_cents,
  cost.support_cost_per_patient_cents,
  cost.driver_config->'requiredDrivers' as required_drivers,
  cost.driver_config->'unitCostsCents' as unit_costs
from public.sales_pricing_catalog_versions catalog
join public.sales_pricing_catalog_items item
  on item.catalog_version_id = catalog.id
left join lateral (
  select model.*
  from public.sales_pricing_item_cost_models model
  where model.catalog_item_id = item.id
  order by model.version desc
  limit 1
) cost on true
order by catalog.version, item.sort_order;

select
  catalog.version,
  catalog.name,
  count(*) filter (
    where item.is_active
      and (
        not public.sales_modular_driver_config_valid_v2(
          item.item_key,
          cost.driver_config
        )
        or not public.sales_modular_cost_model_complete_v2(
          item.item_key,
          to_jsonb(cost),
          catalog.modular_cost_settings
        )
      )
  ) as active_items_blocking_publication
from public.sales_pricing_catalog_versions catalog
join public.sales_pricing_catalog_items item
  on item.catalog_version_id = catalog.id
left join lateral (
  select model.*
  from public.sales_pricing_item_cost_models model
  where model.catalog_item_id = item.id
  order by model.version desc
  limit 1
) cost on true
where catalog.name = 'Catálogo comercial — custos iniciais'
group by catalog.version, catalog.name;

select
  has_function_privilege('service_role',
    'public.publish_sales_pricing_catalog_version_v2(uuid,uuid,text)', 'EXECUTE')
    as service_role_can_publish_v2,
  has_function_privilege('authenticated',
    'public.publish_sales_pricing_catalog_version_v2(uuid,uuid,text)', 'EXECUTE')
    as authenticated_can_publish_v2,
  has_function_privilege('anon',
    'public.publish_sales_pricing_catalog_version_v2(uuid,uuid,text)', 'EXECUTE')
    as anon_can_publish_v2;

select
  count(*) filter (
    where simulation_type = 'modular'
      and model_version = '2026-07-27-v2'
      and coalesce((results_snapshot->>'totalsReconciled')::boolean, false) is false
  ) as modular_v2_total_mismatches,
  count(*) filter (where simulation_type = 'legacy') as legacy_snapshots_preserved,
  count(*) filter (where simulation_type = 'modular') as modular_snapshots_preserved
from public.sales_offer_simulations;

select
  item.item_key,
  ownership.category,
  public.sales_modular_cost_category_applies_v2(
    item.item_key,
    ownership.category
  ) as applies
from (
  values
    ('clinical_core'),
    ('appointments_communication'),
    ('financial_management'),
    ('insurance_tiss'),
    ('school_management'),
    ('additional_storage'),
    ('onboarding')
) item(item_key)
cross join unnest(array[
  'variablePatientCost', 'variableClinicCost', 'storageCost',
  'egressCost', 'processingCost', 'notificationCost',
  'otherVariableCost', 'supportClinicCost', 'supportPatientCost',
  'operationalCost', 'fixedMonthlyEligibleCost'
]) ownership(category)
order by item.item_key, ownership.category;
