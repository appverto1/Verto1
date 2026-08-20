-- Clinical Measurement Engine V3 — exact PRODUCTION DEMO final canary.
-- Scope is intentionally hard-coded to the isolated production DEMO cohort.
--
-- Purpose:
--   1) prove the fresh user-path session persisted as ABA V3 (not Legacy V2),
--   2) prove exactly 3 non-duplicated source trials with the expected semantic shape,
--   3) shadow-mirror those already-completed ABA V3 facts into universal CMV3,
--   4) recompute the universal projection and require canonical ABA V3 parity,
--   5) leave broad rollout untouched.
--
-- Safety:
--   * fail-closed before shadow writes if the exact session/source shape is wrong;
--   * source ABA V3 and Legacy V2 rows are never mutated;
--   * the only writes are service-side SHADOW_MIRROR universal artifacts;
--   * any post-mirror integrity/parity failure aborts the transaction.

begin;

create temporary table cmv3_prod_demo_final_ctx on commit drop as
with scope as (
  select
    '79b1a8f9-ab9d-43dc-b57d-3afca67b553b'::uuid as organization_id,
    'dc739da0-4626-4cf8-a339-30e431283a4a'::uuid as patient_id,
    '4ff72c73-8588-4746-9d19-5ea3c7d4bbf2'::text as program_id,
    'eff9b97f-948d-491e-9b9a-afdef276e2a5'::text as target_id
), candidate_sessions as (
  select
    -- Keep the canary context on the V3 canonical types. aba_sessions.organization_id
    -- is legacy text, while all V3 writer/projection surfaces use uuid.
    sc.organization_id,
    sc.patient_id,
    sc.program_id,
    sc.target_id,
    s.id as session_id,
    s.started_at,
    s.ended_at,
    s.status,
    coalesce(s.reference_date, s.started_at::date) as clinical_date,
    b.id as binding_id,
    b.measurement_model_version,
    b.collection_definition_version_id,
    b.target_phase_assignment_id,
    b.binding_source,
    b.binding_reason,
    b.bound_at,
    b.rollout_state_id,
    b.rollout_state_version
  from scope sc
  join public.aba_sessions s
    on s.clinic_id = sc.organization_id::text
   and s.patient_id = sc.patient_id
  join public.aba_session_target_measurement_bindings b
    on b.organization_id = sc.organization_id
   and b.patient_id = sc.patient_id
   and b.session_id = s.id
   and b.target_id = sc.target_id
   and b.program_id = sc.program_id
  where s.started_at >= '2026-08-20T22:59:27.520162+00:00'::timestamptz
    and b.measurement_model_version = 'V3'
    and lower(coalesce(s.status,'')) = 'completed'
    and s.ended_at is not null
), selected as (
  select *
  from candidate_sessions
  order by started_at desc, session_id desc
  limit 1
), trial_rows as (
  select
    t.id,
    t.session_id,
    t.binding_id,
    t.client_event_id,
    t.payload_hash,
    t.collection_definition_version_id,
    t.target_phase_assignment_id,
    t.received_at,
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
    exists (
      select 1
      from public.aba_trial_revisions_v3 r
      where r.trial_id = t.id
        and r.event_type <> 'ANNOTATE'
    ) as has_effective_revision,
    (
      select count(*)::integer
      from public.aba_trial_steps_v3 st
      where st.trial_id = t.id
    ) as step_count
  from selected sel
  join public.aba_trials_v3 t
    on t.organization_id = sel.organization_id
   and t.patient_id = sel.patient_id
   and t.session_id = sel.session_id
   and t.target_id = sel.target_id
), stats as (
  select
    sc.organization_id,
    sc.patient_id,
    sc.program_id,
    sc.target_id,
    (select count(*)::integer from candidate_sessions) as completed_v3_session_count,
    (select session_id from selected) as session_id,
    (select started_at from selected) as session_started_at,
    (select ended_at from selected) as session_ended_at,
    (select clinical_date from selected) as clinical_date,
    (select binding_id from selected) as binding_id,
    (select measurement_model_version from selected) as measurement_model_version,
    (select binding_source from selected) as binding_source,
    (select binding_reason from selected) as binding_reason,
    (select collection_definition_version_id from selected) as binding_definition_version_id,
    (select target_phase_assignment_id from selected) as binding_phase_assignment_id,
    (select count(*)::integer from trial_rows) as v3_trial_count,
    (select count(distinct client_event_id)::integer from trial_rows) as distinct_client_event_count,
    (select count(distinct payload_hash)::integer from trial_rows) as distinct_payload_hash_count,
    (select count(*)::integer from trial_rows where has_primary) as primary_trial_count,
    (select count(*)::integer from trial_rows where not has_primary) as support_only_trial_count,
    (select count(*)::integer from trial_rows where has_primary and primary_outcome = 'CORRECT') as primary_correct_count,
    (select count(*)::integer from trial_rows where has_primary and primary_outcome is distinct from 'CORRECT') as primary_non_correct_count,
    (select count(*)::integer from trial_rows where has_effective_revision) as effective_revision_count,
    (select count(*)::integer from trial_rows where step_count < 1) as trial_without_step_count,
    (select count(distinct binding_id)::integer from trial_rows) as trial_binding_count,
    (select count(distinct collection_definition_version_id)::integer from trial_rows) as trial_definition_version_count,
    (select count(distinct target_phase_assignment_id)::integer from trial_rows) as trial_phase_assignment_count,
    (
      select count(*)::integer
      from public.aba_trials legacy
      join selected sel on sel.session_id = legacy.session_id
      where legacy.patient_id::text = sc.patient_id::text
        and legacy.clinic_id = sc.organization_id::text
        and legacy.target_id = sc.target_id
    ) as legacy_v2_trial_count,
    (
      select count(*)::integer
      from public.aba_trials_v3 t
      join selected sel
        on coalesce((select s.reference_date from public.aba_sessions s where s.id=t.session_id),
                    (select s.started_at::date from public.aba_sessions s where s.id=t.session_id)) = sel.clinical_date
      where t.organization_id = sc.organization_id
        and t.patient_id = sc.patient_id
        and t.target_id = sc.target_id
    ) as target_day_v3_trial_count,
    (
      select count(*)::integer
      from public.clinical_measurement_shadow_mirror_links_v3 l
      where l.organization_id = sc.organization_id
        and l.patient_id = sc.patient_id
        and l.source_target_id = sc.target_id
    ) as preexisting_shadow_link_count,
    (
      select count(*)::integer
      from public.aba_measurement_rollout_states_v3 r
      where r.allow_new_v3_sessions is true
    ) as enabled_rollout_count,
    (
      select count(*)::integer
      from public.aba_measurement_rollout_states_v3 r
      where r.allow_new_v3_sessions is true
        and not (
          (r.organization_id = sc.organization_id and r.scope_type = 'CLINIC'
            and r.patient_id is null and r.program_id is null and r.target_id is null)
          or
          (r.organization_id = sc.organization_id and r.scope_type = 'PATIENT'
            and r.patient_id = sc.patient_id and r.program_id is null and r.target_id is null)
          or
          (r.organization_id = sc.organization_id and r.scope_type = 'TARGET'
            and r.patient_id = sc.patient_id and r.program_id = sc.program_id and r.target_id = sc.target_id)
        )
    ) as unexpected_enabled_rollout_count,
    (
      select count(*)::integer
      from public.aba_sync_quarantine_v3 q
      where q.organization_id = sc.organization_id
        and q.patient_id = sc.patient_id
        and q.resolved_at is null
    ) as unresolved_sync_quarantine_count,
    public.get_clinical_measurement_v3_security_preflight() as security_preflight
  from scope sc
)
select * from stats;

