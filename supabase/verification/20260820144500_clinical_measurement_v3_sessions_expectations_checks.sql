-- Read-only staging/production verification for Clinical Measurement Engine V3 Migration B.

select
  to_regclass('public.clinical_measurement_sessions_v3') is not null as sessions_ready,
  to_regclass('public.clinical_measurement_session_expectations_v3') is not null as expectations_ready,
  to_regclass('public.clinical_measurement_collection_streams_v3') is not null as collection_streams_ready,
  not has_table_privilege('authenticated', 'public.clinical_measurement_sessions_v3', 'SELECT') as browser_sessions_closed,
  not has_table_privilege('authenticated', 'public.clinical_measurement_session_expectations_v3', 'SELECT') as browser_expectations_closed,
  not has_table_privilege('authenticated', 'public.clinical_measurement_collection_streams_v3', 'SELECT') as browser_streams_closed,
  has_table_privilege('service_role', 'public.clinical_measurement_sessions_v3', 'SELECT') as service_role_sessions_ready,
  has_table_privilege('service_role', 'public.clinical_measurement_session_expectations_v3', 'SELECT') as service_role_expectations_ready,
  has_table_privilege('service_role', 'public.clinical_measurement_collection_streams_v3', 'SELECT') as service_role_streams_ready,
  exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'clinical_measurement_collection_streams_v3'
      and indexname = 'ux_cmv3_primary_stream_per_expectation'
  ) as one_primary_stream_guard_ready,
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_collection_streams_v3'::regclass
      and conname = 'cmv3_stream_paired_primary_scope_fkey'
      and contype = 'f'
  ) as reliability_pair_scope_guard_ready,
  timezone('America/Manaus', '2026-03-11 03:30:00+00'::timestamptz)::date = date '2026-03-10'
    as manaus_midnight_clinical_date_ready;
