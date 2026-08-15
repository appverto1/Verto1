-- Read-only verification for ABA Measurement V3 PR4.
select
  to_regclass('public.aba_session_target_summaries_v3') is not null as summaries_v3_ready,
  to_regclass('public.aba_effective_trials_v3') is not null as effective_trials_projection_ready,
  to_regprocedure('public.compute_aba_session_target_summary_projection_v3(uuid,uuid,text,text,uuid)') is not null
    as projection_compute_ready,
  to_regprocedure('public.recompute_aba_session_target_summary_v3(uuid,uuid,text,text,uuid)') is not null
    as granular_recompute_ready,
  to_regprocedure('public.verify_aba_session_target_summary_v3(uuid,uuid,text,text,uuid)') is not null
    as consistency_verify_ready,
  to_regprocedure('public.record_aba_trial_correction_v3(uuid,uuid,uuid,text,jsonb,text,text,uuid,jsonb)') is not null
    as atomic_correction_ready,
  has_function_privilege(
    'service_role',
    'public.recompute_aba_session_target_summary_v3(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ) as service_role_recompute_ready,
  has_function_privilege(
    'service_role',
    'public.verify_aba_session_target_summary_v3(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ) as service_role_verify_ready,
  not has_table_privilege('authenticated', 'public.aba_session_target_summaries_v3', 'SELECT')
    as browser_summary_blocked,
  not has_function_privilege(
    'authenticated',
    'public.recompute_aba_session_target_summary_v3(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ) as browser_recompute_blocked,
  exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.aba_trials_v3'::regclass
      and t.tgname = 'validate_aba_trial_v3_has_steps_at_commit'
      and not t.tgisinternal
  ) as orphan_trial_guard_ready,
  exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.aba_trial_steps_v3'::regclass
      and t.tgname = 'reconcile_aba_v3_summaries_after_steps_insert'
      and not t.tgisinternal
  ) as step_reconciliation_trigger_ready,
  exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.aba_trial_revisions_v3'::regclass
      and t.tgname = 'reconcile_aba_v3_summary_after_revision_insert'
      and not t.tgisinternal
  ) as revision_reconciliation_trigger_ready,
  not exists (
    select 1
    from public.aba_measurement_rollout_states_v3 state
    where state.allow_new_v3_sessions = true
  ) as no_new_v3_sessions_enabled;
