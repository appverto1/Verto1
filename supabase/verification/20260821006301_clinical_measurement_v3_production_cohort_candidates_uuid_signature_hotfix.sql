-- Clinical Measurement Engine V3 - production cohort candidate selector.
-- Hotfix 06301: force exact readiness RPC signature uuid,uuid,text,text.
-- READ ONLY / FAIL CLOSED.
--
-- Purpose:
--   After the production activation readiness gate is READY, identify a small,
--   bounded list of DTT target cohorts that are technically eligible for an
--   explicit first production pilot. This script DOES NOT choose a cohort,
--   DOES NOT create rollout state, and DOES NOT write clinical data.
--
-- Safety:
--   - requires zero existing allow_new_v3_sessions rollout rows;
--   - prefers likely test/demo records but never auto-selects them;
--   - excludes patients with currently open ABA sessions from READY candidates;
--   - uses the authoritative get_aba_v3_pilot_readiness() function only after
--     bounding the candidate set to at most 20 rows.

begin transaction read only;
set local statement_timeout = '20s';
set local lock_timeout = '3s';

-- Required objects only. Fail before any relation-dependent query.
do $cmv3_candidate_required$
declare
  v_missing text[] := '{}'::text[];
begin
  if to_regclass('public.clinics') is null then v_missing := array_append(v_missing,'public.clinics'); end if;
  if to_regclass('public.patients') is null then v_missing := array_append(v_missing,'public.patients'); end if;
  if to_regclass('public.aba_programs') is null then v_missing := array_append(v_missing,'public.aba_programs'); end if;
  if to_regclass('public.aba_targets') is null then v_missing := array_append(v_missing,'public.aba_targets'); end if;
  if to_regclass('public.aba_trials') is null then v_missing := array_append(v_missing,'public.aba_trials'); end if;
  if to_regclass('public.aba_sessions') is null then v_missing := array_append(v_missing,'public.aba_sessions'); end if;
  if to_regclass('public.aba_measurement_rollout_states_v3') is null then v_missing := array_append(v_missing,'public.aba_measurement_rollout_states_v3'); end if;
  if to_regprocedure('public.get_aba_v3_pilot_readiness(uuid,uuid,text,text)') is null then
    v_missing := array_append(v_missing,'public.get_aba_v3_pilot_readiness(uuid,uuid,text,text)');
  end if;
  if cardinality(v_missing) > 0 then
    raise exception 'CMV3_PRODUCTION_COHORT_SCHEMA_NOT_READY:%', array_to_string(v_missing,', ');
  end if;
end;
$cmv3_candidate_required$;

-- Candidate selection is invalid if someone enabled a rollout after the previous gate.
do $cmv3_candidate_rollout_closed$
begin
  if exists (
    select 1
    from public.aba_measurement_rollout_states_v3
    where allow_new_v3_sessions
  ) then
    raise exception 'CMV3_PRODUCTION_COHORT_SELECTION_REQUIRES_CLOSED_ROLLOUT';
  end if;
end;
$cmv3_candidate_rollout_closed$;