create temporary table cmv3_prod_demo_final_exec on commit drop as
select
  ctx.*,
  case
    when ctx.session_id is null then jsonb_build_object('gate','BLOCKED_NO_FRESH_COMPLETED_V3_SESSION')
    when ctx.completed_v3_session_count <> 1 then jsonb_build_object('gate','BLOCKED_FRESH_V3_SESSION_COUNT','observed',ctx.completed_v3_session_count,'required',1)
    when ctx.measurement_model_version <> 'V3' then jsonb_build_object('gate','BLOCKED_BINDING_NOT_V3','observed',ctx.measurement_model_version)
    when ctx.binding_source <> 'SERVER_RESOLVER' then jsonb_build_object('gate','BLOCKED_BINDING_SOURCE','observed',ctx.binding_source)
    when ctx.binding_definition_version_id is null or ctx.binding_phase_assignment_id is null then jsonb_build_object('gate','BLOCKED_BINDING_METADATA_INCOMPLETE')
    when coalesce((ctx.security_preflight->>'ok')::boolean,false) = false then jsonb_build_object('gate','BLOCKED_SECURITY_PREFLIGHT','security_preflight',ctx.security_preflight)
    when ctx.unresolved_sync_quarantine_count <> 0 then jsonb_build_object('gate','BLOCKED_SYNC_QUARANTINE','open_count',ctx.unresolved_sync_quarantine_count)
    when ctx.legacy_v2_trial_count <> 0 then jsonb_build_object('gate','BLOCKED_FRESH_SESSION_HAS_LEGACY_V2_WRITES','legacy_v2_trial_count',ctx.legacy_v2_trial_count)
    when ctx.v3_trial_count <> 3 then jsonb_build_object('gate','BLOCKED_CANARY_TRIAL_COUNT','required',3,'observed',ctx.v3_trial_count)
    when ctx.distinct_client_event_count <> ctx.v3_trial_count then jsonb_build_object('gate','BLOCKED_CLIENT_EVENT_DUPLICATION','trials',ctx.v3_trial_count,'distinct_client_events',ctx.distinct_client_event_count)
    when ctx.trial_without_step_count <> 0 then jsonb_build_object('gate','BLOCKED_TRIAL_WITHOUT_STEPS','count',ctx.trial_without_step_count)
    when ctx.effective_revision_count <> 0 then jsonb_build_object('gate','BLOCKED_REVISED_CANARY_FACTS','count',ctx.effective_revision_count)
    when ctx.trial_binding_count <> 1 then jsonb_build_object('gate','BLOCKED_MULTIPLE_TRIAL_BINDINGS','count',ctx.trial_binding_count)
    when ctx.trial_definition_version_count <> 1 then jsonb_build_object('gate','BLOCKED_MULTIPLE_DEFINITION_VERSIONS','count',ctx.trial_definition_version_count)
    when ctx.trial_phase_assignment_count <> 1 then jsonb_build_object('gate','BLOCKED_MULTIPLE_PHASES','count',ctx.trial_phase_assignment_count)
    when ctx.primary_trial_count <> 2 or ctx.support_only_trial_count <> 1 then jsonb_build_object(
      'gate','BLOCKED_CANARY_OPPORTUNITY_COVERAGE',
      'required',jsonb_build_object('primary',2,'support_only',1),
      'observed',jsonb_build_object('primary',ctx.primary_trial_count,'support_only',ctx.support_only_trial_count)
    )
    when ctx.primary_correct_count <> 1 or ctx.primary_non_correct_count <> 1 then jsonb_build_object(
      'gate','BLOCKED_CANARY_OUTCOME_COVERAGE',
      'required',jsonb_build_object('primary_correct',1,'primary_non_correct',1),
      'observed',jsonb_build_object('primary_correct',ctx.primary_correct_count,'primary_non_correct',ctx.primary_non_correct_count)
    )
    when ctx.target_day_v3_trial_count <> ctx.v3_trial_count then jsonb_build_object(
      'gate','BLOCKED_TARGET_DAY_HAS_EXTRA_V3_FACTS',
      'selected_session_trials',ctx.v3_trial_count,
      'target_day_trials',ctx.target_day_v3_trial_count
    )
    when ctx.enabled_rollout_count <> 3 or ctx.unexpected_enabled_rollout_count <> 0 then jsonb_build_object(
      'gate','BLOCKED_ROLLOUT_BLAST_RADIUS',
      'enabled_rollout_count',ctx.enabled_rollout_count,
      'unexpected_enabled_rollout_count',ctx.unexpected_enabled_rollout_count
    )
    when ctx.preexisting_shadow_link_count <> 0 then jsonb_build_object('gate','BLOCKED_PREEXISTING_PRODUCTION_SHADOW','link_count',ctx.preexisting_shadow_link_count)
    else public.run_clinical_measurement_v3_aba_shadow_mirror(
      ctx.organization_id,
      ctx.patient_id,
      ctx.target_id,
      ctx.clinical_date,
      ctx.clinical_date
    )
  end as mirror_result
