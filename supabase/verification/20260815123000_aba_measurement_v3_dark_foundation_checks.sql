-- Read-only production/staging verification for ABA Measurement V3 dark foundation.

select
  to_regclass('public.aba_collection_definition_versions_v3') is not null
    as collection_versions_ready,
  to_regclass('public.aba_target_phase_assignments_v3') is not null
    as target_phases_ready,
  to_regclass('public.aba_measurement_rollout_states_v3') is not null
    as rollout_states_ready,
  to_regclass('public.aba_measurement_rollout_events_v3') is not null
    as rollout_audit_ready,
  to_regclass('public.aba_session_target_measurement_bindings') is not null
    as session_target_bindings_ready,
  coalesce((select count(*) from public.aba_measurement_rollout_states_v3), 0) = 0
    as no_rollout_enabled_by_migration,
  not has_table_privilege('authenticated', 'public.aba_collection_definition_versions_v3', 'SELECT')
    as browser_collection_versions_closed,
  not has_table_privilege('authenticated', 'public.aba_measurement_rollout_states_v3', 'SELECT')
    as browser_rollout_states_closed,
  has_table_privilege('service_role', 'public.aba_collection_definition_versions_v3', 'SELECT')
    as service_role_collection_versions_ready,
  has_table_privilege('service_role', 'public.aba_session_target_measurement_bindings', 'SELECT')
    as service_role_bindings_ready;
