-- Clinical Measurement Engine V3 - production activation readiness gate.
-- READ ONLY / FAIL CLOSED.
--
-- Purpose:
--   Verify that Production is safe to enter controlled cohort selection after the
--   Staging live dark-pilot canary has passed. This script does NOT enable ABA V3,
--   does NOT create rollout rows, does NOT modify clinical data, and does NOT
--   change grants/RLS. A READY result is permission to choose one explicit
--   production cohort for a later activation operation; it is not broad rollout.

begin transaction read only;
set local statement_timeout = '20s';
set local lock_timeout = '3s';

-- Fail with a precise schema error before touching any V3 relation directly.
do $cmv3_required_schema$
declare
  v_missing text[] := '{}'::text[];
begin
  if to_regclass('public.aba_trials') is null then v_missing := array_append(v_missing,'public.aba_trials'); end if;
  if to_regclass('public.aba_sessions') is null then v_missing := array_append(v_missing,'public.aba_sessions'); end if;
  if to_regclass('public.aba_trials_v3') is null then v_missing := array_append(v_missing,'public.aba_trials_v3'); end if;
  if to_regclass('public.aba_session_target_measurement_bindings') is null then v_missing := array_append(v_missing,'public.aba_session_target_measurement_bindings'); end if;
  if to_regclass('public.aba_measurement_rollout_states_v3') is null then v_missing := array_append(v_missing,'public.aba_measurement_rollout_states_v3'); end if;
  if to_regclass('public.aba_sync_quarantine_v3') is null then v_missing := array_append(v_missing,'public.aba_sync_quarantine_v3'); end if;
  if to_regclass('public.clinical_measurement_projection_queue_v3') is null then v_missing := array_append(v_missing,'public.clinical_measurement_projection_queue_v3'); end if;
  if to_regclass('public.clinical_measurement_raw_events_v3') is null then v_missing := array_append(v_missing,'public.clinical_measurement_raw_events_v3'); end if;

  if to_regprocedure('public.get_clinical_measurement_v3_security_preflight()') is null then
    v_missing := array_append(v_missing,'public.get_clinical_measurement_v3_security_preflight()');
  end if;
  if to_regprocedure('public.sync_clinical_measurements_bulk_v3(uuid,uuid,uuid,text,jsonb)') is null then
    v_missing := array_append(v_missing,'public.sync_clinical_measurements_bulk_v3(...)');
  end if;
  if to_regprocedure('public.process_clinical_measurement_projection_queue_v3(integer)') is null then
    v_missing := array_append(v_missing,'public.process_clinical_measurement_projection_queue_v3(integer)');
  end if;
  if to_regprocedure('public.set_aba_measurement_rollout_state_v3(uuid,text,uuid,text,text,boolean,boolean,text,uuid,bigint)') is null then
    v_missing := array_append(v_missing,'public.set_aba_measurement_rollout_state_v3(...)');
  end if;
  if to_regprocedure('public.get_aba_v3_rollout_drain_status(uuid,text,uuid,text,text)') is null then
    v_missing := array_append(v_missing,'public.get_aba_v3_rollout_drain_status(...)');
  end if;
  if to_regprocedure('public.get_aba_v3_pilot_readiness(uuid,uuid,text,text)') is null then
    v_missing := array_append(v_missing,'public.get_aba_v3_pilot_readiness(...)');
  end if;
  if to_regprocedure('public.record_aba_trial_action_v3(uuid,uuid,jsonb,text,uuid)') is null then
    v_missing := array_append(v_missing,'public.record_aba_trial_action_v3(...)');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception 'CMV3_PRODUCTION_SCHEMA_NOT_READY:%', array_to_string(v_missing,', ');
  end if;
end;
$cmv3_required_schema$;

