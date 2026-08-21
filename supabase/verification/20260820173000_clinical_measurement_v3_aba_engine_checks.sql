-- Read-only staging verification for Clinical Measurement Engine V3 ABA specialized engine.
select
  to_regclass('public.clinical_aba_prompt_hierarchy_versions_v3') is not null as prompt_hierarchy_versions_ready,
  to_regclass('public.clinical_aba_chaining_policy_versions_v3') is not null as chaining_versions_ready,
  to_regclass('public.clinical_measurement_aba_trials_v3') is not null as aba_trials_ready,
  to_regclass('public.clinical_measurement_aba_trial_steps_v3') is not null as aba_trial_steps_ready,
  to_regclass('public.clinical_measurement_aba_task_runs_v3') is not null as aba_task_runs_ready,
  to_regclass('public.clinical_measurement_aba_task_step_results_v3') is not null as aba_task_results_ready,
  not has_table_privilege('authenticated','public.clinical_measurement_aba_trials_v3','SELECT') as browser_trials_closed,
  not has_table_privilege('authenticated','public.clinical_aba_prompt_hierarchy_versions_v3','SELECT') as browser_prompt_config_closed,
  has_table_privilege('service_role','public.clinical_measurement_aba_trials_v3','SELECT') as service_role_trials_ready,
  exists (
    select 1 from pg_catalog.pg_indexes where schemaname='public'
      and tablename='clinical_measurement_aba_trial_steps_v3'
      and indexname='ux_cabav3_trial_one_primary_independent'
  ) as one_primary_opportunity_guard_ready,
  exists (
    select 1 from pg_catalog.pg_trigger where tgrelid='public.clinical_measurement_aba_task_step_results_v3'::regclass
      and tgname='prepare_cabav3_task_result' and not tgisinternal
  ) as task_eligibility_server_derived,
  to_regprocedure('public.publish_clinical_aba_prompt_hierarchy_version_v3(uuid)') is not null as prompt_publish_ready,
  to_regprocedure('public.publish_clinical_aba_chaining_policy_version_v3(uuid)') is not null as chaining_publish_ready,
  to_regprocedure('public.resolve_clinical_measurement_payload_kind_v3(uuid)') is not null as unified_payload_kind_ready;