with
trial_activity as (
  select
    trial.target_id,
    count(*)::integer as legacy_trial_count,
    count(*) filter (where trial.created_at >= clock_timestamp() - interval '30 days')::integer as legacy_trial_count_30d,
    max(trial.created_at) as latest_legacy_trial_at
  from public.aba_trials trial
  where trial.target_id is not null
  group by trial.target_id
),
open_sessions as (
  select
    session_row.patient_id,
    count(*)::integer as open_session_count
  from public.aba_sessions session_row
  where lower(coalesce(session_row.status,'')) in ('active','in_progress')
  group by session_row.patient_id
),
base_candidates as (
  select
    target.organization_id,
    target.patient_id,
    target.program_id,
    target.id as target_id,
    clinic.name as clinic_name,
    patient.name as patient_name,
    program.name as program_name,
    target.name as target_name,
    lower(coalesce(target.target_type,'')) as target_type,
    coalesce(activity.legacy_trial_count,0) as legacy_trial_count,
    coalesce(activity.legacy_trial_count_30d,0) as legacy_trial_count_30d,
    activity.latest_legacy_trial_at,
    coalesce(open_session.open_session_count,0) as open_session_count,
    (
      lower(coalesce(patient.name,'')) ~ '(teste|test|demo|homolog|sandbox|canary)'
      or lower(coalesce(clinic.name,'')) ~ '(teste|test|demo|homolog|sandbox|canary)'
    ) as likely_test_record
  from public.aba_targets target
  join public.patients patient
    on patient.id = target.patient_id
   and patient.clinic_id::text = target.organization_id::text
  join public.clinics clinic
    on clinic.id::text = target.organization_id::text
  join public.aba_programs program
    on program.id = target.program_id
   and program.patient_id = target.patient_id
   and program.organization_id::text = target.organization_id::text
  left join trial_activity activity on activity.target_id = target.id
  left join open_sessions open_session on open_session.patient_id = target.patient_id
  where lower(coalesce(target.target_type,'')) = 'dtt'
    and target.program_id is not null
),
bounded as (
  select *
  from base_candidates
  order by
    likely_test_record desc,
    (open_session_count = 0) desc,
    legacy_trial_count_30d desc,
    latest_legacy_trial_at desc nulls last,
    organization_id::text,
    patient_id::text,
    target_id
  limit 20
),
with_readiness as (
  select
    bounded.*,
    public.get_aba_v3_pilot_readiness(
      (bounded.organization_id::text)::uuid,
      (bounded.patient_id::text)::uuid,
      bounded.program_id::text,
      bounded.target_id::text
    ) as readiness
  from bounded
),
evaluated as (
  select
    *,
    coalesce((readiness->>'ready')::boolean,false) as technical_readiness,
    coalesce(jsonb_array_length(coalesce(readiness->'blockers','[]'::jsonb)),0) as blocker_count,
    (
      coalesce((readiness->>'ready')::boolean,false)
      and open_session_count = 0
    ) as eligible_for_manual_selection
  from with_readiness
),
summary as (
  select
    count(*)::integer as candidate_count,
    count(*) filter(where eligible_for_manual_selection)::integer as eligible_count,
    count(*) filter(where eligible_for_manual_selection and likely_test_record)::integer as eligible_likely_test_count,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'organization_id',organization_id,
        'clinic_name',clinic_name,
        'patient_id',patient_id,
        'patient_name',patient_name,
        'program_id',program_id,
        'program_name',program_name,
        'target_id',target_id,
        'target_name',target_name,
        'target_type',target_type,
        'likely_test_record',likely_test_record,
        'open_session_count',open_session_count,
        'legacy_trial_count',legacy_trial_count,
        'legacy_trial_count_30d',legacy_trial_count_30d,
        'latest_legacy_trial_at',latest_legacy_trial_at,
        'technical_readiness',technical_readiness,
        'eligible_for_manual_selection',eligible_for_manual_selection,
        'readiness',readiness
      ) order by
        eligible_for_manual_selection desc,
        likely_test_record desc,
        legacy_trial_count_30d desc,
        latest_legacy_trial_at desc nulls last,
        patient_name,
        target_name
    ),'[]'::jsonb) as candidates
  from evaluated
)
select jsonb_build_object(
  'gate',case
    when candidate_count = 0 then 'BLOCKED_NO_DTT_CANDIDATES'
    when eligible_count = 0 then 'BLOCKED_NO_TECHNICALLY_READY_COHORT'
    else 'READY_FOR_MANUAL_SINGLE_COHORT_SELECTION'
  end,
  'release_stage','PRODUCTION_COHORT_SELECTION',
  'writes',false,
  'auto_selected',false,
  'candidate_count',candidate_count,
  'eligible_count',eligible_count,
  'eligible_likely_test_count',eligible_likely_test_count,
  'selection_policy',jsonb_build_object(
    'first_choice','Prefer a dedicated test/demo patient if one exists.',
    'avoid','Do not use a real paying-client patient for the first production writer canary unless explicitly chosen.',
    'scope','Exactly one CLINIC + PATIENT + TARGET cohort.',
    'open_session_policy','Candidate must have zero active/in_progress ABA sessions before activation.'
  ),
  'candidates',candidates,
  'next_if_ready','Choose exactly one candidate row and run an exact-cohort readiness attestation before any write.',
  'checked_at',clock_timestamp()
) as clinical_measurement_v3_production_cohort_candidates
from summary;

rollback;
