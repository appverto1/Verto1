-- Clinical Measurement Engine V3 - final dark-pilot readiness gate.
-- READ ONLY. This script never enables rollout, exposes writers, or mutates data.
-- It evaluates the current shadow evidence produced by the controlled ABA mirror.

begin transaction read only;

with
security as (
  select public.get_clinical_measurement_v3_security_preflight() as payload
),
sensitive_functions as (
  select jsonb_build_object(
    'sync_bulk_browser_execute',
      pg_catalog.has_function_privilege('anon', 'public.sync_clinical_measurements_bulk_v3(uuid,uuid,uuid,text,jsonb)'::regprocedure, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', 'public.sync_clinical_measurements_bulk_v3(uuid,uuid,uuid,text,jsonb)'::regprocedure, 'EXECUTE'),
    'projection_worker_browser_execute',
      pg_catalog.has_function_privilege('anon', 'public.process_clinical_measurement_projection_queue_v3(integer)'::regprocedure, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', 'public.process_clinical_measurement_projection_queue_v3(integer)'::regprocedure, 'EXECUTE'),
    'shadow_mirror_browser_execute',
      pg_catalog.has_function_privilege('anon', 'public.run_clinical_measurement_v3_aba_shadow_mirror(uuid,uuid,text,date,date)'::regprocedure, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', 'public.run_clinical_measurement_v3_aba_shadow_mirror(uuid,uuid,text,date,date)'::regprocedure, 'EXECUTE')
  ) as payload
),
shadow_scopes as (
  select distinct
    link.organization_id,
    link.patient_id,
    link.universal_target_id,
    link.universal_definition_id,
    min(session.clinical_date) over (
      partition by link.organization_id,link.patient_id,link.universal_target_id,link.universal_definition_id
    ) as period_start,
    max(session.clinical_date) over (
      partition by link.organization_id,link.patient_id,link.universal_target_id,link.universal_definition_id
    ) as period_end
  from public.clinical_measurement_shadow_mirror_links_v3 link
  join public.clinical_measurement_sessions_v3 session
    on session.id=link.universal_session_id
   and session.organization_id=link.organization_id
   and session.patient_id=link.patient_id
),
comparisons as (
  select
    scope.*,
    public.get_clinical_measurement_v3_shadow_comparison(
      scope.organization_id,
      scope.patient_id,
      scope.universal_target_id,
      scope.universal_definition_id,
      scope.period_start,
      scope.period_end
    ) as comparison
  from shadow_scopes scope
),
parity as (
  select
    count(*)::integer as scope_count,
    coalesce(sum((comparison#>>'{canonical_comparison,compared_session_count}')::integer),0)::integer as compared_session_count,
    coalesce(sum((comparison#>>'{canonical_comparison,match_count}')::integer),0)::integer as match_count,
    coalesce(sum((comparison#>>'{canonical_comparison,mismatch_count}')::integer),0)::integer as mismatch_count,
    coalesce(sum((comparison#>>'{canonical_comparison,incomplete_count}')::integer),0)::integer as incomplete_count,
    coalesce(sum((comparison#>>'{canonical_comparison,multi_segment_not_directly_comparable_count}')::integer),0)::integer as multi_segment_count,
    coalesce(bool_and((comparison#>>'{canonical_comparison,parity_clean}')::boolean),false) as all_scopes_clean,
    coalesce(jsonb_agg(jsonb_build_object(
      'organization_id',organization_id,
      'patient_id',patient_id,
      'target_id',universal_target_id,
      'definition_id',universal_definition_id,
      'period_start',period_start,
      'period_end',period_end,
      'canonical_comparison',comparison->'canonical_comparison'
    )), '[]'::jsonb) as scopes
  from comparisons
),
queue as (
  select jsonb_build_object(
    'pending_count',count(*) filter(where status='PENDING'),
    'processing_count',count(*) filter(where status='PROCESSING'),
    'failed_count',count(*) filter(where status='FAILED'),
    'stale_pending_count',count(*) filter(where status='PENDING' and enqueued_at < clock_timestamp()-interval '5 minutes'),
    'oldest_pending_at',min(enqueued_at) filter(where status='PENDING'),
    'latest_error',max(last_error) filter(where status='FAILED')
  ) as payload
  from public.clinical_measurement_projection_queue_v3
),
mirror_integrity as (
  select jsonb_build_object(
    'link_count',count(*),
    'distinct_source_trial_count',count(distinct source_trial_id),
    'distinct_universal_event_count',count(distinct universal_event_id),
    'non_shadow_ingestion_count',count(*) filter(where event.ingestion_mode<>'SHADOW_MIRROR'),
    'latest_mirrored_at',max(link.mirrored_at)
  ) as payload
  from public.clinical_measurement_shadow_mirror_links_v3 link
  join public.clinical_measurement_raw_events_v3 event on event.id=link.universal_event_id
),
rollout as (
  select jsonb_build_object(
    'enabled_state_count',count(*) filter(where allow_new_v3_sessions or accept_v3_sync),
    'policy','THIS_GATE_DOES_NOT_MUTATE_ROLLOUT'
  ) as payload
  from public.aba_measurement_rollout_states_v3
),
assembled as (
  select
    security.payload as security_payload,
    sensitive_functions.payload as sensitive_payload,
    parity.*,
    queue.payload as queue_payload,
    mirror_integrity.payload as mirror_payload,
    rollout.payload as rollout_payload
  from security,sensitive_functions,parity,queue,mirror_integrity,rollout
),
evaluated as (
  select *,
    coalesce((security_payload->>'ok')::boolean,false) as security_ok,
    not coalesce((sensitive_payload->>'sync_bulk_browser_execute')::boolean,true)
      and not coalesce((sensitive_payload->>'projection_worker_browser_execute')::boolean,true)
      and not coalesce((sensitive_payload->>'shadow_mirror_browser_execute')::boolean,true) as sensitive_functions_closed,
    scope_count>0 and compared_session_count>0 and all_scopes_clean
      and mismatch_count=0 and incomplete_count=0 and multi_segment_count=0 as parity_ok,
    coalesce((queue_payload->>'failed_count')::integer,0)=0
      and coalesce((queue_payload->>'stale_pending_count')::integer,0)=0 as queue_ok,
    coalesce((mirror_payload->>'link_count')::integer,0)>0
      and coalesce((mirror_payload->>'link_count')::integer,0)=coalesce((mirror_payload->>'distinct_source_trial_count')::integer,-1)
      and coalesce((mirror_payload->>'link_count')::integer,0)=coalesce((mirror_payload->>'distinct_universal_event_count')::integer,-1)
      and coalesce((mirror_payload->>'non_shadow_ingestion_count')::integer,1)=0 as mirror_ok
  from assembled
)
select jsonb_build_object(
  'gate',case
    when not security_ok then 'BLOCKED_SECURITY_PREFLIGHT'
    when not sensitive_functions_closed then 'BLOCKED_BROWSER_WRITER_EXPOSURE'
    when not mirror_ok then 'BLOCKED_SHADOW_PROVENANCE'
    when not parity_ok then 'BLOCKED_SHADOW_PARITY'
    when not queue_ok then 'BLOCKED_PROJECTION_QUEUE'
    else 'READY_FOR_DARK_PILOT'
  end,
  'release_stage','DARK_PILOT_READINESS',
  'security_preflight',security_payload,
  'sensitive_functions',sensitive_payload,
  'shadow_parity',jsonb_build_object(
    'scope_count',scope_count,
    'compared_session_count',compared_session_count,
    'match_count',match_count,
    'mismatch_count',mismatch_count,
    'incomplete_count',incomplete_count,
    'multi_segment_not_directly_comparable_count',multi_segment_count,
    'all_scopes_clean',all_scopes_clean,
    'scopes',scopes,
    'note','One clean comparison is sufficient for dark-pilot readiness only; it is not evidence for broad production rollout.'
  ),
  'projection_queue',queue_payload,
  'shadow_mirror_integrity',mirror_payload,
  'existing_aba_v3_rollout_state',rollout_payload,
  'writer_policy',jsonb_build_object(
    'browser_writer_enabled',false,
    'universal_bulk_sync','SERVICE_ROLE_ONLY',
    'rollout_mutated_by_this_gate',false
  ),
  'checked_at',clock_timestamp()
) as clinical_measurement_v3_dark_pilot_readiness
from evaluated;

rollback;
