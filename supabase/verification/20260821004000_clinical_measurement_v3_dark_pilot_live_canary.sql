-- Clinical Measurement Engine V3 - live dark-pilot canary.
-- OPERATIONAL SHADOW WRITE ONLY: this script mirrors new, already-completed ABA V3
-- raw facts into the universal CMV3 shadow. It never enables a browser writer,
-- never mutates V2/ABA V3 source data, and never changes rollout state.
--
-- Run only AFTER collecting a fresh controlled ABA V3 session in the same target
-- already validated by the initial shadow mirror. For a meaningful canary, create
-- at least 3 revision-free trials containing BOTH:
--   * >= 2 PRIMARY_INDEPENDENT opportunities (including >=1 CORRECT and >=1 non-CORRECT)
--   * >= 1 SUPPORT-only/prompted trial
-- The script blocks without writing if this canary shape is not present.

begin;

create temporary table cmv3_dark_pilot_canary_context on commit drop as
with scope_rows as (
  select
    link.organization_id,
    link.patient_id,
    link.source_target_id,
    link.universal_target_id,
    link.universal_definition_id,
    max(link.mirrored_at) as last_mirrored_at,
    count(*)::integer as existing_link_count
  from public.clinical_measurement_shadow_mirror_links_v3 link
  group by
    link.organization_id,
    link.patient_id,
    link.source_target_id,
    link.universal_target_id,
    link.universal_definition_id
), ranked_scope as (
  select s.*, dense_rank() over(order by s.last_mirrored_at desc) as recency_rank
  from scope_rows s
), selected_scope as (
  select * from ranked_scope where recency_rank=1
), candidates as (
  select
    t.id as source_trial_id,
    t.organization_id,
    t.patient_id,
    t.target_id,
    t.collection_definition_version_id,
    t.target_phase_assignment_id,
    t.session_id,
    t.received_at,
    coalesce(s.reference_date, s.started_at::date) as clinical_date,
    exists (
      select 1 from public.aba_trial_steps_v3 st
      where st.trial_id=t.id and st.opportunity_role='PRIMARY_INDEPENDENT'
    ) as has_primary,
    (
      select max(st.outcome)
      from public.aba_trial_steps_v3 st
      where st.trial_id=t.id and st.opportunity_role='PRIMARY_INDEPENDENT'
    ) as primary_outcome,
    exists (
      select 1 from public.aba_trial_revisions_v3 r
      where r.trial_id=t.id and r.event_type<>'ANNOTATE'
    ) as has_effective_revision
  from selected_scope scope
  join public.aba_trials_v3 t
    on t.organization_id=scope.organization_id
   and t.patient_id=scope.patient_id
   and t.target_id=scope.source_target_id
  join public.aba_sessions s on s.id=t.session_id
  where t.received_at > scope.last_mirrored_at
    and t.trial_type<>'TASK_ANALYSIS'
    and lower(coalesce(s.status,''))='completed'
    and s.ended_at is not null
    and not exists (
      select 1 from public.clinical_measurement_shadow_mirror_links_v3 link
      where link.source_trial_id=t.id
    )
), clean_candidates as (
  select * from candidates where not has_effective_revision
), stats as (
  select
    (select count(*) from selected_scope)::integer as selected_scope_count,
    (select organization_id from selected_scope order by organization_id::text limit 1) as organization_id,
    (select patient_id from selected_scope order by patient_id::text limit 1) as patient_id,
    (select source_target_id from selected_scope order by source_target_id::text limit 1) as source_target_id,
    (select universal_target_id from selected_scope order by universal_target_id::text limit 1) as universal_target_id,
    (select universal_definition_id from selected_scope order by universal_definition_id::text limit 1) as universal_definition_id,
    (select min(last_mirrored_at) from selected_scope) as last_mirrored_at,
    (select min(existing_link_count) from selected_scope) as existing_link_count,
    count(*)::integer as candidate_count,
    count(*) filter(where has_primary)::integer as primary_candidate_count,
    count(*) filter(where not has_primary)::integer as support_only_candidate_count,
    count(*) filter(where has_primary and primary_outcome='CORRECT')::integer as primary_correct_count,
    count(*) filter(where has_primary and primary_outcome is distinct from 'CORRECT')::integer as primary_non_correct_count,
    count(distinct session_id)::integer as candidate_session_count,
    count(distinct collection_definition_version_id)::integer as definition_version_count,
    count(distinct target_phase_assignment_id)::integer as phase_assignment_count,
    min(clinical_date) as period_start,
    max(clinical_date) as period_end,
    (select count(*) from candidates where has_effective_revision)::integer as excluded_revised_count
  from clean_candidates
)
select *, public.get_clinical_measurement_v3_security_preflight() as security_preflight
from stats;

