-- Read-only staging/production verification for Clinical Measurement Engine V3 Migration A.

select
  to_regclass('public.clinical_measurement_targets_v3') is not null as targets_ready,
  to_regclass('public.clinical_measurement_definitions_v3') is not null as definitions_ready,
  to_regclass('public.clinical_measurement_definition_versions_v3') is not null as definition_versions_ready,
  to_regclass('public.clinical_measurement_definition_activations_v3') is not null as definition_activations_ready,
  to_regclass('public.clinical_measurement_phases_v3') is not null as phases_ready,
  to_regclass('public.clinical_measurement_phase_versions_v3') is not null as phase_versions_ready,
  to_regclass('public.clinical_measurement_phase_epochs_v3') is not null as phase_epochs_ready,
  to_regclass('public.clinical_collection_protocol_snapshots_v3') is not null as protocol_snapshots_ready,
  not has_table_privilege('authenticated', 'public.clinical_measurement_targets_v3', 'SELECT') as browser_targets_closed,
  not has_table_privilege('authenticated', 'public.clinical_measurement_definition_versions_v3', 'SELECT') as browser_versions_closed,
  not has_table_privilege('authenticated', 'public.clinical_collection_protocol_snapshots_v3', 'SELECT') as browser_snapshots_closed,
  has_table_privilege('service_role', 'public.clinical_measurement_targets_v3', 'SELECT') as service_role_targets_ready,
  has_table_privilege('service_role', 'public.clinical_collection_protocol_snapshots_v3', 'SELECT') as service_role_snapshots_ready,
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_definition_activations_v3'::regclass
      and conname = 'cmv3_definition_activation_no_overlap'
      and contype = 'x'
  ) as definition_activation_overlap_guard_ready,
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_phase_epochs_v3'::regclass
      and conname = 'cmv3_phase_epoch_no_overlap'
      and contype = 'x'
  ) as phase_epoch_overlap_guard_ready;
