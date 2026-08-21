-- Clinical Measurement Engine V3 - dark mirror readiness preflight (READ ONLY).
-- Purpose: prove that historical ABA V3 raw facts can be mirrored into the
-- universal engine without fabricating actor identity, revision history or
-- opportunity semantics. This script NEVER writes data.

begin transaction read only;

with params as (
  select (current_date - 90)::date as period_start, current_date::date as period_end
), trial_base as (
  select
    t.id as aba_trial_id,
    t.organization_id,
    t.patient_id,
    t.session_id,
    t.target_id,
    t.collection_definition_version_id,
    t.target_phase_assignment_id,
    t.trial_type,
    t.occurred_at,
    t.collector_user_id,
    s.therapist_id,
    coalesce(s.reference_date, s.started_at::date) as session_date,
    case when exists (
      select 1 from public.aba_trial_steps_v3 st
      where st.trial_id=t.id and st.opportunity_role='PRIMARY_INDEPENDENT'
    ) then 1 else 0 end as has_primary,
    case when exists (
      select 1 from public.aba_trial_revisions_v3 r
      where r.trial_id=t.id and r.event_type <> 'ANNOTATE'
    ) then true else false end as has_effective_revision
  from public.aba_trials_v3 t
  join public.aba_sessions s on s.id=t.session_id
  cross join params p
  where coalesce(s.reference_date, s.started_at::date) between p.period_start and p.period_end
    and t.trial_type <> 'TASK_ANALYSIS'
), actor_resolution as (
  select
    b.*,
    coalesce(cm_collector.id, cm_session.id) as actor_membership_id
  from trial_base b
  left join public.clinic_memberships cm_collector
    on cm_collector.clinic_id=b.organization_id
   and cm_collector.user_id=b.collector_user_id
   and lower(coalesce(cm_collector.status,''))='active'
  left join public.clinic_memberships cm_session
    on cm_session.clinic_id=b.organization_id
   and b.therapist_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and cm_session.user_id=b.therapist_id::uuid
   and lower(coalesce(cm_session.status,''))='active'
), protocol_groups as (
  select
    organization_id, patient_id, target_id,
    collection_definition_version_id, target_phase_assignment_id,
    count(*)::integer as trial_count,
    min(has_primary)::integer as min_has_primary,
    max(has_primary)::integer as max_has_primary,
    count(*) filter (where has_effective_revision)::integer as revised_trial_count,
    count(*) filter (where actor_membership_id is null)::integer as unresolved_actor_count
  from actor_resolution
  group by organization_id, patient_id, target_id,
           collection_definition_version_id, target_phase_assignment_id
), stable_groups as (
  select * from protocol_groups
  where min_has_primary=max_has_primary
    and revised_trial_count=0
    and unresolved_actor_count=0
), mirrorable_trials as (
  select a.*
  from actor_resolution a
  join stable_groups g
    on g.organization_id=a.organization_id
   and g.patient_id=a.patient_id
   and g.target_id=a.target_id
   and g.collection_definition_version_id=a.collection_definition_version_id
   and g.target_phase_assignment_id=a.target_phase_assignment_id
  where not a.has_effective_revision
    and a.actor_membership_id is not null
), target_candidates as (
  select distinct m.organization_id,m.patient_id,m.target_id
  from mirrorable_trials m
  where exists (
    select 1 from public.aba_session_target_summaries_v3 s
    where s.organization_id=m.organization_id
      and s.patient_id=m.patient_id
      and s.target_id=m.target_id
  )
), totals as (
  select
    (select count(*) from trial_base)::integer as source_trial_count,
    (select count(*) from trial_base where not has_effective_revision)::integer as revision_free_trial_count,
    (select count(*) from actor_resolution where actor_membership_id is not null)::integer as actor_resolved_trial_count,
    (select count(*) from actor_resolution where actor_membership_id is null)::integer as actor_unresolved_trial_count,
    (select count(*) from protocol_groups)::integer as protocol_group_count,
    (select count(*) from protocol_groups where min_has_primary<>max_has_primary)::integer as mixed_opportunity_mode_group_count,
    (select count(*) from stable_groups)::integer as stable_protocol_group_count,
    (select count(*) from mirrorable_trials)::integer as mirrorable_trial_count,
    (select count(distinct session_id) from mirrorable_trials)::integer as mirrorable_session_count,
    (select count(*) from target_candidates)::integer as mirrorable_target_count
)
select jsonb_build_object(
  'gate', case
    when t.source_trial_count=0 then 'BLOCKED_NO_ABA_V3_RAW_DATA'
    when t.revision_free_trial_count=0 then 'BLOCKED_ALL_SOURCE_DATA_REVISED'
    when t.actor_resolved_trial_count=0 then 'BLOCKED_ACTOR_IDENTITY_UNRESOLVED'
    when t.stable_protocol_group_count=0 then 'BLOCKED_OPPORTUNITY_SEMANTICS_AMBIGUOUS'
    when t.mirrorable_trial_count=0 or t.mirrorable_target_count=0 then 'BLOCKED_NO_SAFE_MIRROR_CANDIDATES'
    else 'READY_FOR_DARK_MIRROR'
  end,
  'period_start', current_date-90,
  'period_end', current_date,
  'source_trial_count', t.source_trial_count,
  'revision_free_trial_count', t.revision_free_trial_count,
  'actor_resolved_trial_count', t.actor_resolved_trial_count,
  'actor_unresolved_trial_count', t.actor_unresolved_trial_count,
  'protocol_group_count', t.protocol_group_count,
  'mixed_opportunity_mode_group_count', t.mixed_opportunity_mode_group_count,
  'stable_protocol_group_count', t.stable_protocol_group_count,
  'mirrorable_trial_count', t.mirrorable_trial_count,
  'mirrorable_session_count', t.mirrorable_session_count,
  'mirrorable_target_count', t.mirrorable_target_count,
  'safety_policy', jsonb_build_object(
    'source', 'ABA_V3_IMMUTABLE_RAW_ONLY',
    'revised_trials', 'EXCLUDED',
    'unresolved_actor', 'EXCLUDED',
    'mixed_opportunity_mode', 'EXCLUDED',
    'task_analysis', 'EXCLUDED_FROM_PROPORTION_SHADOW',
    'writes', false
  )
) as clinical_measurement_v3_shadow_mirror_readiness
from totals t;

rollback;
