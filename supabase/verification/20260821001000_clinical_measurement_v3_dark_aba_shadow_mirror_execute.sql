-- CONTROLLED STAGING WRITE: mirrors exactly one recent ABA V3 target into the
-- hidden universal engine and atomically aborts if canonical parity is not clean.
-- Run only after migration 20260821001000.

select public.get_clinical_measurement_v3_security_preflight() as security_preflight;

with candidate as (
  select t.organization_id,t.patient_id,t.target_id,
    count(*)::integer effective_trial_count
  from public.aba_effective_trials_v3 t
  join public.aba_sessions s on s.id=t.session_id
  where coalesce(s.reference_date,s.started_at::date) between current_date-90 and current_date
    and s.status='completed' and s.ended_at is not null and t.trial_type<>'TASK_ANALYSIS'
    and exists(select 1 from public.aba_session_target_summaries_v3 ss where ss.organization_id=t.organization_id and ss.patient_id=t.patient_id and ss.target_id=t.target_id and ss.session_id=t.session_id)
  group by t.organization_id,t.patient_id,t.target_id
  having count(distinct t.collection_definition_version_id)=1
     and count(distinct t.target_phase_assignment_id)=1
  order by count(*) desc,t.target_id
  limit 1
)
select public.run_clinical_measurement_v3_aba_shadow_mirror(
  organization_id,patient_id,target_id,current_date-90,current_date
) as clinical_measurement_v3_dark_shadow_mirror_result
from candidate;
