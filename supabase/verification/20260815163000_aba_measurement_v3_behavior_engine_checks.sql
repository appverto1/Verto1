select
  to_regclass('public.aba_behavior_contexts_v3') is not null as behavior_contexts_ready,
  to_regclass('public.aba_behavior_collector_bindings_v3') is not null as collector_bindings_ready,
  to_regclass('public.aba_behavior_observation_slices_v3') is not null as observation_slices_ready,
  to_regclass('public.aba_behavior_events_v3') is not null as behavior_events_ready,
  to_regclass('public.aba_session_behavior_summaries_v3') is not null as behavior_summaries_ready,
  to_regprocedure('public.recompute_aba_session_behavior_summary_v3(uuid)') is not null as behavior_recompute_ready,
  to_regprocedure('public.finalize_aba_behavior_timers_v3(text,timestamp with time zone)') is not null as orphan_timer_finalizer_ready,
  exists(select 1 from pg_constraint where conname='aba_behavior_observation_slices_v3_no_overlap') as scoped_overlap_guard_ready,
  exists(select 1 from pg_indexes where indexname='uq_aba_behavior_primary_collector_v3') as primary_collector_guard_ready,
  not has_table_privilege('authenticated','public.aba_behavior_observation_slices_v3','SELECT') as browser_slices_blocked,
  not has_table_privilege('authenticated','public.aba_behavior_events_v3','SELECT') as browser_events_blocked,
  not has_function_privilege('authenticated','public.finalize_aba_behavior_timers_v3(text,timestamp with time zone)','EXECUTE') as browser_finalizer_blocked,
  not exists(select 1 from public.aba_measurement_rollout_states_v3 where allow_new_v3_sessions) as no_new_v3_sessions_enabled;
