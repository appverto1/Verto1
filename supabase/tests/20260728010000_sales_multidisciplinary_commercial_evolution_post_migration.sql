-- Read-only verification queries. Execute manually after the migration.

select version, name, status, custom_capacity_policy
from public.sales_pricing_catalog_versions
order by version desc;

-- Immediately after the migration, historical v1/v2 must remain untouched.
select
  version,
  status,
  custom_capacity_policy is null as historical_policy_remains_null,
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
  ) as logical_content_sha256
from public.sales_pricing_catalog_versions catalog
where version in (1, 2)
order by version;

select
  column_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'sales_pricing_catalog_versions'
  and column_name = 'custom_capacity_policy';

select
  constraint_info.conname,
  pg_get_constraintdef(constraint_info.oid) as definition
from pg_constraint constraint_info
where constraint_info.conrelid =
    'public.sales_pricing_catalog_versions'::regclass
  and constraint_info.conname =
    'sales_pricing_catalog_custom_capacity_valid';

select
  trigger_info.tgname,
  trigger_info.tgenabled,
  pg_get_triggerdef(trigger_info.oid) as definition
from pg_trigger trigger_info
where trigger_info.tgrelid =
    'public.sales_pricing_catalog_versions'::regclass
  and trigger_info.tgname =
    'sales_pricing_catalog_versions_immutable_v1';

-- After publishing v3 through the normal UI, this must return true.
select
  version,
  status,
  public.sales_custom_capacity_policy_valid_v1(
    custom_capacity_policy
  ) as policy_valid,
  catalog_snapshot->'customCapacityPolicy'
    = custom_capacity_policy as snapshot_matches_version
from public.sales_pricing_catalog_versions
where custom_capacity_policy is not null
order by version desc;

select status, count(*) as catalog_count
from public.sales_pricing_catalog_versions
group by status
order by status;

select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'sales_offers' and column_name in ('accepted_terms_at', 'accepted_terms_snapshot'))
    or (table_name = 'sales_checkout_links')
    or (table_name = 'sales_offer_item_discounts')
    or (table_name = 'patient_professional_links')
    or (table_name = 'patient_therapeutic_plans')
    or (
      table_name = 'patient_therapeutic_plan_versions'
      and column_name in ('authorized_reader_ids')
    )
    or (table_name = 'aba_session_metric_snapshots' and column_name in (
      'professional_id_snapshot', 'specialty_snapshot', 'specialty_source',
      'organization_id_snapshot', 'session_id_snapshot', 'aggregation_weight_snapshot'
    ))
  )
order by table_name, ordinal_position;

select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'aba_program_templates', 'aba_program_template_versions',
    'patient_professional_links', 'patient_therapeutic_plans',
    'patient_therapeutic_plan_versions'
  )
order by tablename, policyname;

select trigger_info.event_object_table, trigger_info.trigger_name,
  trigger_info.action_timing, trigger_info.event_manipulation
from information_schema.triggers trigger_info
where trigger_info.trigger_schema = 'public'
  and trigger_info.trigger_name in (
    'enrich_sales_modular_offer_snapshot_v1',
    'persist_sales_offer_item_discount_v1',
    'schedule_offer_item_discount_notifications_v1',
    'enforce_patient_professional_link_limit_v1',
    'attach_aba_program_scope_v1',
    'snapshot_aba_program_template_version_v1',
    'snapshot_aba_specialty_v1',
    'snapshot_aba_metric_aggregation_weight_v1'
  )
order by trigger_info.trigger_name, trigger_info.event_object_table;

select
  count(*) filter (where status = 'active') as active_links,
  count(*) filter (where status = 'ended') as historical_links,
  count(distinct organization_id) as organizations_with_links
from public.patient_professional_links;

select
  count(*) as total_snapshots,
  count(*) filter (where specialty_snapshot is null) as missing_specialty_snapshot,
  count(*) filter (where specialty_snapshot = 'Especialidade não informada') as ambiguous_historical_specialty,
  count(*) filter (where organization_id_snapshot is null) as missing_organization_snapshot,
  count(*) filter (where session_id_snapshot is null) as missing_session_snapshot
from public.aba_session_metric_snapshots;