from cmv3_prod_demo_final_ctx ctx;

create temporary table cmv3_prod_demo_final_post on commit drop as
select
  exec.*,
  (
    select count(*)::integer
    from public.clinical_measurement_shadow_mirror_links_v3 l
    where l.organization_id = exec.organization_id
      and l.patient_id = exec.patient_id
      and l.source_target_id = exec.target_id
      and l.source_session_id = exec.session_id
  ) as mirrored_link_count,
  (
    select count(*)::integer
    from public.clinical_measurement_raw_events_v3 e
    join public.clinical_measurement_sessions_v3 s on s.id = e.session_id
    where e.organization_id = exec.organization_id
      and e.patient_id = exec.patient_id
      and e.ingestion_mode = 'SHADOW_MIRROR'
      and s.aba_session_id = exec.session_id
  ) as universal_shadow_raw_count,
  (
    select count(*)::integer
    from public.clinical_measurement_sessions_v3 s
    where s.organization_id = exec.organization_id
      and s.patient_id = exec.patient_id
      and s.aba_session_id = exec.session_id
      and s.status = 'FINALIZED'
  ) as universal_finalized_session_count,
  (
    select count(*)::integer
    from public.clinical_measurement_projection_queue_v3 q
    where q.organization_id = exec.organization_id
      and q.patient_id = exec.patient_id
      and q.status in ('FAILED','PROCESSING')
  ) as bad_projection_queue_count
