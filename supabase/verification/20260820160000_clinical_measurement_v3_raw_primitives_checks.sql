-- Read-only staging/production verification for Clinical Measurement Engine V3 Raw Primitives.

select
  to_regclass('public.clinical_measurement_raw_events_v3') is not null as raw_events_ready,
  to_regclass('public.clinical_measurement_raw_event_payload_claims_v3') is not null as raw_payload_claims_ready,
  to_regclass('public.clinical_measurement_observation_slices_v3') is not null as observation_slices_ready,
  to_regclass('public.clinical_measurement_count_facts_v3') is not null as count_facts_ready,
  to_regclass('public.clinical_measurement_category_facts_v3') is not null as category_facts_ready,
  to_regclass('public.clinical_measurement_scalar_facts_v3') is not null as scalar_facts_ready,
  to_regclass('public.clinical_measurement_interval_facts_v3') is not null as interval_facts_ready,
  to_regclass('public.clinical_measurement_interval_samples_v3') is not null as interval_samples_ready,
  to_regclass('public.clinical_measurement_explicit_absence_facts_v3') is not null as explicit_absence_ready,
  not has_table_privilege('authenticated', 'public.clinical_measurement_raw_events_v3', 'SELECT') as browser_raw_closed,
  not has_table_privilege('authenticated', 'public.clinical_measurement_observation_slices_v3', 'SELECT') as browser_slices_closed,
  has_table_privilege('service_role', 'public.clinical_measurement_raw_events_v3', 'SELECT') as service_role_raw_ready,
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_observation_slices_v3'::regclass
      and conname = 'cmv3_observation_slices_no_overlap'
      and contype = 'x'
  ) as observation_slice_overlap_guard_ready,
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_interval_samples_v3'::regclass
      and conname = 'cmv3_interval_samples_no_overlap'
      and contype = 'x'
  ) as interval_sample_overlap_guard_ready,
  exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.clinical_measurement_raw_events_v3'::regclass
      and tgname = 'guard_clinical_measurement_raw_events_v3'
      and not tgisinternal
  ) as raw_append_only_guard_ready,
  exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.clinical_measurement_raw_events_v3'::regclass
      and tgname = 'ensure_clinical_measurement_raw_payload_v3'
      and not tgisinternal
  ) as typed_payload_guard_ready,
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_interval_samples_v3'::regclass
      and conname = 'cmv3_interval_samples_index_lineage_guard'
      and contype = 'x'
  ) as interval_index_lineage_guard_ready;
