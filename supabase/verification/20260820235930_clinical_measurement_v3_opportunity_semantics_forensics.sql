-- Clinical Measurement Engine V3 - opportunity semantics forensics (READ ONLY).
-- Purpose: explain why the dark mirror readiness gate detected mixed opportunity
-- semantics without weakening the release gate or writing any clinical data.
--
-- This script distinguishes three materially different cases:
--   1) revised historical trials are the only source of apparent mixture;
--   2) different trial intents (e.g. TEACHING vs PROBE) are each internally stable;
--   3) the same trial intent is internally mixed, which remains genuinely ambiguous.
--
-- It NEVER writes data.

begin transaction read only;

with params as (
  select (current_date - 90)::date as period_start, current_date::date as period_end
), trial_base as (
  select
    t.id as aba_trial_id,
    t.organization_id,
    t.patient_id,
    t.session_id,
    t.program_id,
    t.target_id,
    t.binding_id,
    t.collection_definition_version_id,
    t.target_phase_assignment_id,
    t.trial_type,
    t.occurred_at,
    t.collector_user_id,
    t.received_at,
    s.therapist_id,
    coalesce(s.reference_date, s.started_at::date) as session_date,
    d.version as definition_version,
    d.status as definition_status,
    d.definition_hash,
    d.definition,
    p.phase_type,
    p.phase_key,
    p.label as phase_label,
    exists (
      select 1
      from public.aba_trial_steps_v3 st
      where st.trial_id = t.id
        and st.opportunity_role = 'PRIMARY_INDEPENDENT'
    ) as has_primary,
    (
      select max(st.outcome)
      from public.aba_trial_steps_v3 st
      where st.trial_id = t.id
        and st.opportunity_role = 'PRIMARY_INDEPENDENT'
    ) as primary_outcome,
    (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'sequence_no', st.sequence_no,
          'step_type', st.step_type,
          'opportunity_role', st.opportunity_role,
          'outcome', st.outcome,
          'prompt_key', st.prompt_key
        ) order by st.sequence_no
      ), '[]'::jsonb)
      from public.aba_trial_steps_v3 st
      where st.trial_id = t.id
    ) as step_signature,
    exists (
      select 1
      from public.aba_trial_revisions_v3 r
      where r.trial_id = t.id
        and r.event_type <> 'ANNOTATE'
    ) as has_effective_revision,
    (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'event_type', r.event_type,
          'created_at', r.created_at
        ) order by r.created_at
      ), '[]'::jsonb)
      from public.aba_trial_revisions_v3 r
      where r.trial_id = t.id
        and r.event_type <> 'ANNOTATE'
    ) as effective_revisions
  from public.aba_trials_v3 t
  join public.aba_sessions s on s.id = t.session_id
  join public.aba_collection_definition_versions_v3 d
    on d.id = t.collection_definition_version_id
   and d.organization_id = t.organization_id
   and d.patient_id = t.patient_id
   and d.target_id = t.target_id
  join public.aba_target_phase_assignments_v3 p
    on p.id = t.target_phase_assignment_id
   and p.organization_id = t.organization_id
   and p.patient_id = t.patient_id
   and p.target_id = t.target_id
  cross join params range
  where coalesce(s.reference_date, s.started_at::date)
        between range.period_start and range.period_end
    and t.trial_type <> 'TASK_ANALYSIS'
), actor_resolution as (
  select
    b.*,
    coalesce(cm_collector.id, cm_session.id) as actor_membership_id
  from trial_base b
  left join public.clinic_memberships cm_collector
    on cm_collector.clinic_id = b.organization_id
   and cm_collector.user_id = b.collector_user_id
   and lower(coalesce(cm_collector.status, '')) = 'active'
  left join public.clinic_memberships cm_session
    on cm_session.clinic_id = b.organization_id
   and b.therapist_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and cm_session.user_id = b.therapist_id::uuid
   and lower(coalesce(cm_session.status, '')) = 'active'
), protocol_groups as (
  select
    organization_id,
    patient_id,
    target_id,
    collection_definition_version_id,
    target_phase_assignment_id,
    count(*)::integer as all_trial_count,
    count(*) filter (where not has_effective_revision)::integer as revision_free_trial_count,
    count(*) filter (where has_effective_revision)::integer as revised_trial_count,
    count(*) filter (where actor_membership_id is null)::integer as unresolved_actor_count,
    min(has_primary::integer)::integer as all_min_has_primary,
    max(has_primary::integer)::integer as all_max_has_primary,
    min(has_primary::integer) filter (where not has_effective_revision)::integer as clean_min_has_primary,
    max(has_primary::integer) filter (where not has_effective_revision)::integer as clean_max_has_primary,
    count(distinct trial_type) filter (where not has_effective_revision)::integer as clean_trial_type_count
  from actor_resolution
  group by
    organization_id,
    patient_id,
    target_id,
    collection_definition_version_id,
    target_phase_assignment_id
), trial_type_stats as (
  select
    organization_id,
    patient_id,
    target_id,
    collection_definition_version_id,
    target_phase_assignment_id,
    trial_type,
    count(*)::integer as trial_count,
    count(*) filter (where not has_effective_revision)::integer as revision_free_trial_count,
    count(*) filter (where has_effective_revision)::integer as revised_trial_count,
    min(has_primary::integer) filter (where not has_effective_revision)::integer as clean_min_has_primary,
    max(has_primary::integer) filter (where not has_effective_revision)::integer as clean_max_has_primary,
    count(*) filter (where not has_effective_revision and has_primary)::integer as clean_with_primary_count,
    count(*) filter (where not has_effective_revision and not has_primary)::integer as clean_without_primary_count
  from actor_resolution
  group by
    organization_id,
    patient_id,
    target_id,
    collection_definition_version_id,
    target_phase_assignment_id,
    trial_type
), group_diagnosis as (
  select
    g.*,
    coalesce((
      select count(*)
      from trial_type_stats ts
      where ts.organization_id = g.organization_id
        and ts.patient_id = g.patient_id
        and ts.target_id = g.target_id
        and ts.collection_definition_version_id = g.collection_definition_version_id
        and ts.target_phase_assignment_id = g.target_phase_assignment_id
        and ts.revision_free_trial_count > 0
        and ts.clean_min_has_primary is distinct from ts.clean_max_has_primary
    ), 0)::integer as mixed_within_trial_type_count,
    case
      when g.revision_free_trial_count = 0
        then 'NO_REVISION_FREE_EVIDENCE'
      when g.clean_min_has_primary = g.clean_max_has_primary
        then 'STABLE_AFTER_EXCLUDING_REVISED'
      when coalesce((
        select count(*)
        from trial_type_stats ts
        where ts.organization_id = g.organization_id
          and ts.patient_id = g.patient_id
          and ts.target_id = g.target_id
          and ts.collection_definition_version_id = g.collection_definition_version_id
          and ts.target_phase_assignment_id = g.target_phase_assignment_id
          and ts.revision_free_trial_count > 0
          and ts.clean_min_has_primary is distinct from ts.clean_max_has_primary
      ), 0) = 0
      and g.clean_trial_type_count > 1
        then 'STABLE_BY_TRIAL_TYPE'
      else 'AMBIGUOUS_WITHIN_TRIAL_TYPE'
    end as diagnosis
  from protocol_groups g
), relevant_groups as (
  select *
  from group_diagnosis
  where all_min_has_primary is distinct from all_max_has_primary
     or clean_min_has_primary is distinct from clean_max_has_primary
     or revised_trial_count > 0
), group_json as (
  select jsonb_agg(
    jsonb_build_object(
      'organization_id', g.organization_id,
      'patient_id', g.patient_id,
      'target_id', g.target_id,
      'collection_definition_version_id', g.collection_definition_version_id,
      'target_phase_assignment_id', g.target_phase_assignment_id,
      'diagnosis', g.diagnosis,
      'all_trial_count', g.all_trial_count,
      'revision_free_trial_count', g.revision_free_trial_count,
      'revised_trial_count', g.revised_trial_count,
      'unresolved_actor_count', g.unresolved_actor_count,
      'all_opportunity_modes', jsonb_build_object(
        'min_has_primary', g.all_min_has_primary,
        'max_has_primary', g.all_max_has_primary
      ),
      'revision_free_opportunity_modes', jsonb_build_object(
        'min_has_primary', g.clean_min_has_primary,
        'max_has_primary', g.clean_max_has_primary
      ),
      'mixed_within_trial_type_count', g.mixed_within_trial_type_count,
      'trial_types', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'trial_type', ts.trial_type,
            'trial_count', ts.trial_count,
            'revision_free_trial_count', ts.revision_free_trial_count,
            'revised_trial_count', ts.revised_trial_count,
            'revision_free_with_primary', ts.clean_with_primary_count,
            'revision_free_without_primary', ts.clean_without_primary_count,
            'revision_free_semantics', case
              when ts.revision_free_trial_count = 0 then 'NO_CLEAN_EVIDENCE'
              when ts.clean_min_has_primary = ts.clean_max_has_primary
                then case when ts.clean_min_has_primary = 1
                  then 'INDEPENDENT_ELIGIBLE'
                  else 'ERRORLESS_NO_INDEPENDENT'
                end
              else 'AMBIGUOUS'
            end
          ) order by ts.trial_type
        )
        from trial_type_stats ts
        where ts.organization_id = g.organization_id
          and ts.patient_id = g.patient_id
          and ts.target_id = g.target_id
          and ts.collection_definition_version_id = g.collection_definition_version_id
          and ts.target_phase_assignment_id = g.target_phase_assignment_id
      ), '[]'::jsonb),
      'definition_snapshot', (
        select jsonb_build_object(
          'version', a.definition_version,
          'status', a.definition_status,
          'definition_hash', a.definition_hash,
          'definition', a.definition
        )
        from actor_resolution a
        where a.organization_id = g.organization_id
          and a.patient_id = g.patient_id
          and a.target_id = g.target_id
          and a.collection_definition_version_id = g.collection_definition_version_id
          and a.target_phase_assignment_id = g.target_phase_assignment_id
        order by a.occurred_at
        limit 1
      ),
      'phase_snapshot', (
        select jsonb_build_object(
          'phase_type', a.phase_type,
          'phase_key', a.phase_key,
          'label', a.phase_label
        )
        from actor_resolution a
        where a.organization_id = g.organization_id
          and a.patient_id = g.patient_id
          and a.target_id = g.target_id
          and a.collection_definition_version_id = g.collection_definition_version_id
          and a.target_phase_assignment_id = g.target_phase_assignment_id
        order by a.occurred_at
        limit 1
      ),
      'trials', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'trial_id', a.aba_trial_id,
            'session_id', a.session_id,
            'session_date', a.session_date,
            'occurred_at', a.occurred_at,
            'received_at', a.received_at,
            'trial_type', a.trial_type,
            'has_primary_independent', a.has_primary,
            'primary_outcome', a.primary_outcome,
            'has_effective_revision', a.has_effective_revision,
            'effective_revisions', a.effective_revisions,
            'actor_resolved', a.actor_membership_id is not null,
            'step_signature', a.step_signature
          ) order by a.occurred_at, a.aba_trial_id
        )
        from actor_resolution a
        where a.organization_id = g.organization_id
          and a.patient_id = g.patient_id
          and a.target_id = g.target_id
          and a.collection_definition_version_id = g.collection_definition_version_id
          and a.target_phase_assignment_id = g.target_phase_assignment_id
      ), '[]'::jsonb)
    ) order by g.patient_id, g.target_id
  ) as groups
  from relevant_groups g
), totals as (
  select
    count(*)::integer as relevant_group_count,
    count(*) filter (where diagnosis = 'STABLE_AFTER_EXCLUDING_REVISED')::integer
      as stable_after_excluding_revised_count,
    count(*) filter (where diagnosis = 'STABLE_BY_TRIAL_TYPE')::integer
      as stable_by_trial_type_count,
    count(*) filter (where diagnosis = 'AMBIGUOUS_WITHIN_TRIAL_TYPE')::integer
      as ambiguous_within_trial_type_count,
    count(*) filter (where diagnosis = 'NO_REVISION_FREE_EVIDENCE')::integer
      as no_revision_free_evidence_count
  from relevant_groups
)
select jsonb_build_object(
  'gate', case
    when t.relevant_group_count = 0 then 'NO_MIXED_GROUPS_FOUND'
    when t.ambiguous_within_trial_type_count > 0 then 'BLOCKED_TRUE_OPPORTUNITY_AMBIGUITY'
    when t.no_revision_free_evidence_count > 0
         and t.stable_after_excluding_revised_count = 0
         and t.stable_by_trial_type_count = 0
      then 'BLOCKED_NO_CLEAN_EVIDENCE'
    when t.stable_by_trial_type_count > 0 then 'SAFE_SPLIT_BY_TRIAL_TYPE_CANDIDATE'
    when t.stable_after_excluding_revised_count > 0 then 'SAFE_EXCLUDE_REVISED_CANDIDATE'
    else 'REVIEW_REQUIRED'
  end,
  'period_start', current_date - 90,
  'period_end', current_date,
  'relevant_group_count', t.relevant_group_count,
  'stable_after_excluding_revised_count', t.stable_after_excluding_revised_count,
  'stable_by_trial_type_count', t.stable_by_trial_type_count,
  'ambiguous_within_trial_type_count', t.ambiguous_within_trial_type_count,
  'no_revision_free_evidence_count', t.no_revision_free_evidence_count,
  'interpretation', jsonb_build_object(
    'SAFE_SPLIT_BY_TRIAL_TYPE_CANDIDATE', 'Each clean trial type has stable opportunity semantics; a dark mirror may use separate immutable protocol snapshots per trial intent.',
    'SAFE_EXCLUDE_REVISED_CANDIDATE', 'The clean immutable subset is stable; revised trials remain excluded from the first parity shadow.',
    'BLOCKED_TRUE_OPPORTUNITY_AMBIGUITY', 'At least one revision-free trial type mixes opportunity modes. Do not mirror until the historical protocol semantics are explicitly resolved.'
  ),
  'groups', coalesce(g.groups, '[]'::jsonb),
  'writes', false
) as clinical_measurement_v3_opportunity_semantics_forensics
from totals t
cross join group_json g;

rollback;
