-- Read-only staging verification for Clinical Measurement Engine V3 bulk/offline ingestion.
select
  to_regclass('public.clinical_measurement_sync_batches_v3') is not null as sync_batches_ready,
  to_regclass('public.clinical_measurement_sync_batch_events_v3') is not null as sync_batch_events_ready,
  to_regclass('public.clinical_aba_trial_protocol_intents_v3') is not null as aba_trial_protocol_intents_ready,
  to_regprocedure('public.sync_clinical_measurements_bulk_v3(uuid,uuid,uuid,text,jsonb)') is not null as bulk_rpc_ready,
  to_regprocedure('public.validate_clinical_measurement_sync_batch_v3(uuid,uuid,uuid,jsonb)') is not null as validation_ready,
  to_regprocedure('public.accept_clinical_measurement_raw_envelopes_bulk_v3(uuid,uuid,uuid,jsonb)') is not null as envelope_acceptor_ready,
  to_regprocedure('public.ingest_clinical_measurement_primitives_bulk_v3(uuid,jsonb)') is not null as primitive_handler_ready,
  to_regprocedure('public.ingest_clinical_aba_trials_bulk_v3(uuid,jsonb)') is not null as aba_trial_handler_ready,
  to_regprocedure('public.ingest_clinical_aba_task_runs_bulk_v3(uuid,jsonb)') is not null as aba_task_handler_ready,
  has_function_privilege('service_role','public.sync_clinical_measurements_bulk_v3(uuid,uuid,uuid,text,jsonb)','EXECUTE') as service_role_rpc_ready,
  not has_function_privilege('authenticated','public.sync_clinical_measurements_bulk_v3(uuid,uuid,uuid,text,jsonb)','EXECUTE') as browser_rpc_closed,
  not has_function_privilege('anon','public.sync_clinical_measurements_bulk_v3(uuid,uuid,uuid,text,jsonb)','EXECUTE') as anon_rpc_closed,
  not has_table_privilege('authenticated','public.clinical_measurement_sync_batches_v3','SELECT') as browser_batches_closed,
  exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid='public.clinical_measurement_sync_batches_v3'::regclass
      and tgname='guard_cmv3_sync_batches_immutable' and not tgisinternal
  ) as batch_provenance_append_only,
  exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid='public.clinical_measurement_sync_batch_events_v3'::regclass
      and tgname='guard_cmv3_sync_batch_events_immutable' and not tgisinternal
  ) as batch_event_provenance_append_only;
