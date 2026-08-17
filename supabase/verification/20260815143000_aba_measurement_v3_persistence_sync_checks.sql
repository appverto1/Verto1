-- Read-only verification for ABA Measurement V3 PR3.
select
  to_regclass('public.aba_trials_v3') is not null as trials_v3_ready,
  to_regclass('public.aba_trial_steps_v3') is not null as trial_steps_v3_ready,
  to_regclass('public.aba_session_target_exposures_v3') is not null as exposures_v3_ready,
  to_regclass('public.aba_sync_quarantine_v3') is not null as quarantine_v3_ready,
  to_regprocedure('public.record_aba_trials_bulk_v3(uuid,uuid,jsonb,uuid)') is not null
    as bulk_ingest_ready,
  to_regprocedure('public.record_aba_trial_v3(uuid,uuid,jsonb,uuid)') is not null
    as single_trial_wrapper_ready,
  to_regprocedure('public.record_aba_trial_revision_v3(uuid,uuid,text,uuid,text,text,uuid,jsonb)') is not null
    as revisions_rpc_ready,
  to_regprocedure('public.set_aba_session_target_exposure_v3(uuid,uuid,text,text,text,text,text,uuid)') is not null
    as exposure_rpc_ready,
  has_function_privilege(
    'service_role',
    'public.record_aba_trials_bulk_v3(uuid,uuid,jsonb,uuid)',
    'EXECUTE'
  ) as service_role_bulk_execute_ready,
  not has_function_privilege(
    'authenticated',
    'public.record_aba_trials_bulk_v3(uuid,uuid,jsonb,uuid)',
    'EXECUTE'
  ) as browser_bulk_execute_blocked,
  not has_table_privilege('authenticated', 'public.aba_trials_v3', 'SELECT')
    as browser_trials_blocked,
  not has_table_privilege('authenticated', 'public.aba_sync_quarantine_v3', 'SELECT')
    as browser_quarantine_blocked,
  exists (
    select 1
    from pg_catalog.pg_indexes idx
    where idx.schemaname = 'public'
      and idx.tablename = 'aba_trial_steps_v3'
      and idx.indexname = 'ux_aba_trial_steps_v3_primary_independent'
  ) as primary_independent_unique_ready,
  not exists (
    select 1
    from public.aba_measurement_rollout_states_v3 state
    where state.allow_new_v3_sessions = true
  ) as no_new_v3_sessions_enabled;