with
security as (
  select public.get_clinical_measurement_v3_security_preflight() as payload
),
function_access as (
  select jsonb_build_object(
    'universal_bulk_sync_browser_execute',
      coalesce(pg_catalog.has_function_privilege('anon',pg_catalog.to_regprocedure('public.sync_clinical_measurements_bulk_v3(uuid,uuid,uuid,text,jsonb)'),'EXECUTE'),true)
      or coalesce(pg_catalog.has_function_privilege('authenticated',pg_catalog.to_regprocedure('public.sync_clinical_measurements_bulk_v3(uuid,uuid,uuid,text,jsonb)'),'EXECUTE'),true),
    'projection_worker_browser_execute',
      coalesce(pg_catalog.has_function_privilege('anon',pg_catalog.to_regprocedure('public.process_clinical_measurement_projection_queue_v3(integer)'),'EXECUTE'),true)
      or coalesce(pg_catalog.has_function_privilege('authenticated',pg_catalog.to_regprocedure('public.process_clinical_measurement_projection_queue_v3(integer)'),'EXECUTE'),true),
    'aba_trial_writer_browser_execute',
      coalesce(pg_catalog.has_function_privilege('anon',pg_catalog.to_regprocedure('public.record_aba_trial_action_v3(uuid,uuid,jsonb,text,uuid)'),'EXECUTE'),true)
      or coalesce(pg_catalog.has_function_privilege('authenticated',pg_catalog.to_regprocedure('public.record_aba_trial_action_v3(uuid,uuid,jsonb,text,uuid)'),'EXECUTE'),true),
    'rollout_writer_browser_execute',
      coalesce(pg_catalog.has_function_privilege('anon',pg_catalog.to_regprocedure('public.set_aba_measurement_rollout_state_v3(uuid,text,uuid,text,text,boolean,boolean,text,uuid,bigint)'),'EXECUTE'),true)
      or coalesce(pg_catalog.has_function_privilege('authenticated',pg_catalog.to_regprocedure('public.set_aba_measurement_rollout_state_v3(uuid,text,uuid,text,text,boolean,boolean,text,uuid,bigint)'),'EXECUTE'),true),
    'rollout_writer_service_role_execute',
      coalesce(pg_catalog.has_function_privilege('service_role',pg_catalog.to_regprocedure('public.set_aba_measurement_rollout_state_v3(uuid,text,uuid,text,text,boolean,boolean,text,uuid,bigint)'),'EXECUTE'),false),
    'universal_bulk_sync_service_role_execute',
      coalesce(pg_catalog.has_function_privilege('service_role',pg_catalog.to_regprocedure('public.sync_clinical_measurements_bulk_v3(uuid,uuid,uuid,text,jsonb)'),'EXECUTE'),false)
  ) as payload
),
legacy_v2 as (
  select jsonb_build_object(
    'aba_trials_present',to_regclass('public.aba_trials') is not null,
    'aba_sessions_present',to_regclass('public.aba_sessions') is not null,
    'policy','PRESERVE_LEGACY_V2_AS_FALLBACK_AND_HISTORY'
  ) as payload
),
rollout as (
  select jsonb_build_object(
    'state_count',count(*)::integer,
    'allow_new_v3_sessions_count',count(*) filter(where allow_new_v3_sessions)::integer,
    'sync_enabled_count',count(*) filter(where accept_v3_sync)::integer,
    'clinic_allow_count',count(*) filter(where scope_type='CLINIC' and allow_new_v3_sessions)::integer,
    'patient_allow_count',count(*) filter(where scope_type='PATIENT' and allow_new_v3_sessions)::integer,
    'program_allow_count',count(*) filter(where scope_type='PROGRAM' and allow_new_v3_sessions)::integer,
    'target_allow_count',count(*) filter(where scope_type='TARGET' and allow_new_v3_sessions)::integer,
    'enabled_scopes',coalesce(jsonb_agg(
      jsonb_build_object(
        'organization_id',organization_id,
        'scope_type',scope_type,
        'patient_id',patient_id,
        'program_id',program_id,
        'target_id',target_id,
        'allow_new_v3_sessions',allow_new_v3_sessions,
        'accept_v3_sync',accept_v3_sync,
        'state_version',state_version,
        'effective_from',effective_from,
        'reason',reason
      ) order by organization_id::text,scope_type,coalesce(patient_id::text,''),coalesce(program_id,''),coalesce(target_id,'')
    ) filter(where allow_new_v3_sessions),'[]'::jsonb),
    'policy','PRODUCTION_GATE_REQUIRES_ZERO_PREEXISTING_NEW_V3_ENROLLMENT'
  ) as payload
  from public.aba_measurement_rollout_states_v3
),
existing_v3_activity as (
  select jsonb_build_object(
    'has_v3_trials',exists(select 1 from public.aba_trials_v3 limit 1),
    'has_v3_session_bindings',exists(
      select 1 from public.aba_session_target_measurement_bindings
      where measurement_model_version='V3'
      limit 1
    ),
    'has_universal_non_shadow_raw',exists(
      select 1 from public.clinical_measurement_raw_events_v3
      where ingestion_mode<>'SHADOW_MIRROR'
      limit 1
    ),
    'policy','FIRST_CONTROLLED_PRODUCTION_ACTIVATION_EXPECTS_NO_PREEXISTING_LIVE_V3_ACTIVITY'
  ) as payload
),
quarantine as (
  select jsonb_build_object(
    'open_count',count(*) filter(where status in ('OPEN','READY_FOR_RETRY'))::integer,
    'oldest_open_at',min(first_seen_at) filter(where status in ('OPEN','READY_FOR_RETRY'))
  ) as payload
  from public.aba_sync_quarantine_v3
),
projection_queue as (
  select jsonb_build_object(
    'failed_count',count(*) filter(where status='FAILED')::integer,
    'processing_count',count(*) filter(where status='PROCESSING')::integer,
    'stale_processing_count',count(*) filter(where status='PROCESSING' and processing_started_at < clock_timestamp()-interval '10 minutes')::integer,
    'pending_count',count(*) filter(where status='PENDING')::integer,
    'stale_pending_count',count(*) filter(where status='PENDING' and enqueued_at < clock_timestamp()-interval '10 minutes')::integer,
    'oldest_pending_at',min(enqueued_at) filter(where status='PENDING'),
    'latest_failed_error',max(last_error) filter(where status='FAILED')
  ) as payload
  from public.clinical_measurement_projection_queue_v3
),
assembled as (
  select
    security.payload as security_payload,
    function_access.payload as function_access_payload,
    legacy_v2.payload as legacy_payload,
    rollout.payload as rollout_payload,
    existing_v3_activity.payload as activity_payload,
    quarantine.payload as quarantine_payload,
    projection_queue.payload as queue_payload
  from security,function_access,legacy_v2,rollout,existing_v3_activity,quarantine,projection_queue
),
evaluated as (
  select *,
    coalesce((security_payload->>'ok')::boolean,false) as security_ok,
    not coalesce((function_access_payload->>'universal_bulk_sync_browser_execute')::boolean,true)
      and not coalesce((function_access_payload->>'projection_worker_browser_execute')::boolean,true)
      and not coalesce((function_access_payload->>'aba_trial_writer_browser_execute')::boolean,true)
      and not coalesce((function_access_payload->>'rollout_writer_browser_execute')::boolean,true)
      and coalesce((function_access_payload->>'rollout_writer_service_role_execute')::boolean,false)
      and coalesce((function_access_payload->>'universal_bulk_sync_service_role_execute')::boolean,false) as writer_boundary_ok,
    coalesce((legacy_payload->>'aba_trials_present')::boolean,false)
      and coalesce((legacy_payload->>'aba_sessions_present')::boolean,false) as legacy_preserved,
    coalesce((rollout_payload->>'allow_new_v3_sessions_count')::integer,1)=0 as rollout_closed,
    not coalesce((activity_payload->>'has_v3_trials')::boolean,true)
      and not coalesce((activity_payload->>'has_v3_session_bindings')::boolean,true)
      and not coalesce((activity_payload->>'has_universal_non_shadow_raw')::boolean,true) as live_v3_clean_baseline,
    coalesce((quarantine_payload->>'open_count')::integer,1)=0 as quarantine_clear,
    coalesce((queue_payload->>'failed_count')::integer,1)=0
      and coalesce((queue_payload->>'stale_processing_count')::integer,1)=0
      and coalesce((queue_payload->>'stale_pending_count')::integer,1)=0 as queue_healthy
  from assembled
)
select jsonb_build_object(
  'gate',case
    when not security_ok then 'BLOCKED_SECURITY_PREFLIGHT'
    when not writer_boundary_ok then 'BLOCKED_WRITER_BOUNDARY'
    when not legacy_preserved then 'BLOCKED_LEGACY_V2_BASELINE'
    when not rollout_closed then 'BLOCKED_PREEXISTING_V3_ROLLOUT'
    when not live_v3_clean_baseline then 'BLOCKED_PREEXISTING_LIVE_V3_ACTIVITY'
    when not quarantine_clear then 'BLOCKED_SYNC_QUARANTINE'
    when not queue_healthy then 'BLOCKED_PROJECTION_QUEUE'
    else 'READY_FOR_CONTROLLED_PRODUCTION_COHORT_SELECTION'
  end,
  'release_stage','PRODUCTION_ACTIVATION_READINESS',
  'writes',false,
  'broad_rollout_enabled_by_this_gate',false,
  'security_preflight',security_payload,
  'writer_boundary',function_access_payload,
  'legacy_v2',legacy_payload,
  'existing_rollout',rollout_payload,
  'existing_live_v3_activity',activity_payload,
  'sync_quarantine',quarantine_payload,
  'projection_queue',queue_payload,
  'rollback_policy',jsonb_build_object(
    'mechanism','set allow_new_v3_sessions=false while keeping accept_v3_sync=true until drain completes',
    'writer','set_aba_measurement_rollout_state_v3',
    'drain_check','get_aba_v3_rollout_drain_status',
    'legacy_v2_preserved',legacy_preserved
  ),
  'next_if_ready','Select exactly one production clinic/patient/target cohort, run target readiness, then generate an audited activation operation. Do not enable broad rollout.',
  'checked_at',clock_timestamp()
) as clinical_measurement_v3_production_activation_readiness
from evaluated;

rollback;
