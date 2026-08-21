-- Clinical Measurement Engine V3 - live canary source diagnostic.
-- READ ONLY. No writes, no rollout changes, no mirror execution.
-- Purpose: explain why the live canary sees zero new ABA V3 trials.

with scope as (
  select
    link.organization_id,
    link.patient_id,
    link.source_target_id,
    link.universal_target_id,
    link.universal_definition_id,
    max(link.mirrored_at) as last_mirrored_at
  from public.clinical_measurement_shadow_mirror_links_v3 link
  group by
    link.organization_id,
    link.patient_id,
    link.source_target_id,
    link.universal_target_id,
    link.universal_definition_id
  order by max(link.mirrored_at) desc,
           link.organization_id::text,
           link.patient_id::text,
           link.source_target_id
  limit 1
),
new_v3 as (
  select
    t.id,
    t.session_id,
    t.target_id,
    target.name as target_name,
    t.trial_type,
    t.received_at,
    t.occurred_at,
    binding.measurement_model_version,
    exists (
      select 1
      from public.aba_trial_steps_v3 step
      where step.trial_id=t.id
        and step.opportunity_role='PRIMARY_INDEPENDENT'
    ) as has_primary_independent,
    (
      select max(step.outcome)
      from public.aba_trial_steps_v3 step
      where step.trial_id=t.id
        and step.opportunity_role='PRIMARY_INDEPENDENT'
    ) as primary_outcome
  from scope
  join public.aba_trials_v3 t
    on t.organization_id=scope.organization_id
   and t.patient_id=scope.patient_id
   and t.received_at>scope.last_mirrored_at
  join public.aba_targets target on target.id=t.target_id
  left join public.aba_session_target_measurement_bindings binding on binding.id=t.binding_id
),
new_v2 as (
  select
    t.id,
    t.session_id,
    t.target_id,
    target.name as target_name,
    t.collection_type,
    t.correct,
    t.independent,
    t.prompt_level_key,
    t.created_at,
    t.occurred_at
  from scope
  join public.aba_trials t
    on t.patient_id=scope.patient_id
   and t.created_at>scope.last_mirrored_at
  left join public.aba_targets target on target.id=t.target_id
),
recent_sessions as (
  select
    s.id as session_id,
    s.status,
    s.started_at,
    s.ended_at,
    s.reference_date,
    s.updated_at,
    source_binding.measurement_model_version as source_target_binding_model,
    source_binding.bound_at as source_target_bound_at,
    (select count(*) from new_v3 v3 where v3.session_id=s.id and v3.target_id=scope.source_target_id)::integer as source_target_v3_trials,
    (select count(*) from new_v2 v2 where v2.session_id=s.id and v2.target_id=scope.source_target_id)::integer as source_target_v2_trials,
    (select count(*) from new_v3 v3 where v3.session_id=s.id and v3.target_id<>scope.source_target_id)::integer as other_target_v3_trials,
    (select count(*) from new_v2 v2 where v2.session_id=s.id and coalesce(v2.target_id,'')<>scope.source_target_id)::integer as other_target_v2_trials
  from scope
  join public.aba_sessions s on s.patient_id=scope.patient_id
  left join public.aba_session_target_measurement_bindings source_binding
    on source_binding.session_id=s.id
   and source_binding.target_id=scope.source_target_id
  where s.updated_at>scope.last_mirrored_at - interval '5 minutes'
     or exists (select 1 from new_v3 v3 where v3.session_id=s.id)
     or exists (select 1 from new_v2 v2 where v2.session_id=s.id)
  order by greatest(s.updated_at,coalesce(s.ended_at,s.started_at)) desc
  limit 10
),
counts as (
  select
    (select count(*) from new_v3 where target_id=scope.source_target_id)::integer as new_v3_source_count,
    (select count(*) from new_v2 where target_id=scope.source_target_id)::integer as new_v2_source_count,
    (select count(*) from new_v3 where target_id<>scope.source_target_id)::integer as new_v3_other_count,
    (select count(*) from new_v2 where coalesce(target_id,'')<>scope.source_target_id)::integer as new_v2_other_count,
    (select count(*) from recent_sessions where lower(coalesce(status,''))='completed' and ended_at is not null)::integer as completed_recent_session_count,
    (select count(*) from recent_sessions where lower(coalesce(status,''))<>'completed' or ended_at is null)::integer as unfinished_recent_session_count
  from scope
)
select jsonb_build_object(
  'diagnosis',case
    when counts.new_v3_source_count>0 then 'NEW_V3_SOURCE_DATA_EXISTS_REVIEW_CANARY_FILTER'
    when counts.new_v2_source_count>0 then 'SOURCE_TARGET_COLLECTED_AS_LEGACY_V2'
    when counts.new_v3_other_count+counts.new_v2_other_count>0 then 'COLLECTED_DIFFERENT_TARGET'
    when counts.unfinished_recent_session_count>0 then 'SESSION_NOT_COMPLETED_OR_TARGET_NOT_RECORDED'
    when counts.completed_recent_session_count>0 then 'COMPLETED_SESSION_WITHOUT_NEW_SOURCE_TARGET_TRIALS'
    else 'NO_NEW_SESSION_OR_TRIAL_SAVE_AFTER_MIRROR'
  end,
  'scope',jsonb_build_object(
    'organization_id',scope.organization_id,
    'patient_id',scope.patient_id,
    'source_target_id',scope.source_target_id,
    'source_target_name',(select name from public.aba_targets where id=scope.source_target_id),
    'last_mirrored_at',scope.last_mirrored_at
  ),
  'counts',jsonb_build_object(
    'new_v3_source_count',counts.new_v3_source_count,
    'new_v2_source_count',counts.new_v2_source_count,
    'new_v3_other_count',counts.new_v3_other_count,
    'new_v2_other_count',counts.new_v2_other_count,
    'completed_recent_session_count',counts.completed_recent_session_count,
    'unfinished_recent_session_count',counts.unfinished_recent_session_count
  ),
  'recent_sessions',coalesce((
    select jsonb_agg(jsonb_build_object(
      'session_id',session_id,
      'status',status,
      'started_at',started_at,
      'ended_at',ended_at,
      'reference_date',reference_date,
      'updated_at',updated_at,
      'source_target_binding_model',source_target_binding_model,
      'source_target_bound_at',source_target_bound_at,
      'source_target_v3_trials',source_target_v3_trials,
      'source_target_v2_trials',source_target_v2_trials,
      'other_target_v3_trials',other_target_v3_trials,
      'other_target_v2_trials',other_target_v2_trials
    ) order by updated_at desc)
    from recent_sessions
  ),'[]'::jsonb),
  'new_v3_trials',coalesce((
    select jsonb_agg(jsonb_build_object(
      'trial_id',id,
      'session_id',session_id,
      'target_id',target_id,
      'target_name',target_name,
      'trial_type',trial_type,
      'measurement_model_version',measurement_model_version,
      'received_at',received_at,
      'has_primary_independent',has_primary_independent,
      'primary_outcome',primary_outcome
    ) order by received_at)
    from new_v3
  ),'[]'::jsonb),
  'new_v2_trials',coalesce((
    select jsonb_agg(jsonb_build_object(
      'trial_id',id,
      'session_id',session_id,
      'target_id',target_id,
      'target_name',target_name,
      'collection_type',collection_type,
      'correct',correct,
      'independent',independent,
      'prompt_level_key',prompt_level_key,
      'created_at',created_at
    ) order by created_at)
    from new_v2
  ),'[]'::jsonb),
  'writes',false
) as clinical_measurement_v3_live_canary_source_diagnostic
from scope cross join counts;
