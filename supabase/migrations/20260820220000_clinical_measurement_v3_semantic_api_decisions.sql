-- Verto Clinical Measurement Engine V3 - Migration G
-- Semantic decision/evidence state foundation. Additive/dark only.

begin;

create unique index if not exists ux_cmv3_phase_epoch_scope_id
  on public.clinical_measurement_phase_epochs_v3(id, organization_id, patient_id, target_id);

create table if not exists public.clinical_measurement_criterion_epochs_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  criterion_key text not null,
  criterion_type text not null check (criterion_type in ('MASTERY','MAINTENANCE','GENERALIZATION','CUSTOM')),
  rule jsonb not null check (jsonb_typeof(rule)='object'),
  rule_hash text not null default repeat('0',64) check (rule_hash ~ '^[0-9a-f]{64}$'),
  effective_from timestamptz not null,
  effective_until timestamptz,
  recorded_at timestamptz not null default now(),
  supersedes_criterion_epoch_id uuid,
  superseded_at timestamptz,
  created_by text,
  constraint cmv3_criterion_epoch_window check (effective_until is null or effective_until > effective_from),
  constraint cmv3_criterion_epoch_key_nonempty check (length(trim(criterion_key)) between 1 and 180),
  foreign key (target_id, organization_id, patient_id)
    references public.clinical_measurement_targets_v3(id, organization_id, patient_id) on delete restrict,
  foreign key (definition_version_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_definition_versions_v3(id, organization_id, patient_id, target_id) on delete restrict,
  foreign key (phase_epoch_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_phase_epochs_v3(id, organization_id, patient_id, target_id) on delete restrict,
  unique (id, organization_id, patient_id, target_id),
  foreign key (supersedes_criterion_epoch_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_criterion_epochs_v3(id, organization_id, patient_id, target_id) on delete restrict
);

create index if not exists idx_cmv3_criterion_epochs_target
  on public.clinical_measurement_criterion_epochs_v3(organization_id,patient_id,target_id,effective_from desc,recorded_at desc);

do $cmv3_criterion_overlap$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.clinical_measurement_criterion_epochs_v3'::regclass and conname='cmv3_criterion_epoch_no_overlap') then
    alter table public.clinical_measurement_criterion_epochs_v3 add constraint cmv3_criterion_epoch_no_overlap
      exclude using gist (organization_id with =, target_id with =, criterion_key with =,
        tstzrange(effective_from,coalesce(effective_until,'infinity'::timestamptz),'[)') with &&)
      where (superseded_at is null);
  end if;
end;$cmv3_criterion_overlap$;

create table if not exists public.clinical_measurement_evidence_revisions_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  criterion_epoch_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  evidence_support_state text not null check (evidence_support_state in ('NOT_EVALUATED','INSUFFICIENT','SUFFICIENT','CHANGED_SINCE_DECISION','INVALIDATED')),
  evaluation_status text not null check (evaluation_status in ('NOT_EVALUATED','CRITERION_NOT_MET','CRITERION_MET','INDETERMINATE')),
  evaluation jsonb not null default '{}'::jsonb check (jsonb_typeof(evaluation)='object'),
  evidence_hash text not null default repeat('0',64) check (evidence_hash ~ '^[0-9a-f]{64}$'),
  projection_watermark timestamptz,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (criterion_epoch_id, revision_number),
  unique (id, organization_id, patient_id, target_id),
  foreign key (criterion_epoch_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_criterion_epochs_v3(id, organization_id, patient_id, target_id) on delete restrict,
  foreign key (target_id, organization_id, patient_id)
    references public.clinical_measurement_targets_v3(id, organization_id, patient_id) on delete restrict
);

create index if not exists idx_cmv3_evidence_revisions_latest
  on public.clinical_measurement_evidence_revisions_v3(organization_id,patient_id,target_id,criterion_epoch_id,revision_number desc);

create table if not exists public.clinical_measurement_clinical_decision_events_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  decision_type text not null check (decision_type in ('CLINICIAN_CONFIRMED_MASTERY','CLINICIAN_REVOKED_MASTERY','CLINICIAN_CONFIRMED_MAINTENANCE','CLINICIAN_REOPENED_ACQUISITION')),
  evidence_revision_id uuid,
  actor_membership_id uuid not null references public.clinic_memberships(id) on delete restrict,
  reason text,
  decided_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  supersedes_decision_event_id uuid,
  unique (id, organization_id, patient_id, target_id),
  foreign key (supersedes_decision_event_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_clinical_decision_events_v3(id, organization_id, patient_id, target_id) on delete restrict,
  foreign key (target_id, organization_id, patient_id)
    references public.clinical_measurement_targets_v3(id, organization_id, patient_id) on delete restrict,
  foreign key (evidence_revision_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_evidence_revisions_v3(id, organization_id, patient_id, target_id) on delete restrict
);

create index if not exists idx_cmv3_decisions_target
  on public.clinical_measurement_clinical_decision_events_v3(organization_id,patient_id,target_id,decided_at desc,recorded_at desc);


create or replace function public.prepare_clinical_measurement_criterion_epoch_v3()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,extensions set row_security=off as $function$
begin
  new.recorded_at := clock_timestamp();
  new.rule_hash := encode(digest(convert_to(new.rule::text,'UTF8'),'sha256'),'hex');
  return new;
end;$function$;
drop trigger if exists cmv3_prepare_criterion_epoch on public.clinical_measurement_criterion_epochs_v3;
create trigger cmv3_prepare_criterion_epoch before insert on public.clinical_measurement_criterion_epochs_v3
for each row execute function public.prepare_clinical_measurement_criterion_epoch_v3();

create or replace function public.prepare_clinical_measurement_evidence_revision_v3()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,extensions set row_security=off as $function$
begin
  new.evaluated_at := clock_timestamp(); new.created_at := new.evaluated_at;
  new.evidence_hash := encode(digest(convert_to(jsonb_build_object(
    'criterion_epoch_id',new.criterion_epoch_id,'revision_number',new.revision_number,
    'support',new.evidence_support_state,'status',new.evaluation_status,
    'evaluation',new.evaluation
  )::text,'UTF8'),'sha256'),'hex');
  return new;
end;$function$;
drop trigger if exists cmv3_prepare_evidence_revision on public.clinical_measurement_evidence_revisions_v3;
create trigger cmv3_prepare_evidence_revision before insert on public.clinical_measurement_evidence_revisions_v3
for each row execute function public.prepare_clinical_measurement_evidence_revision_v3();

create or replace function public.validate_clinical_measurement_decision_actor_v3()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public set row_security=off as $function$
declare v_ok boolean;
begin
  select exists(select 1 from public.clinic_memberships m where m.id=new.actor_membership_id and m.clinic_id=new.organization_id and lower(coalesce(m.status,''))='active') into v_ok;
  if not v_ok then raise exception 'CMV3_DECISION_ACTOR_SCOPE_INVALID'; end if;
  new.recorded_at := clock_timestamp();
  return new;
end;$function$;
drop trigger if exists cmv3_validate_decision_actor on public.clinical_measurement_clinical_decision_events_v3;
create trigger cmv3_validate_decision_actor before insert on public.clinical_measurement_clinical_decision_events_v3
for each row execute function public.validate_clinical_measurement_decision_actor_v3();

create table if not exists public.clinical_measurement_target_states_v3 (
  target_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  clinical_state text not null default 'ACTIVE' check (clinical_state in ('ACTIVE','MASTERED','MAINTENANCE','REOPENED_ACQUISITION')),
  evidence_support_state text not null default 'NOT_EVALUATED' check (evidence_support_state in ('NOT_EVALUATED','INSUFFICIENT','SUFFICIENT','CHANGED_SINCE_DECISION','INVALIDATED')),
  workflow_attention_state text not null default 'NONE' check (workflow_attention_state in ('NONE','REVIEW_REQUIRED')),
  latest_decision_event_id uuid,
  latest_evidence_revision_id uuid,
  updated_at timestamptz not null default now(),
  foreign key (target_id, organization_id, patient_id)
    references public.clinical_measurement_targets_v3(id, organization_id, patient_id) on delete cascade,
  foreign key (latest_decision_event_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_clinical_decision_events_v3(id, organization_id, patient_id, target_id) on delete restrict,
  foreign key (latest_evidence_revision_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_evidence_revisions_v3(id, organization_id, patient_id, target_id) on delete restrict
);


create or replace function public.evaluate_clinical_measurement_criterion_v3(p_criterion_epoch_id uuid)
returns public.clinical_measurement_evidence_revisions_v3
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
set row_security=off
as $function$
declare
  c public.clinical_measurement_criterion_epochs_v3;
  d public.clinical_measurement_definitions_v3;
  v_size integer;
  v_min_den integer;
  v_operator text;
  v_threshold numeric;
  v_points jsonb := '[]'::jsonb;
  v_eligible integer := 0;
  v_passing integer := 0;
  v_eval_status text := 'INDETERMINATE';
  v_support text := 'INSUFFICIENT';
  v_evaluation jsonb;
  v_watermark timestamptz;
  v_latest public.clinical_measurement_evidence_revisions_v3;
  v_result public.clinical_measurement_evidence_revisions_v3;
begin
  select * into strict c from public.clinical_measurement_criterion_epochs_v3 where id=p_criterion_epoch_id for update;
  select def.* into strict d from public.clinical_measurement_definition_versions_v3 ver
    join public.clinical_measurement_definitions_v3 def on def.id=ver.definition_id
    where ver.id=c.definition_version_id and def.target_id=c.target_id;
  v_size := greatest(1,least(100,coalesce((c.rule#>>'{window,size}')::integer,1)));
  v_min_den := greatest(0,coalesce((c.rule->>'minimum_denominator_per_point')::integer,0));
  v_operator := upper(coalesce(c.rule->>'operator',''));
  v_threshold := nullif(c.rule->>'threshold','')::numeric;
  if v_operator not in ('GREATER_THAN_OR_EQUAL','GREATER_THAN','LESS_THAN_OR_EQUAL','LESS_THAN','EQUAL') or v_threshold is null then
    raise exception 'CMV3_CRITERION_RULE_UNSUPPORTED';
  end if;
  if upper(coalesce(c.rule#>>'{window,unit}','SESSION')) <> 'SESSION'
     or coalesce((c.rule#>>'{window,consecutive}')::boolean,true) is not true then
    raise exception 'CMV3_CRITERION_WINDOW_UNSUPPORTED';
  end if;
  if (d.semantic_family in ('PROPORTION','TASK_ANALYSIS') and upper(coalesce(c.rule->>'threshold_unit','')) <> 'PERCENT')
     or (d.semantic_family='RATE' and upper(coalesce(c.rule->>'threshold_unit','')) <> 'EVENTS_PER_HOUR')
     or (d.semantic_family='COUNT' and upper(coalesce(c.rule->>'threshold_unit','')) <> 'COUNT')
     or (d.semantic_family in ('DURATION','LATENCY','IRT') and upper(coalesce(c.rule->>'threshold_unit','')) <> 'MILLISECOND')
     or (d.semantic_family='CONTINUOUS' and nullif(c.rule->>'threshold_unit','') is null) then
    raise exception 'CMV3_CRITERION_THRESHOLD_UNIT_REQUIRED';
  end if;

  if d.semantic_family='CONTINUOUS' and upper(c.rule->>'threshold_unit') is distinct from upper(coalesce((select unit_code from public.clinical_measurement_definition_versions_v3 where id=c.definition_version_id),'')) then
    raise exception 'CMV3_CRITERION_THRESHOLD_UNIT_MISMATCH';
  end if;

  if d.semantic_family='PROPORTION' then
    select coalesce(jsonb_agg(x.point order by x.rn),'[]'::jsonb),count(*) filter(where x.eligible),count(*) filter(where x.eligible and x.passing),max(x.recorded_at)
    into v_points,v_eligible,v_passing,v_watermark from (
      select row_number() over(order by s.clinical_date desc,s.session_id desc) rn,
        (s.coverage_status='OBSERVED' and s.denominator is not null and s.denominator>=v_min_den and s.percent_value is not null) eligible,
        case v_operator when 'GREATER_THAN_OR_EQUAL' then s.percent_value>=v_threshold when 'GREATER_THAN' then s.percent_value>v_threshold when 'LESS_THAN_OR_EQUAL' then s.percent_value<=v_threshold when 'LESS_THAN' then s.percent_value<v_threshold else s.percent_value=v_threshold end passing,
        s.source_latest_recorded_at recorded_at,
        jsonb_build_object('session_id',s.session_id,'clinical_date',s.clinical_date,'value',s.percent_value,'numerator',s.numerator,'denominator',s.denominator) point
      from public.clinical_measurement_session_proportion_summaries_v3 s
      where s.organization_id=c.organization_id and s.patient_id=c.patient_id and s.target_id=c.target_id and s.definition_version_id=c.definition_version_id
        and s.clinical_date>=c.effective_from::date and (c.effective_until is null or s.clinical_date<c.effective_until::date)
      order by s.clinical_date desc,s.session_id desc limit v_size
    ) x;
  elsif d.semantic_family='RATE' then
    select coalesce(jsonb_agg(x.point order by x.rn),'[]'::jsonb),count(*) filter(where x.eligible),count(*) filter(where x.eligible and x.passing),max(x.recorded_at)
    into v_points,v_eligible,v_passing,v_watermark from (
      select row_number() over(order by s.clinical_date desc,s.session_id desc) rn,(s.coverage_status='OBSERVED' and s.rate_per_hour is not null) eligible,
        case v_operator when 'GREATER_THAN_OR_EQUAL' then s.rate_per_hour>=v_threshold when 'GREATER_THAN' then s.rate_per_hour>v_threshold when 'LESS_THAN_OR_EQUAL' then s.rate_per_hour<=v_threshold when 'LESS_THAN' then s.rate_per_hour<v_threshold else s.rate_per_hour=v_threshold end passing,
        s.source_latest_recorded_at recorded_at,jsonb_build_object('session_id',s.session_id,'clinical_date',s.clinical_date,'value',s.rate_per_hour,'event_count',s.event_count,'observation_duration_ms',s.observation_duration_ms) point
      from public.clinical_measurement_session_rate_summaries_v3 s where s.organization_id=c.organization_id and s.patient_id=c.patient_id and s.target_id=c.target_id and s.definition_version_id=c.definition_version_id
        and s.clinical_date>=c.effective_from::date and (c.effective_until is null or s.clinical_date<c.effective_until::date)
      order by s.clinical_date desc,s.session_id desc limit v_size
    ) x;
  elsif d.semantic_family='COUNT' then
    select coalesce(jsonb_agg(x.point order by x.rn),'[]'::jsonb),count(*) filter(where x.eligible),count(*) filter(where x.eligible and x.passing),max(x.recorded_at)
    into v_points,v_eligible,v_passing,v_watermark from (
      select row_number() over(order by s.clinical_date desc,s.session_id desc) rn,(s.coverage_status='OBSERVED') eligible,
        (s.coverage_status='OBSERVED') and case v_operator when 'GREATER_THAN_OR_EQUAL' then s.total_count>=v_threshold when 'GREATER_THAN' then s.total_count>v_threshold when 'LESS_THAN_OR_EQUAL' then s.total_count<=v_threshold when 'LESS_THAN' then s.total_count<v_threshold else s.total_count=v_threshold end passing,
        s.source_latest_recorded_at recorded_at,jsonb_build_object('session_id',s.session_id,'clinical_date',s.clinical_date,'value',s.total_count) point
      from public.clinical_measurement_session_count_summaries_v3 s where s.organization_id=c.organization_id and s.patient_id=c.patient_id and s.target_id=c.target_id and s.definition_version_id=c.definition_version_id
        and s.clinical_date>=c.effective_from::date and (c.effective_until is null or s.clinical_date<c.effective_until::date)
      order by s.clinical_date desc,s.session_id desc limit v_size
    ) x;
  elsif d.semantic_family in ('DURATION','LATENCY','IRT') then
    select coalesce(jsonb_agg(x.point order by x.rn),'[]'::jsonb),count(*) filter(where x.eligible),count(*) filter(where x.eligible and x.passing),max(x.recorded_at)
    into v_points,v_eligible,v_passing,v_watermark from (
      select row_number() over(order by s.clinical_date desc,s.session_id desc) rn,(s.coverage_status='OBSERVED' and s.mean_duration_ms is not null) eligible,
        case v_operator when 'GREATER_THAN_OR_EQUAL' then s.mean_duration_ms>=v_threshold when 'GREATER_THAN' then s.mean_duration_ms>v_threshold when 'LESS_THAN_OR_EQUAL' then s.mean_duration_ms<=v_threshold when 'LESS_THAN' then s.mean_duration_ms<v_threshold else s.mean_duration_ms=v_threshold end passing,
        s.source_latest_recorded_at recorded_at,jsonb_build_object('session_id',s.session_id,'clinical_date',s.clinical_date,'value',s.mean_duration_ms,'unit','MILLISECOND') point
      from public.clinical_measurement_session_temporal_summaries_v3 s where s.organization_id=c.organization_id and s.patient_id=c.patient_id and s.target_id=c.target_id and s.definition_version_id=c.definition_version_id and s.semantic_family=d.semantic_family
        and s.clinical_date>=c.effective_from::date and (c.effective_until is null or s.clinical_date<c.effective_until::date)
      order by s.clinical_date desc,s.session_id desc limit v_size
    ) x;
  elsif d.semantic_family='CONTINUOUS' then
    select coalesce(jsonb_agg(x.point order by x.rn),'[]'::jsonb),count(*) filter(where x.eligible),count(*) filter(where x.eligible and x.passing),max(x.recorded_at)
    into v_points,v_eligible,v_passing,v_watermark from (
      select row_number() over(order by s.clinical_date desc,s.session_id desc) rn,(s.coverage_status='OBSERVED' and s.latest_value is not null) eligible,
        case v_operator when 'GREATER_THAN_OR_EQUAL' then s.latest_value>=v_threshold when 'GREATER_THAN' then s.latest_value>v_threshold when 'LESS_THAN_OR_EQUAL' then s.latest_value<=v_threshold when 'LESS_THAN' then s.latest_value<v_threshold else s.latest_value=v_threshold end passing,
        s.source_latest_recorded_at recorded_at,jsonb_build_object('session_id',s.session_id,'clinical_date',s.clinical_date,'value',s.latest_value) point
      from public.clinical_measurement_session_continuous_summaries_v3 s where s.organization_id=c.organization_id and s.patient_id=c.patient_id and s.target_id=c.target_id and s.definition_version_id=c.definition_version_id
        and s.clinical_date>=c.effective_from::date and (c.effective_until is null or s.clinical_date<c.effective_until::date)
      order by s.clinical_date desc,s.session_id desc limit v_size
    ) x;
  elsif d.semantic_family='TASK_ANALYSIS' then
    select coalesce(jsonb_agg(x.point order by x.rn),'[]'::jsonb),count(*) filter(where x.eligible),count(*) filter(where x.eligible and x.passing),max(x.recorded_at)
    into v_points,v_eligible,v_passing,v_watermark from (
      select row_number() over(order by s.clinical_date desc,s.session_id desc) rn,(s.coverage_status='OBSERVED' and s.acquisition_eligible_count>=v_min_den and s.acquisition_independence_percent is not null) eligible,
        case v_operator when 'GREATER_THAN_OR_EQUAL' then s.acquisition_independence_percent>=v_threshold when 'GREATER_THAN' then s.acquisition_independence_percent>v_threshold when 'LESS_THAN_OR_EQUAL' then s.acquisition_independence_percent<=v_threshold when 'LESS_THAN' then s.acquisition_independence_percent<v_threshold else s.acquisition_independence_percent=v_threshold end passing,
        s.source_latest_recorded_at recorded_at,jsonb_build_object('session_id',s.session_id,'clinical_date',s.clinical_date,'value',s.acquisition_independence_percent,'eligible_steps',s.acquisition_eligible_count) point
      from public.clinical_measurement_session_task_analysis_summaries_v3 s where s.organization_id=c.organization_id and s.patient_id=c.patient_id and s.target_id=c.target_id and s.definition_version_id=c.definition_version_id
        and s.clinical_date>=c.effective_from::date and (c.effective_until is null or s.clinical_date<c.effective_until::date)
      order by s.clinical_date desc,s.session_id desc limit v_size
    ) x;
  else
    v_eval_status := 'INDETERMINATE'; v_support := 'INSUFFICIENT';
  end if;

  if d.semantic_family in ('PROPORTION','RATE','COUNT','DURATION','LATENCY','IRT','CONTINUOUS','TASK_ANALYSIS') then
    if v_eligible < v_size then v_eval_status:='INDETERMINATE'; v_support:='INSUFFICIENT';
    elsif v_passing=v_size then v_eval_status:='CRITERION_MET'; v_support:='SUFFICIENT';
    else v_eval_status:='CRITERION_NOT_MET'; v_support:='INSUFFICIENT'; end if;
  end if;
  v_evaluation := jsonb_build_object('eligible_points',v_eligible,'required_points',v_size,'passing_points',v_passing,'points',v_points,'rule',c.rule);
  select * into v_latest from public.clinical_measurement_evidence_revisions_v3 e where e.criterion_epoch_id=c.id order by e.revision_number desc limit 1;
  if v_latest.id is not null and v_latest.evidence_support_state=v_support and v_latest.evaluation_status=v_eval_status and v_latest.evaluation=v_evaluation then return v_latest; end if;
  insert into public.clinical_measurement_evidence_revisions_v3(organization_id,patient_id,target_id,criterion_epoch_id,revision_number,evidence_support_state,evaluation_status,evaluation,projection_watermark)
  values(c.organization_id,c.patient_id,c.target_id,c.id,coalesce(v_latest.revision_number,0)+1,v_support,v_eval_status,v_evaluation,v_watermark)
  returning * into v_result;
  return v_result;
end;$function$;

create or replace function public.refresh_clinical_measurement_target_state_v3(p_target_id uuid)
returns public.clinical_measurement_target_states_v3
language plpgsql
security definer
set search_path=pg_catalog,public
set row_security=off
as $function$
declare
  v_target public.clinical_measurement_targets_v3;
  v_decision public.clinical_measurement_clinical_decision_events_v3;
  v_evidence public.clinical_measurement_evidence_revisions_v3;
  v_clinical text := 'ACTIVE';
  v_evidence_state text := 'NOT_EVALUATED';
  v_workflow text := 'NONE';
  v_result public.clinical_measurement_target_states_v3;
begin
  select * into strict v_target from public.clinical_measurement_targets_v3 where id=p_target_id;
  select * into v_decision from public.clinical_measurement_clinical_decision_events_v3 d
    where d.target_id=p_target_id order by d.decided_at desc,d.recorded_at desc,d.id desc limit 1;
  if v_decision.id is not null and v_decision.evidence_revision_id is not null then
    select current_e.* into v_evidence
    from public.clinical_measurement_evidence_revisions_v3 decided_e
    join public.clinical_measurement_evidence_revisions_v3 current_e
      on current_e.criterion_epoch_id=decided_e.criterion_epoch_id
    where decided_e.id=v_decision.evidence_revision_id and current_e.target_id=p_target_id
    order by current_e.revision_number desc,current_e.evaluated_at desc,current_e.id desc limit 1;
  else
    select * into v_evidence from public.clinical_measurement_evidence_revisions_v3 e
      where e.target_id=p_target_id order by e.evaluated_at desc,e.revision_number desc,e.id desc limit 1;
  end if;

  if v_decision.id is not null then
    v_clinical := case v_decision.decision_type
      when 'CLINICIAN_CONFIRMED_MASTERY' then 'MASTERED'
      when 'CLINICIAN_REVOKED_MASTERY' then 'ACTIVE'
      when 'CLINICIAN_CONFIRMED_MAINTENANCE' then 'MAINTENANCE'
      when 'CLINICIAN_REOPENED_ACQUISITION' then 'REOPENED_ACQUISITION'
      else 'ACTIVE' end;
  end if;
  if v_evidence.id is not null then v_evidence_state := v_evidence.evidence_support_state; end if;
  if v_decision.id is not null and v_evidence.id is not null
     and (v_decision.evidence_revision_id is distinct from v_evidence.id)
     and v_evidence.evidence_support_state in ('INSUFFICIENT','CHANGED_SINCE_DECISION','INVALIDATED') then
    v_workflow := 'REVIEW_REQUIRED';
  end if;

  insert into public.clinical_measurement_target_states_v3(
    target_id,organization_id,patient_id,clinical_state,evidence_support_state,workflow_attention_state,
    latest_decision_event_id,latest_evidence_revision_id,updated_at)
  values (v_target.id,v_target.organization_id,v_target.patient_id,v_clinical,v_evidence_state,v_workflow,
    v_decision.id,v_evidence.id,clock_timestamp())
  on conflict (target_id) do update set
    clinical_state=excluded.clinical_state,
    evidence_support_state=excluded.evidence_support_state,
    workflow_attention_state=excluded.workflow_attention_state,
    latest_decision_event_id=excluded.latest_decision_event_id,
    latest_evidence_revision_id=excluded.latest_evidence_revision_id,
    updated_at=excluded.updated_at
  returning * into v_result;
  return v_result;
end;
$function$;


create or replace function public.cmv3_refresh_target_state_after_append()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public set row_security=off as $function$
begin
  perform public.refresh_clinical_measurement_target_state_v3(new.target_id);
  return new;
end;$function$;
drop trigger if exists cmv3_refresh_state_after_evidence on public.clinical_measurement_evidence_revisions_v3;
create trigger cmv3_refresh_state_after_evidence after insert on public.clinical_measurement_evidence_revisions_v3
for each row execute function public.cmv3_refresh_target_state_after_append();
drop trigger if exists cmv3_refresh_state_after_decision on public.clinical_measurement_clinical_decision_events_v3;
create trigger cmv3_refresh_state_after_decision after insert on public.clinical_measurement_clinical_decision_events_v3
for each row execute function public.cmv3_refresh_target_state_after_append();

create or replace function public.cmv3_criterion_epoch_mutation_guard()
returns trigger language plpgsql as $function$
begin
  if tg_op='DELETE' then raise exception 'CMV3_CRITERION_EPOCH_DELETE_FORBIDDEN'; end if;
  if (to_jsonb(new)-'superseded_at') is distinct from (to_jsonb(old)-'superseded_at') then
    raise exception 'CMV3_CRITERION_EPOCH_IMMUTABLE';
  end if;
  if new.superseded_at is not null and new.superseded_at < old.recorded_at then raise exception 'CMV3_CRITERION_SUPERSEDED_TIME_INVALID'; end if;
  return new;
end;$function$;
drop trigger if exists cmv3_criterion_epoch_mutation_guard on public.clinical_measurement_criterion_epochs_v3;
create trigger cmv3_criterion_epoch_mutation_guard before update or delete on public.clinical_measurement_criterion_epochs_v3
for each row execute function public.cmv3_criterion_epoch_mutation_guard();

create or replace function public.cmv3_append_only_guard()
returns trigger language plpgsql as $function$
begin
  raise exception 'CMV3_APPEND_ONLY_ENTITY';
end;$function$;

do $guards$
declare t text;
begin
  foreach t in array array['clinical_measurement_evidence_revisions_v3','clinical_measurement_clinical_decision_events_v3'] loop
    execute format('drop trigger if exists cmv3_append_only_guard on public.%I',t);
    execute format('create trigger cmv3_append_only_guard before update or delete on public.%I for each row execute function public.cmv3_append_only_guard()',t);
  end loop;
end;$guards$;

-- Browser remains closed. Server/service role is the only path during dark rollout.
do $rls$
declare t text;
begin
  foreach t in array array[
    'clinical_measurement_criterion_epochs_v3','clinical_measurement_evidence_revisions_v3',
    'clinical_measurement_clinical_decision_events_v3','clinical_measurement_target_states_v3'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
  end loop;
end;$rls$;

revoke all on function public.evaluate_clinical_measurement_criterion_v3(uuid) from public, anon, authenticated;
grant execute on function public.evaluate_clinical_measurement_criterion_v3(uuid) to service_role;
revoke all on function public.refresh_clinical_measurement_target_state_v3(uuid) from public, anon, authenticated;
grant execute on function public.refresh_clinical_measurement_target_state_v3(uuid) to service_role;

commit;
