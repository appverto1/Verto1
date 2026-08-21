-- Clinical Measurement Engine V3 - real shadow validation (read-only).
-- No data is inserted/updated/deleted. This script selects recent ABA-backed
-- PROPORTION targets that have BOTH Universal V3 and canonical ABA V3 data,
-- executes the service-only shadow comparator, and returns a release gate.

begin transaction read only;

-- Security must remain green before any shadow result is considered.
select public.get_clinical_measurement_v3_security_preflight() as security_preflight;

with candidate_base as (
  select
    t.organization_id,
    t.patient_id,
    t.id as target_id,
    t.aba_target_id,
    d.id as definition_id,
    count(distinct cms.aba_session_id) filter (
      where ps.expectation_id is not null
        and ps.projection_status = 'READY'
        and ps.clinical_date >= current_date - 90
    )::integer as universal_v3_session_count,
    count(distinct av3.session_id) filter (
      where coalesce(s.reference_date, s.started_at::date) >= current_date - 90
    )::integer as canonical_aba_v3_session_count
  from public.clinical_measurement_targets_v3 t
  join public.clinical_measurement_definitions_v3 d
    on d.organization_id = t.organization_id
   and d.patient_id = t.patient_id
   and d.target_id = t.id
   and d.semantic_family = 'PROPORTION'
  left join public.clinical_measurement_session_proportion_summaries_v3 ps
    on ps.organization_id = t.organization_id
   and ps.patient_id = t.patient_id
   and ps.target_id = t.id
  left join public.clinical_measurement_sessions_v3 cms
    on cms.id = ps.session_id
   and cms.organization_id = ps.organization_id
   and cms.patient_id = ps.patient_id
   and cms.source_kind = 'ABA_SESSION'
  left join public.aba_session_target_summaries_v3 av3
    on av3.organization_id = t.organization_id
   and av3.patient_id = t.patient_id
   and av3.target_id = t.aba_target_id
  left join public.aba_sessions s
    on s.id = av3.session_id
   and s.patient_id = t.patient_id
   and s.clinic_id = t.organization_id::text
  where t.source_kind = 'ABA_TARGET'
  group by t.organization_id, t.patient_id, t.id, t.aba_target_id, d.id
), candidates as (
  select *
  from candidate_base
  where universal_v3_session_count > 0
    and canonical_aba_v3_session_count > 0
  order by
    least(universal_v3_session_count, canonical_aba_v3_session_count) desc,
    universal_v3_session_count desc,
    canonical_aba_v3_session_count desc,
    organization_id,
    patient_id,
    target_id
  limit 20
), shadow_runs as (
  select
    c.*,
    public.get_clinical_measurement_v3_shadow_comparison(
      c.organization_id,
      c.patient_id,
      c.target_id,
      c.definition_id,
      current_date - 90,
      current_date
    ) as result
  from candidates c
), normalized as (
  select
    organization_id,
    patient_id,
    target_id,
    aba_target_id,
    definition_id,
    universal_v3_session_count,
    canonical_aba_v3_session_count,
    coalesce((result #>> '{canonical_comparison,compared_session_count}')::integer, 0) as compared_session_count,
    coalesce((result #>> '{canonical_comparison,match_count}')::integer, 0) as match_count,
    coalesce((result #>> '{canonical_comparison,mismatch_count}')::integer, 0) as mismatch_count,
    coalesce((result #>> '{canonical_comparison,incomplete_count}')::integer, 0) as incomplete_count,
    coalesce((result #>> '{canonical_comparison,multi_segment_not_directly_comparable_count}')::integer, 0) as multi_segment_count,
    coalesce((result #>> '{canonical_comparison,parity_clean}')::boolean, false) as parity_clean,
    result
  from shadow_runs
), aggregate_gate as (
  select
    count(*)::integer as candidate_count,
    count(*) filter (where compared_session_count > 0)::integer as targets_with_direct_comparison,
    count(*) filter (where parity_clean)::integer as clean_target_count,
    coalesce(sum(compared_session_count), 0)::integer as compared_session_count,
    coalesce(sum(match_count), 0)::integer as match_count,
    coalesce(sum(mismatch_count), 0)::integer as mismatch_count,
    coalesce(sum(incomplete_count), 0)::integer as incomplete_count,
    coalesce(sum(multi_segment_count), 0)::integer as multi_segment_count
  from normalized
)
select jsonb_build_object(
  'gate', case
    when g.candidate_count = 0 then 'BLOCKED_NO_COMPARABLE_DATA'
    when g.targets_with_direct_comparison = 0 then 'BLOCKED_NO_DIRECT_COMPARISON'
    when g.mismatch_count > 0 or g.incomplete_count > 0 then 'BLOCKED_PARITY_FAILURE'
    when g.compared_session_count = 0 then 'BLOCKED_NO_DIRECT_COMPARISON'
    else 'PASS'
  end,
  'period_start', current_date - 90,
  'period_end', current_date,
  'candidate_count', g.candidate_count,
  'targets_with_direct_comparison', g.targets_with_direct_comparison,
  'clean_target_count', g.clean_target_count,
  'compared_session_count', g.compared_session_count,
  'match_count', g.match_count,
  'mismatch_count', g.mismatch_count,
  'incomplete_count', g.incomplete_count,
  'multi_segment_not_directly_comparable_count', g.multi_segment_count,
  'release_policy', jsonb_build_object(
    'universal_vs_aba_v3', 'RELEASE_BLOCKING',
    'legacy_v2', 'OBSERVATIONAL_ONLY',
    'multi_segment', 'EXCLUDED_FROM_DIRECT_PARITY'
  ),
  'targets', coalesce((
    select jsonb_agg(jsonb_build_object(
      'organization_id', n.organization_id,
      'patient_id', n.patient_id,
      'target_id', n.target_id,
      'aba_target_id', n.aba_target_id,
      'definition_id', n.definition_id,
      'universal_v3_session_count', n.universal_v3_session_count,
      'canonical_aba_v3_session_count', n.canonical_aba_v3_session_count,
      'compared_session_count', n.compared_session_count,
      'match_count', n.match_count,
      'mismatch_count', n.mismatch_count,
      'incomplete_count', n.incomplete_count,
      'multi_segment_count', n.multi_segment_count,
      'parity_clean', n.parity_clean
    ) order by n.compared_session_count desc, n.target_id)
    from normalized n
  ), '[]'::jsonb)
) as clinical_measurement_v3_real_shadow_gate
from aggregate_gate g;

rollback;
