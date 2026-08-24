-- Verto Clinical Measurement Engine V3
-- Hotfix: TASK_ANALYSIS projection recompute must group phase_version_id because
-- clinical_measurement_projection_scope_v3 exposes it via scope.*.
-- Additive/idempotent function replacement only; no raw data or legacy tables are changed.

begin;

create or replace function public.recompute_clinical_measurement_projection_batch_v3(
  p_expectation_ids uuid[],
  p_revision_hint text default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_count integer := 0;
begin
  if coalesce(array_length(p_expectation_ids,1),0) = 0 then return 0; end if;
  if array_length(p_expectation_ids,1) > 250 then raise exception 'CMV3_PROJECTION_BATCH_TOO_LARGE'; end if;

  -- Projection cache is disposable. Clear only the affected expectation grains.
  delete from public.clinical_measurement_session_category_breakdown_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_interval_breakdown_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_prompt_distribution_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_task_step_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_count_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_rate_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_proportion_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_temporal_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_continuous_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_interval_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_ordinal_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_categorical_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_task_analysis_summaries_v3 where expectation_id=any(p_expectation_ids);

  -- COUNT.
  insert into public.clinical_measurement_session_count_summaries_v3
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         coalesce(sum(f.count_delta),0)::bigint,
         count(distinct e.id)::integer,max(e.occurred_at_utc),max(e.recorded_at),clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
  left join public.clinical_measurement_count_facts_v3 f on f.event_id=e.id and f.semantic_family='COUNT'
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='COUNT'
  group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
           scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status;

  -- RATE: zero events + valid slice is a legitimate zero rate.
  insert into public.clinical_measurement_session_rate_summaries_v3
  with agg as (
    select scope.*,
      coalesce((select sum(f.count_delta)::bigint from public.clinical_measurement_effective_primary_events_v3 e
                join public.clinical_measurement_count_facts_v3 f on f.event_id=e.id and f.semantic_family='RATE'
                where e.expectation_id=scope.expectation_id),0) event_count,
      coalesce((select sum(floor(extract(epoch from (s.ended_at-s.started_at))*1000.0))::bigint
                from public.clinical_measurement_effective_primary_events_v3 e
                join public.clinical_measurement_observation_slices_v3 s on s.event_id=e.id
                where e.expectation_id=scope.expectation_id),0) observation_ms,
      (select count(*)::integer from public.clinical_measurement_effective_primary_events_v3 e where e.expectation_id=scope.expectation_id) src_count,
      (select max(e.occurred_at_utc) from public.clinical_measurement_effective_primary_events_v3 e where e.expectation_id=scope.expectation_id) src_occ,
      (select max(e.recorded_at) from public.clinical_measurement_effective_primary_events_v3 e where e.expectation_id=scope.expectation_id) src_rec
    from public.clinical_measurement_projection_scope_v3 scope
    where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='RATE'
  )
  select expectation_id,organization_id,patient_id,session_id,target_id,definition_version_id,phase_epoch_id,
         clinical_date,session_status,public.cmv3_projection_coverage_status(expectation_id,session_status),
         event_count,observation_ms,
         case when observation_ms>0 then (event_count::numeric*3600000::numeric)/observation_ms::numeric else null end,
         src_count,src_occ,src_rec,clock_timestamp()
  from agg;

  -- PROPORTION: ABA trials have fixed server semantics. Generic category-based
  -- proportions are computed only when the version explicitly declares both
  -- numerator_category_keys and denominator_category_keys.
  insert into public.clinical_measurement_session_proportion_summaries_v3
  with aba as (
    select scope.expectation_id,
      count(distinct trial.event_id) filter (where step.opportunity_role='PRIMARY_INDEPENDENT')::integer denominator,
      count(distinct trial.event_id) filter (where step.opportunity_role='PRIMARY_INDEPENDENT' and step.outcome='CORRECT')::integer numerator,
      (count(distinct trial.event_id)
       - count(distinct trial.event_id) filter (where step.opportunity_role='PRIMARY_INDEPENDENT'))::integer no_opp,
      count(distinct trial.event_id)::integer trial_count
    from public.clinical_measurement_projection_scope_v3 scope
    join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
    join public.clinical_measurement_aba_trials_v3 trial on trial.event_id=e.id
    left join public.clinical_measurement_aba_trial_steps_v3 step on step.trial_event_id=trial.event_id
    where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='PROPORTION'
    group by scope.expectation_id
  ), categories as (
    select scope.expectation_id,
      count(*) filter (where f.category_key in (
        select jsonb_array_elements_text(scope.definition_content #> '{proportion,numerator_category_keys}')
      ))::integer numerator,
      count(*) filter (where f.category_key in (
        select jsonb_array_elements_text(scope.definition_content #> '{proportion,denominator_category_keys}')
      ))::integer denominator,
      count(*)::integer category_count,
      (jsonb_typeof(scope.definition_content #> '{proportion,numerator_category_keys}')='array'
       and jsonb_typeof(scope.definition_content #> '{proportion,denominator_category_keys}')='array'
       and (scope.definition_content #> '{proportion,denominator_category_keys}') @> (scope.definition_content #> '{proportion,numerator_category_keys}')) config_ready
    from public.clinical_measurement_projection_scope_v3 scope
    join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
    join public.clinical_measurement_category_facts_v3 f on f.event_id=e.id and f.semantic_family='PROPORTION'
    where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='PROPORTION'
    group by scope.expectation_id,scope.definition_content
  ), source_meta as (
    select scope.expectation_id,count(e.id)::integer src_count,max(e.occurred_at_utc) src_occ,max(e.recorded_at) src_rec
    from public.clinical_measurement_projection_scope_v3 scope
    left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
    where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='PROPORTION'
    group by scope.expectation_id
  )
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         case
           when coalesce(aba.trial_count,0)>0 and coalesce(categories.category_count,0)>0 then 'INVALID_MIXED_SOURCE'
           when coalesce(aba.trial_count,0)>0 or coalesce(categories.config_ready,false) then 'READY'
           else 'SEMANTIC_CONFIG_REQUIRED' end,
         case
           when coalesce(aba.trial_count,0)>0 and coalesce(categories.category_count,0)>0 then 'MIXED'
           when coalesce(aba.trial_count,0)>0 then 'ABA_TRIAL'
           when coalesce(categories.category_count,0)>0 then 'CATEGORY' else 'NONE' end,
         case
           when coalesce(aba.trial_count,0)>0 and coalesce(categories.category_count,0)>0 then null
           when coalesce(aba.trial_count,0)>0 then aba.numerator
           when coalesce(categories.config_ready,false) then categories.numerator else null end,
         case
           when coalesce(aba.trial_count,0)>0 and coalesce(categories.category_count,0)>0 then null
           when coalesce(aba.trial_count,0)>0 then aba.denominator
           when coalesce(categories.config_ready,false) then categories.denominator else null end,
         case
           when coalesce(aba.trial_count,0)>0 and coalesce(categories.category_count,0)>0 then null
           when coalesce(aba.trial_count,0)>0 and aba.denominator>0 then (aba.numerator::numeric*100)/aba.denominator
           when coalesce(aba.trial_count,0)=0 and coalesce(categories.config_ready,false) and categories.denominator>0 then (categories.numerator::numeric*100)/categories.denominator
           else null end,
         coalesce(aba.no_opp,0),meta.src_count,meta.src_occ,meta.src_rec,clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join aba on aba.expectation_id=scope.expectation_id
  left join categories on categories.expectation_id=scope.expectation_id
  join source_meta meta on meta.expectation_id=scope.expectation_id
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='PROPORTION';

  insert into public.clinical_measurement_session_category_breakdown_v3(expectation_id,category_domain,category_key,occurrence_count)
  select e.expectation_id,'PROPORTION',f.category_key,count(*)::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_category_facts_v3 f on f.event_id=e.id and f.semantic_family='PROPORTION'
  where e.expectation_id=any(p_expectation_ids)
  group by e.expectation_id,f.category_key;

  insert into public.clinical_measurement_session_prompt_distribution_v3(expectation_id,source_kind,prompt_level_id,occurrence_count)
  select e.expectation_id,'ABA_TRIAL',step.prompt_level_id,count(*)::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_aba_trials_v3 trial on trial.event_id=e.id
  join public.clinical_measurement_aba_trial_steps_v3 step on step.trial_event_id=trial.event_id
  where e.expectation_id=any(p_expectation_ids) and step.prompt_level_id is not null
  group by e.expectation_id,step.prompt_level_id;

  -- DURATION / LATENCY / IRT remain temporal, never coerced to score.
  insert into public.clinical_measurement_session_temporal_summaries_v3
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.semantic_family,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         count(f.event_id)::integer,count(f.event_id) filter(where f.is_censored)::integer,
         coalesce(sum(f.duration_ms),0)::bigint,avg(f.duration_ms)::numeric,min(f.duration_ms),max(f.duration_ms),
         count(e.id)::integer,max(e.occurred_at_utc),max(e.recorded_at),clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
  left join public.clinical_measurement_interval_facts_v3 f on f.event_id=e.id
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family in ('DURATION','LATENCY','IRT')
  group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
           scope.definition_version_id,scope.phase_epoch_id,scope.semantic_family,scope.clinical_date,scope.session_status;

  -- CONTINUOUS.
  insert into public.clinical_measurement_session_continuous_summaries_v3
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         count(f.event_id)::integer,avg(f.numeric_value),min(f.numeric_value),max(f.numeric_value),
         (array_agg(f.numeric_value order by e.occurred_at_utc desc,e.id desc) filter(where f.event_id is not null))[1],
         count(e.id)::integer,max(e.occurred_at_utc),max(e.recorded_at),clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
  left join public.clinical_measurement_scalar_facts_v3 f on f.event_id=e.id
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='CONTINUOUS'
  group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
           scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status;

  -- INTERVAL + relational response breakdown.
  insert into public.clinical_measurement_session_interval_summaries_v3
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         count(f.event_id)::integer,count(e.id)::integer,max(e.occurred_at_utc),max(e.recorded_at),clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
  left join public.clinical_measurement_interval_samples_v3 f on f.event_id=e.id
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='INTERVAL'
  group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
           scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status;

  insert into public.clinical_measurement_session_interval_breakdown_v3(expectation_id,response_key,occurrence_count)
  select e.expectation_id,f.response_key,count(*)::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_interval_samples_v3 f on f.event_id=e.id
  where e.expectation_id=any(p_expectation_ids)
  group by e.expectation_id,f.response_key;

  -- ORDINAL: order is preserved as category identity; no mean/percent is invented.
  insert into public.clinical_measurement_session_ordinal_summaries_v3
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         count(f.event_id)::integer,
         (array_agg(f.category_key order by e.occurred_at_utc desc,e.id desc) filter(where f.event_id is not null))[1],
         count(e.id)::integer,max(e.occurred_at_utc),max(e.recorded_at),clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
  left join public.clinical_measurement_category_facts_v3 f on f.event_id=e.id and f.semantic_family='ORDINAL'
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='ORDINAL'
  group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
           scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status;

  insert into public.clinical_measurement_session_category_breakdown_v3(expectation_id,category_domain,category_key,occurrence_count)
  select e.expectation_id,'ORDINAL',f.category_key,count(*)::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_category_facts_v3 f on f.event_id=e.id and f.semantic_family='ORDINAL'
  where e.expectation_id=any(p_expectation_ids)
  group by e.expectation_id,f.category_key;

  -- CATEGORICAL.
  insert into public.clinical_measurement_session_categorical_summaries_v3
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         count(f.event_id)::integer,count(e.id)::integer,max(e.occurred_at_utc),max(e.recorded_at),clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
  left join public.clinical_measurement_category_facts_v3 f on f.event_id=e.id and f.semantic_family='CATEGORICAL'
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='CATEGORICAL'
  group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
           scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status;

  insert into public.clinical_measurement_session_category_breakdown_v3(expectation_id,category_domain,category_key,occurrence_count)
  select e.expectation_id,'CATEGORICAL',f.category_key,count(*)::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_category_facts_v3 f on f.event_id=e.id and f.semantic_family='CATEGORICAL'
  where e.expectation_id=any(p_expectation_ids)
  group by e.expectation_id,f.category_key;

  -- TASK ANALYSIS: acquisition and maintenance denominators remain separate.
  insert into public.clinical_measurement_session_task_analysis_summaries_v3
  with agg as (
    select scope.*,
      count(distinct run.event_id)::integer run_count,
      count(result.id) filter(where result.eligibility='ACQUISITION')::integer acq_n,
      count(result.id) filter(where result.eligibility='ACQUISITION' and result.performance_code='INDEPENDENT')::integer acq_i,
      count(result.id) filter(where result.eligibility='MAINTENANCE')::integer maint_n,
      count(result.id) filter(where result.eligibility='MAINTENANCE' and result.performance_code='INDEPENDENT')::integer maint_i,
      count(result.id) filter(where result.eligibility='TRAINER_COMPLETED')::integer trainer_n,
      count(result.id) filter(where result.eligibility='NOT_ELIGIBLE')::integer not_eligible_n,
      count(distinct e.id)::integer src_count,max(e.occurred_at_utc) src_occ,max(e.recorded_at) src_rec
    from public.clinical_measurement_projection_scope_v3 scope
    left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
    left join public.clinical_measurement_aba_task_runs_v3 run on run.event_id=e.id
    left join public.clinical_measurement_aba_task_step_results_v3 result on result.run_event_id=run.event_id
    where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='TASK_ANALYSIS'
    group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
             scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
             scope.protocol_snapshot_id,scope.phase_version_id,scope.semantic_family,scope.unit_code,scope.unit_label,scope.directionality,
             scope.definition_content,scope.aggregation_policy,scope.session_started_at,scope.session_ended_at,
             scope.finalized_at,scope.primary_stream_id
  )
  select expectation_id,organization_id,patient_id,session_id,target_id,definition_version_id,phase_epoch_id,
         clinical_date,session_status,public.cmv3_projection_coverage_status(expectation_id,session_status),
         run_count,acq_n,acq_i,maint_n,maint_i,trainer_n,not_eligible_n,
         case when acq_n>0 then acq_i::numeric*100/acq_n else null end,
         case when maint_n>0 then maint_i::numeric*100/maint_n else null end,
         src_count,src_occ,src_rec,clock_timestamp()
  from agg;

  insert into public.clinical_measurement_session_task_step_summaries_v3(
    expectation_id,step_definition_id,sequence_no,acquisition_observation_count,acquisition_independent_count,
    maintenance_observation_count,maintenance_independent_count,prompted_count,incorrect_count,no_response_count
  )
  select e.expectation_id,result.step_definition_id,result.sequence_no,
         count(*) filter(where result.eligibility='ACQUISITION')::integer,
         count(*) filter(where result.eligibility='ACQUISITION' and result.performance_code='INDEPENDENT')::integer,
         count(*) filter(where result.eligibility='MAINTENANCE')::integer,
         count(*) filter(where result.eligibility='MAINTENANCE' and result.performance_code='INDEPENDENT')::integer,
         count(*) filter(where result.performance_code='PROMPTED')::integer,
         count(*) filter(where result.performance_code='INCORRECT')::integer,
         count(*) filter(where result.performance_code='NO_RESPONSE')::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_aba_task_runs_v3 run on run.event_id=e.id
  join public.clinical_measurement_aba_task_step_results_v3 result on result.run_event_id=run.event_id
  where e.expectation_id=any(p_expectation_ids)
  group by e.expectation_id,result.step_definition_id,result.sequence_no;

  insert into public.clinical_measurement_session_prompt_distribution_v3(expectation_id,source_kind,prompt_level_id,occurrence_count)
  select e.expectation_id,'TASK_ANALYSIS',result.prompt_level_id,count(*)::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_aba_task_runs_v3 run on run.event_id=e.id
  join public.clinical_measurement_aba_task_step_results_v3 result on result.run_event_id=run.event_id
  where e.expectation_id=any(p_expectation_ids) and result.prompt_level_id is not null
  group by e.expectation_id,result.prompt_level_id;

  -- Append a revision only when the semantic projection actually changed.
  with snapshots as (
    select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,scope.semantic_family,
           public.build_clinical_measurement_projection_snapshot_v3(scope.expectation_id) payload,
           (select max(e.recorded_at) from public.clinical_measurement_raw_events_v3 e where e.expectation_id=scope.expectation_id) latest_recorded,
           clock_timestamp() computed_at
    from public.clinical_measurement_projection_scope_v3 scope
    where scope.expectation_id=any(p_expectation_ids)
  ), hashed as (
    select s.*,encode(digest(convert_to(s.payload::text,'UTF8'),'sha256'),'hex') projection_hash
    from snapshots s
  ), changed as (
    select h.*,head.revision_number old_revision,head.projection_hash old_hash,head.source_latest_recorded_at old_source,
      case
        when head.expectation_id is null then 'INITIAL'
        when p_revision_hint='MANUAL_REBUILD' then 'MANUAL_REBUILD'
        when exists (select 1 from public.clinical_measurement_raw_events_v3 e
                     where e.expectation_id=h.expectation_id
                       and e.recorded_at>coalesce(head.source_latest_recorded_at,'-infinity'::timestamptz)
                       and e.event_kind in ('CORRECTION','VOID','SUPERSEDE')) then 'AUDIT_CORRECTION'
        when exists (select 1 from public.clinical_measurement_raw_events_v3 e
                     where e.expectation_id=h.expectation_id
                       and e.recorded_at>coalesce(head.source_latest_recorded_at,'-infinity'::timestamptz)
                       and e.ingestion_mode='OFFLINE_SYNC') then 'LATE_DATA_INCORPORATED'
        when exists (select 1 from public.clinical_measurement_sessions_v3 s2
                     where s2.id=h.session_id and s2.status='FINALIZED'
                       and (head.expectation_id is null or head.computed_at<s2.finalized_at)) then 'SESSION_FINALIZED'
        else 'SOURCE_DATA_CHANGED' end revision_reason
    from hashed h
    left join public.clinical_measurement_session_projection_heads_v3 head on head.expectation_id=h.expectation_id
    where head.expectation_id is null or head.projection_hash is distinct from h.projection_hash
  ), inserted_revisions as (
    insert into public.clinical_measurement_session_projection_revisions_v3(
      expectation_id,organization_id,patient_id,session_id,target_id,semantic_family,revision_number,
      revision_reason,projection_hash,projection_payload,source_latest_recorded_at,computed_at
    )
    select expectation_id,organization_id,patient_id,session_id,target_id,semantic_family,coalesce(old_revision,0)+1,
           revision_reason,projection_hash,payload,latest_recorded,computed_at
    from changed
    returning expectation_id,revision_number,projection_hash,source_latest_recorded_at,computed_at
  )
  insert into public.clinical_measurement_session_projection_heads_v3(
    expectation_id,organization_id,patient_id,session_id,target_id,semantic_family,revision_number,
    projection_hash,source_latest_recorded_at,computed_at,updated_at
  )
  select c.expectation_id,c.organization_id,c.patient_id,c.session_id,c.target_id,c.semantic_family,
         r.revision_number,r.projection_hash,r.source_latest_recorded_at,r.computed_at,clock_timestamp()
  from changed c join inserted_revisions r using(expectation_id)
  on conflict(expectation_id) do update set
    revision_number=excluded.revision_number,
    projection_hash=excluded.projection_hash,
    source_latest_recorded_at=excluded.source_latest_recorded_at,
    computed_at=excluded.computed_at,
    updated_at=excluded.updated_at;

  select count(*) into v_count from unnest(p_expectation_ids) id;
  return v_count;
end;
$function$;

revoke all on function public.recompute_clinical_measurement_projection_batch_v3(uuid[],text) from public,anon,authenticated;
grant execute on function public.recompute_clinical_measurement_projection_batch_v3(uuid[],text) to service_role;

commit;