create temporary table cmv3_dark_pilot_canary_execution on commit drop as
select
  ctx.*,
  case
    when ctx.selected_scope_count<>1 then jsonb_build_object('gate','BLOCKED_SHADOW_SCOPE_AMBIGUOUS')
    when coalesce((ctx.security_preflight->>'ok')::boolean,false)=false then jsonb_build_object('gate','BLOCKED_SECURITY_PREFLIGHT','security_preflight',ctx.security_preflight)
    when ctx.candidate_count=0 then jsonb_build_object('gate','BLOCKED_NO_NEW_PILOT_DATA')
    when ctx.candidate_count<3 then jsonb_build_object('gate','BLOCKED_CANARY_SAMPLE_TOO_SMALL','required_trials',3,'observed_trials',ctx.candidate_count)
    when ctx.primary_candidate_count<2 or ctx.support_only_candidate_count<1 then jsonb_build_object(
      'gate','BLOCKED_CANARY_OPPORTUNITY_COVERAGE',
      'required',jsonb_build_object('primary_min',2,'support_only_min',1),
      'observed',jsonb_build_object('primary',ctx.primary_candidate_count,'support_only',ctx.support_only_candidate_count)
    )
    when ctx.primary_correct_count<1 or ctx.primary_non_correct_count<1 then jsonb_build_object(
      'gate','BLOCKED_CANARY_OUTCOME_COVERAGE',
      'required',jsonb_build_object('primary_correct_min',1,'primary_non_correct_min',1),
      'observed',jsonb_build_object('primary_correct',ctx.primary_correct_count,'primary_non_correct',ctx.primary_non_correct_count)
    )
    when ctx.definition_version_count<>1 then jsonb_build_object('gate','BLOCKED_CANARY_MULTIPLE_DEFINITION_VERSIONS','count',ctx.definition_version_count)
    when ctx.phase_assignment_count<>1 then jsonb_build_object('gate','BLOCKED_CANARY_MULTIPLE_PHASES','count',ctx.phase_assignment_count)
    when ctx.period_start is null or ctx.period_end is null then jsonb_build_object('gate','BLOCKED_CANARY_PERIOD_UNRESOLVED')
    else public.run_clinical_measurement_v3_aba_shadow_mirror(
      ctx.organization_id,
      ctx.patient_id,
      ctx.source_target_id,
      ctx.period_start,
      ctx.period_end
    )
  end as mirror_result
from cmv3_dark_pilot_canary_context ctx;

create temporary table cmv3_dark_pilot_canary_post on commit drop as
select
  exec.*,
  (
    select count(*)::integer
    from public.clinical_measurement_shadow_mirror_links_v3 link
    join public.aba_trials_v3 trial on trial.id=link.source_trial_id
    where link.organization_id=exec.organization_id
      and link.patient_id=exec.patient_id
      and link.source_target_id=exec.source_target_id
      and trial.received_at>exec.last_mirrored_at
  ) as post_new_link_count,
  case
    when exec.mirror_result->>'gate'='PASS'
      and exec.period_start is not null
      and exec.period_end is not null
    then public.get_clinical_measurement_v3_shadow_comparison(
      exec.organization_id,
      exec.patient_id,
      exec.universal_target_id,
      exec.universal_definition_id,
      exec.period_start,
      exec.period_end
    )
    else null
  end as post_comparison
from cmv3_dark_pilot_canary_execution exec;

-- If the mirror ran, failure to preserve every clean canary fact or any canonical
-- parity failure aborts the transaction. This prevents a partially accepted pilot.
do $cmv3$
declare
  r record;
  v_gate text;
  v_parity_clean boolean;
begin
  select * into r from cmv3_dark_pilot_canary_post;
  v_gate := coalesce(r.mirror_result->>'gate','');

  if v_gate='PASS' then
    if r.post_new_link_count < r.candidate_count then
      raise exception 'CMV3_DARK_PILOT_CANARY_LINK_INCOMPLETE:%/%',r.post_new_link_count,r.candidate_count;
    end if;
    v_parity_clean := coalesce((r.post_comparison #>> '{canonical_comparison,parity_clean}')::boolean,false);
    if not v_parity_clean
       or coalesce((r.post_comparison #>> '{canonical_comparison,mismatch_count}')::integer,0)<>0
       or coalesce((r.post_comparison #>> '{canonical_comparison,incomplete_count}')::integer,0)<>0 then
      raise exception 'CMV3_DARK_PILOT_CANARY_PARITY_BLOCKED:%',r.post_comparison::text;
    end if;
  end if;
end;
$cmv3$;

select jsonb_build_object(
  'gate',case
    when mirror_result->>'gate'<>'PASS' then mirror_result->>'gate'
    else 'PASS'
  end,
  'release_stage','LIVE_DARK_PILOT_CANARY',
  'source_engine','ABA_V3_EFFECTIVE_RAW',
  'writer_policy',jsonb_build_object(
    'browser_writer_enabled',false,
    'universal_bulk_sync','SERVICE_ROLE_ONLY',
    'source_aba_v3_unchanged',true,
    'rollout_mutated_by_this_script',false
  ),
  'scope',jsonb_build_object(
    'organization_id',organization_id,
    'patient_id',patient_id,
    'source_target_id',source_target_id,
    'universal_target_id',universal_target_id,
    'universal_definition_id',universal_definition_id,
    'period_start',period_start,
    'period_end',period_end
  ),
  'canary',jsonb_build_object(
    'candidate_trial_count',candidate_count,
    'primary_candidate_count',primary_candidate_count,
    'support_only_candidate_count',support_only_candidate_count,
    'primary_correct_count',primary_correct_count,
    'primary_non_correct_count',primary_non_correct_count,
    'candidate_session_count',candidate_session_count,
    'excluded_revised_count',excluded_revised_count,
    'mirrored_new_link_count',post_new_link_count
  ),
  'mirror_result',mirror_result,
  'post_comparison',post_comparison,
  'security_preflight',security_preflight,
  'note','PASS proves a fresh user-path ABA V3 collection can be shadowed through raw -> universal projection -> canonical parity. It does not enable broad production rollout.'
) as clinical_measurement_v3_live_dark_pilot_canary
from cmv3_dark_pilot_canary_post;

commit;
