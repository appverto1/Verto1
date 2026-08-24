-- Clinical Measurement Engine V3 - Production schema inventory.
-- READ ONLY. No DDL, no DML, no rollout changes.
--
-- Purpose:
--   Identify exactly which ABA V3 and universal Clinical Measurement V3 schema
--   blocks are already present in Production before any migration promotion.
--   This avoids re-applying or skipping migrations based on assumptions.

begin transaction read only;
set local statement_timeout = '20s';
set local lock_timeout = '3s';

with required_blocks as (
  select * from (values
    (1,  '20260815123000_aba_measurement_v3_dark_foundation.sql',
      to_regclass('public.aba_measurement_rollout_states_v3') is not null
      and to_regclass('public.aba_session_target_measurement_bindings') is not null,
      jsonb_build_array('aba_measurement_rollout_states_v3','aba_session_target_measurement_bindings')),
    (2,  '20260815133000_aba_measurement_v3_session_target_binding_resolver.sql',
      exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='resolve_aba_session_target_measurement_binding_v1'),
      jsonb_build_array('resolve_aba_session_target_measurement_binding_v1')),
    (3,  '20260815143000_aba_measurement_v3_persistence_sync.sql',
      to_regclass('public.aba_trials_v3') is not null
      and to_regclass('public.aba_trial_steps_v3') is not null
      and to_regclass('public.aba_sync_quarantine_v3') is not null,
      jsonb_build_array('aba_trials_v3','aba_trial_steps_v3','aba_sync_quarantine_v3')),
    (4,  '20260815153000_aba_measurement_v3_server_summaries.sql',
      to_regclass('public.aba_session_target_summaries_v3') is not null,
      jsonb_build_array('aba_session_target_summaries_v3')),
    (5,  '20260815163000_aba_measurement_v3_behavior_engine.sql',
      to_regclass('public.aba_behavior_observation_slices_v3') is not null
      and to_regclass('public.aba_session_behavior_summaries_v3') is not null,
      jsonb_build_array('aba_behavior_observation_slices_v3','aba_session_behavior_summaries_v3')),
    (6,  '20260815173000_aba_measurement_v3_probes_session_fsm.sql',
      to_regclass('public.aba_maintenance_probes_v3') is not null
      and to_regclass('public.aba_target_clinical_states_v3') is not null,
      jsonb_build_array('aba_maintenance_probes_v3','aba_target_clinical_states_v3')),
    (7,  '20260815183000_aba_measurement_v3_task_interval_ioa.sql',
      to_regclass('public.aba_task_analysis_runs_v3') is not null
      and to_regclass('public.aba_interval_runs_v3') is not null,
      jsonb_build_array('aba_task_analysis_runs_v3','aba_interval_runs_v3')),
    (8,  '20260815193000_aba_measurement_v3_read_models_endpoints.sql',
      exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_aba_session_read_bundle_v3'),
      jsonb_build_array('get_aba_session_read_bundle_v3')),
    (9,  '20260815203000_aba_measurement_v3_pr9a_atomic_trial_collection_bridge.sql',
      to_regprocedure('public.record_aba_trial_action_v3(uuid,uuid,jsonb,text,uuid)') is not null,
      jsonb_build_array('record_aba_trial_action_v3(uuid,uuid,jsonb,text,uuid)')),
    (10, '20260815213000_aba_measurement_v3_pr9b_behavior_interval_task_collection.sql',
      to_regclass('public.aba_behavior_target_bindings_v3') is not null
      and exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='record_aba_behavior_action_v3'),
      jsonb_build_array('aba_behavior_target_bindings_v3','record_aba_behavior_action_v3')),
    (11, '20260815223000_aba_measurement_v3_pr10_charts_rollout_pilot.sql',
      to_regprocedure('public.get_aba_v3_pilot_readiness(uuid,uuid,text,text)') is not null
      and to_regprocedure('public.set_aba_measurement_rollout_state_v3(uuid,text,uuid,text,text,boolean,boolean,text,uuid,bigint)') is not null,
      jsonb_build_array('get_aba_v3_pilot_readiness','set_aba_measurement_rollout_state_v3')),
    (12, '20260815233000_aba_measurement_v3_pr11_preproduction_pilot_safety.sql',
      to_regprocedure('public.get_aba_v3_rollout_drain_status(uuid,text,uuid,text,text)') is not null
      and exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_aba_v3_session_collection_plan'),
      jsonb_build_array('get_aba_v3_rollout_drain_status','get_aba_v3_session_collection_plan')),
    (13, '20260816003000_aba_measurement_v3_pr12_dark_preflight_attestation.sql',
      exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_aba_v3_preflight_scope_snapshot'),
      jsonb_build_array('get_aba_v3_preflight_scope_snapshot')),
    (14, '20260816173500_aba_v3_runtime_uuid_scope_repair.sql',
      -- This migration is a repair/redefinition block; object presence cannot prove
      -- its exact body version. We report the repaired API surface as a proxy and
      -- flag it for history/body verification if earlier blocks are inconsistent.
      to_regprocedure('public.get_aba_v3_pilot_readiness(uuid,uuid,text,text)') is not null
      and to_regprocedure('public.set_aba_measurement_rollout_state_v3(uuid,text,uuid,text,text,boolean,boolean,text,uuid,bigint)') is not null,
      jsonb_build_array('repaired rollout/readiness API surface')),
    (15, '20260816213000_aba_v3_prompt_catalog_defaults.sql',
      exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='aba_prompt_type_system_defaults_v1'),
      jsonb_build_array('aba_prompt_type_system_defaults_v1')),

    (16, '20260820130000_clinical_measurement_v3_identities_versioning.sql',
      to_regclass('public.clinical_measurement_targets_v3') is not null
      and to_regclass('public.clinical_measurement_definitions_v3') is not null
      and to_regclass('public.clinical_collection_protocol_snapshots_v3') is not null,
      jsonb_build_array('clinical_measurement_targets_v3','clinical_measurement_definitions_v3','clinical_collection_protocol_snapshots_v3')),
    (17, '20260820144500_clinical_measurement_v3_sessions_expectations.sql',
      to_regclass('public.clinical_measurement_sessions_v3') is not null
      and to_regclass('public.clinical_measurement_session_expectations_v3') is not null
      and to_regclass('public.clinical_measurement_collection_streams_v3') is not null,
      jsonb_build_array('clinical_measurement_sessions_v3','clinical_measurement_session_expectations_v3','clinical_measurement_collection_streams_v3')),
    (18, '20260820160000_clinical_measurement_v3_raw_primitives.sql',
      to_regclass('public.clinical_measurement_raw_events_v3') is not null
      and to_regclass('public.clinical_measurement_observation_slices_v3') is not null,
      jsonb_build_array('clinical_measurement_raw_events_v3','clinical_measurement_observation_slices_v3')),
    (19, '20260820173000_clinical_measurement_v3_aba_engine.sql',
      to_regclass('public.clinical_measurement_aba_trials_v3') is not null
      and to_regclass('public.clinical_measurement_aba_trial_steps_v3') is not null,
      jsonb_build_array('clinical_measurement_aba_trials_v3','clinical_measurement_aba_trial_steps_v3')),
    (20, '20260820190000_clinical_measurement_v3_bulk_ingestion.sql',
      to_regclass('public.clinical_measurement_sync_batches_v3') is not null
      and to_regprocedure('public.sync_clinical_measurements_bulk_v3(uuid,uuid,uuid,text,jsonb)') is not null,
      jsonb_build_array('clinical_measurement_sync_batches_v3','sync_clinical_measurements_bulk_v3')),
    (21, '20260820203000_clinical_measurement_v3_projection_read_models.sql',
      to_regclass('public.clinical_measurement_projection_queue_v3') is not null
      and to_regprocedure('public.process_clinical_measurement_projection_queue_v3(integer)') is not null,
      jsonb_build_array('clinical_measurement_projection_queue_v3','process_clinical_measurement_projection_queue_v3')),
    (22, '20260820220000_clinical_measurement_v3_semantic_api_decisions.sql',
      to_regclass('public.clinical_measurement_evidence_revisions_v3') is not null
      and to_regclass('public.clinical_measurement_target_states_v3') is not null,
      jsonb_build_array('clinical_measurement_evidence_revisions_v3','clinical_measurement_target_states_v3')),
    (23, '20260820233000_clinical_measurement_v3_security_shadow_hardening.sql',
      to_regprocedure('public.get_clinical_measurement_v3_security_preflight()') is not null
      and exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_clinical_measurement_v3_shadow_comparison'),
      jsonb_build_array('get_clinical_measurement_v3_security_preflight','get_clinical_measurement_v3_shadow_comparison')),
    (24, '20260821001000_clinical_measurement_v3_dark_aba_shadow_mirror.sql',
      to_regclass('public.clinical_measurement_shadow_mirror_links_v3') is not null
      and exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='run_clinical_measurement_v3_aba_shadow_mirror'),
      jsonb_build_array('clinical_measurement_shadow_mirror_links_v3','run_clinical_measurement_v3_aba_shadow_mirror')),
    (25, '20260821002000_clinical_measurement_v3_projection_task_analysis_groupby_hotfix.sql',
      -- Hotfix replaces an existing function body. Presence alone cannot prove the
      -- corrected body, so this is conservatively marked BODY_VERSION_REQUIRES_APPLY
      -- when the projection block exists. It is safe to include in the eventual
      -- ordered promotion after inventory review.
      to_regprocedure('public.recompute_clinical_measurement_projection_batch_v3(uuid[])') is not null,
      jsonb_build_array('recompute_clinical_measurement_projection_batch_v3 body'))
  ) as v(sequence_no, migration_file, object_ready, anchor_objects)
),
summary as (
  select
    count(*)::integer as block_count,
    count(*) filter(where object_ready)::integer as ready_count,
    count(*) filter(where not object_ready)::integer as missing_count,
    coalesce(jsonb_agg(migration_file order by sequence_no) filter(where not object_ready),'[]'::jsonb) as missing_files,
    coalesce(jsonb_agg(jsonb_build_object(
      'sequence',sequence_no,
      'migration',migration_file,
      'object_ready',object_ready,
      'anchors',anchor_objects
    ) order by sequence_no),'[]'::jsonb) as blocks
  from required_blocks
)
select jsonb_build_object(
  'gate',case when missing_count=0 then 'SCHEMA_BASELINE_OBJECTS_PRESENT' else 'SCHEMA_PROMOTION_REQUIRED' end,
  'writes',false,
  'environment','PRODUCTION_EXPECTED',
  'block_count',block_count,
  'ready_count',ready_count,
  'missing_count',missing_count,
  'missing_migration_files',missing_files,
  'blocks',blocks,
  'note','Object inventory only. Re-definition/hotfix migrations may still need ordered application even when their anchor object exists; do not activate rollout from this result.',
  'checked_at',clock_timestamp()
) as clinical_measurement_v3_production_schema_inventory
from summary;

rollback;
