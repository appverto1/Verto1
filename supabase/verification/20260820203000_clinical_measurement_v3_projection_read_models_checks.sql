-- Read-only staging verification for Clinical Measurement Engine V3 projections.
select
  to_regclass('public.clinical_measurement_projection_queue_v3') is not null as queue_ready,
  to_regclass('public.clinical_measurement_session_rate_summaries_v3') is not null as rate_read_model_ready,
  to_regclass('public.clinical_measurement_session_proportion_summaries_v3') is not null as proportion_read_model_ready,
  to_regclass('public.clinical_measurement_session_temporal_summaries_v3') is not null as temporal_read_model_ready,
  to_regclass('public.clinical_measurement_session_task_analysis_summaries_v3') is not null as task_read_model_ready,
  to_regclass('public.clinical_measurement_session_projection_revisions_v3') is not null as revision_ledger_ready,
  to_regprocedure('public.recompute_clinical_measurement_projection_batch_v3(uuid[],text)') is not null as recompute_batch_ready,
  to_regprocedure('public.process_clinical_measurement_projection_queue_v3(integer)') is not null as queue_processor_ready,
  to_regprocedure('public.rebuild_clinical_measurement_projection_v3(uuid[])') is not null as rebuild_ready,
  has_function_privilege('service_role','public.process_clinical_measurement_projection_queue_v3(integer)','EXECUTE') as service_role_processor_ready,
  not has_function_privilege('authenticated','public.process_clinical_measurement_projection_queue_v3(integer)','EXECUTE') as browser_processor_closed,
  not has_table_privilege('authenticated','public.clinical_measurement_session_rate_summaries_v3','SELECT') as browser_read_models_closed,
  exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid='public.clinical_measurement_raw_events_v3'::regclass
      and tgname='enqueue_cmv3_projection_raw' and not tgisinternal
  ) as statement_enqueue_ready,
  exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid='public.clinical_measurement_sessions_v3'::regclass
      and tgname='enqueue_cmv3_projection_session_finalized' and not tgisinternal
  ) as finalized_missingness_enqueue_ready,
  exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid='public.clinical_measurement_session_projection_revisions_v3'::regclass
      and tgname='guard_cmv3_projection_revision_immutable' and not tgisinternal
  ) as revision_ledger_append_only;
