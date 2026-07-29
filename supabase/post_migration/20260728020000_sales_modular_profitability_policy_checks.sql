-- Read-only checks. Run manually after applying
-- 20260728020000_sales_modular_profitability_policy.sql.

select
  column_name,
  is_nullable,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'sales_pricing_catalog_versions'
  and column_name = 'profitability_policy';

select
  version,
  name,
  status,
  profitability_policy is not null as has_profitability_policy,
  case
    when profitability_policy is null then null
    else public.sales_profitability_policy_valid_v1(profitability_policy)
  end as policy_is_valid,
  catalog_snapshot ? 'profitabilityPolicy' as snapshot_has_policy
from public.sales_pricing_catalog_versions
order by version;

select
  count(*) filter (where status = 'active') as active_catalogs,
  count(*) filter (
    where status in ('active','archived')
      and profitability_policy is not null
      and not public.sales_profitability_policy_valid_v1(
        profitability_policy
      )
  ) as invalid_published_policies
from public.sales_pricing_catalog_versions;

select
  routine_name,
  routine_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'sales_profitability_policy_valid_v1',
    'protect_sales_profitability_publication_v1',
    'clone_sales_pricing_catalog_version_v3',
    'save_sales_pricing_catalog_draft_v3',
    'publish_sales_pricing_catalog_version_v3'
  )
order by routine_name;

select
  trigger_name,
  event_manipulation,
  action_timing
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table = 'sales_pricing_catalog_versions'
  and trigger_name in (
    'sales_pricing_catalog_versions_immutable_v1',
    'sales_pricing_catalog_profitability_publish_v1'
  )
order by trigger_name;

select
  version,
  status,
  catalog_snapshot->'profitabilityPolicy'
    is not distinct from profitability_policy as snapshot_reconciled
from public.sales_pricing_catalog_versions
where profitability_policy is not null
order by version;