from cmv3_prod_demo_final_exec exec;

do $cmv3$
declare
  r record;
  v_gate text;
begin
  select * into r from cmv3_prod_demo_final_post;
  v_gate := coalesce(r.mirror_result->>'gate','');

  if v_gate = 'PASS' then
    if r.mirrored_link_count <> 3 then
      raise exception 'CMV3_PROD_CANARY_MIRROR_LINK_COUNT:%', r.mirrored_link_count;
    end if;
    if r.universal_shadow_raw_count <> 3 then
      raise exception 'CMV3_PROD_CANARY_UNIVERSAL_RAW_COUNT:%', r.universal_shadow_raw_count;
    end if;
    if r.universal_finalized_session_count <> 1 then
      raise exception 'CMV3_PROD_CANARY_UNIVERSAL_SESSION_FINALIZATION:%', r.universal_finalized_session_count;
    end if;
    if r.bad_projection_queue_count <> 0 then
      raise exception 'CMV3_PROD_CANARY_BAD_PROJECTION_QUEUE:%', r.bad_projection_queue_count;
    end if;
    if coalesce((r.mirror_result #>> '{comparison,canonical_comparison,parity_clean}')::boolean,false) is not true
       or coalesce((r.mirror_result #>> '{comparison,canonical_comparison,mismatch_count}')::integer,0) <> 0
       or coalesce((r.mirror_result #>> '{comparison,canonical_comparison,incomplete_count}')::integer,0) <> 0
       or coalesce((r.mirror_result #>> '{comparison,canonical_comparison,compared_session_count}')::integer,0) < 1 then
      raise exception 'CMV3_PROD_CANARY_PARITY_NOT_CLEAN:%', left((r.mirror_result->'comparison')::text,3000);
    end if;
  end if;
end;
$cmv3$;

select jsonb_build_object(
  'gate', case when mirror_result->>'gate' = 'PASS' then 'PASS' else mirror_result->>'gate' end,
  'release_stage','PRODUCTION_DEMO_END_TO_END_FINAL_CANARY',
  'scope',jsonb_build_object(
    'organization_id',organization_id,
    'patient_id',patient_id,
    'program_id',program_id,
    'target_id',target_id,
    'session_id',session_id,
    'clinical_date',clinical_date
  ),
  'source_persistence',jsonb_build_object(
    'binding_model',measurement_model_version,
    'binding_source',binding_source,
    'binding_reason',binding_reason,
    'v3_trial_count',v3_trial_count,
    'legacy_v2_trial_count',legacy_v2_trial_count,
    'distinct_client_event_count',distinct_client_event_count,
    'distinct_payload_hash_count',distinct_payload_hash_count,
    'effective_revision_count',effective_revision_count,
    'primary_trial_count',primary_trial_count,
    'support_only_trial_count',support_only_trial_count,
    'primary_correct_count',primary_correct_count,
    'primary_non_correct_count',primary_non_correct_count
  ),
  'universal_shadow',jsonb_build_object(
    'mirrored_link_count',mirrored_link_count,
    'raw_event_count',universal_shadow_raw_count,
    'finalized_session_count',universal_finalized_session_count,
    'bad_projection_queue_count',bad_projection_queue_count
  ),
  'mirror_result',mirror_result,
  'security_preflight',security_preflight,
  'writer_policy',jsonb_build_object(
    'source_aba_v3_mutated',false,
    'legacy_v2_mutated',false,
    'broad_rollout_mutated',false,
    'universal_write_mode','SHADOW_MIRROR_SERVICE_SIDE_ONLY'
  ),
  'next_if_pass','DISABLE_NEW_V3_SESSIONS_FOR_DEMO_COHORT_AND_VERIFY_DRAIN_BEFORE DECLARING CONTROLLED_ROLLOUT READY'
) as clinical_measurement_v3_production_demo_final_canary
from cmv3_prod_demo_final_post;

commit;
