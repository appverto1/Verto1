-- ABA clinical recommendation identity v3.
-- Additive and idempotent. Rebuilds semantic identity server-side, reconciles legacy duplicates,
-- preserves terminal history, and exposes transactional generation/decision RPCs.

begin;

create extension if not exists pgcrypto with schema extensions;

alter table public.aba_clinical_recommendations
  add column if not exists suggestion_key text,
  add column if not exists suggestion_key_version smallint not null default 3,
  add column if not exists suggestion_key_v3 text,
  add column if not exists canonical_recommendation_id text,
  add column if not exists merged_recommendation_ids text[] not null default '{}'::text[],
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_reason text,
  add column if not exists decision_event_id text,
  add column if not exists terminal_conflict boolean not null default false,
  add column if not exists conflict_reason text,
  add column if not exists conflict_detected_at timestamptz;

alter table public.aba_clinical_recommendations
  alter column suggestion_key_version set default 3;

alter table public.aba_clinical_recommendation_audit_logs
  add column if not exists idempotency_key text,
  add column if not exists payload_hash text;

alter table public.aba_clinical_recommendations
  drop constraint if exists aba_clinical_recommendations_status_check;

alter table public.aba_clinical_recommendations
  add constraint aba_clinical_recommendations_status_check
  check (
    status in (
      'SUGGESTED',
      'ACCEPTED',
      'EDITED',
      'REJECTED',
      'APPLIED_TO_NEXT_SESSION',
      'EXPIRED',
      'SUPERSEDED'
    )
  ) not valid;

alter table public.aba_clinical_recommendations
  validate constraint aba_clinical_recommendations_status_check;

alter table public.aba_clinical_recommendation_audit_logs
  drop constraint if exists aba_clinical_recommendation_audit_logs_action_check;

alter table public.aba_clinical_recommendation_audit_logs
  add constraint aba_clinical_recommendation_audit_logs_action_check
  check (
    action in (
      'GENERATED',
      'ACCEPTED',
      'EDITED',
      'REJECTED',
      'APPLIED_TO_NEXT_SESSION',
      'EXPIRED',
      'TERMINAL_CONFLICT_DETECTED'
    )
  ) not valid;

alter table public.aba_clinical_recommendation_audit_logs
  validate constraint aba_clinical_recommendation_audit_logs_action_check;

create table if not exists public.aba_clinical_recommendation_occurrences (
  id text primary key,
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  recommendation_id text not null references public.aba_clinical_recommendations(id) on delete restrict,
  occurrence_key text not null,
  source_session_id text,
  context_hash text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, patient_id, recommendation_id, occurrence_key)
);

create or replace function public.aba_recommendation_sha256(p_value text)
returns text
language sql
immutable
strict
set search_path = public, extensions
as $$
  select encode(extensions.digest(p_value, 'sha256'::text), 'hex');
$$;

create or replace function public.aba_recommendation_normalize_key_part(
  p_value text,
  p_fallback text default ''
)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(
    nullif(
      lower(
        regexp_replace(
          btrim(normalize(coalesce(p_value, ''))),
          '\s+',
          ' ',
          'g'
        )
      ),
      ''
    ),
    p_fallback
  );
$$;

create or replace function public.aba_recommendation_reason_code_v3(
  p_recommendation_type text,
  p_metric_name text,
  p_evidence jsonb
)
returns text
language sql
immutable
set search_path = public
as $$
  select case upper(coalesce(p_recommendation_type, ''))
    when 'REGRESSION_ATTENTION' then 'unresolved_regression_alert'
    when 'MAINTENANCE_PROBE' then 'maintenance_probe_due'
    else public.aba_recommendation_normalize_key_part(
      coalesce(
        p_evidence ->> 'reasonCodeV3',
        p_evidence ->> 'reason_code_v3',
        p_evidence ->> 'reasonCode',
        p_evidence ->> 'reason_code',
        p_evidence ->> 'ruleCode',
        p_evidence ->> 'rule_code',
        p_metric_name,
        p_recommendation_type
      ),
      'reason-missing'
    )
  end;
$$;

create or replace function public.aba_recommendation_cycle_key_v3(
  p_recommendation_type text,
  p_evidence jsonb
)
returns text
language sql
immutable
set search_path = public
as $$
  select case upper(coalesce(p_recommendation_type, ''))
    when 'REGRESSION_ATTENTION' then public.aba_recommendation_normalize_key_part(
      coalesce(
        p_evidence ->> 'clinicalCycleKeyV3',
        p_evidence ->> 'clinical_cycle_key_v3',
        'active'
      ),
      'active'
    )
    when 'MAINTENANCE_PROBE' then public.aba_recommendation_normalize_key_part(
      coalesce(
        p_evidence ->> 'clinicalCycleKeyV3',
        p_evidence ->> 'clinical_cycle_key_v3',
        'active'
      ),
      'active'
    )
    else public.aba_recommendation_normalize_key_part(
      coalesce(
        p_evidence ->> 'clinicalCycleKeyV3',
        p_evidence ->> 'clinical_cycle_key_v3',
        p_evidence ->> 'clinicalWindowKey',
        p_evidence ->> 'clinical_window_key',
        'active'
      ),
      'active'
    )
  end;
$$;

create or replace function public.aba_recommendation_semantic_material_v3(
  p_organization_id text,
  p_patient_id uuid,
  p_recommendation_type text,
  p_target_id text,
  p_skill_id text,
  p_program_id text,
  p_behavior_id text,
  p_metric_name text,
  p_evidence jsonb
)
returns text
language sql
immutable
set search_path = public
as $$
  select concat_ws(
    '|',
    public.aba_recommendation_normalize_key_part(p_organization_id, 'organization-missing'),
    public.aba_recommendation_normalize_key_part(p_patient_id::text, 'patient-missing'),
    public.aba_recommendation_normalize_key_part(p_recommendation_type, 'type-missing'),
    public.aba_recommendation_normalize_key_part(
      coalesce(nullif(btrim(p_target_id), ''), nullif(btrim(p_skill_id), '')),
      'target-none'
    ),
    public.aba_recommendation_normalize_key_part(
      case
        when nullif(btrim(coalesce(p_skill_id, '')), '') is not null
         and public.aba_recommendation_normalize_key_part(p_skill_id, '')
             <> public.aba_recommendation_normalize_key_part(
               coalesce(nullif(btrim(p_target_id), ''), nullif(btrim(p_skill_id), '')),
               ''
             )
          then p_skill_id
        else null
      end,
      'skill-none'
    ),
    public.aba_recommendation_normalize_key_part(p_program_id, 'program-none'),
    public.aba_recommendation_normalize_key_part(p_behavior_id, 'behavior-none'),
    public.aba_recommendation_reason_code_v3(p_recommendation_type, p_metric_name, coalesce(p_evidence, '{}'::jsonb)),
    public.aba_recommendation_cycle_key_v3(p_recommendation_type, coalesce(p_evidence, '{}'::jsonb)),
    public.aba_recommendation_normalize_key_part(
      coalesce(
        p_evidence ->> 'configurationKeyV3',
        p_evidence ->> 'configuration_key_v3',
        p_evidence ->> 'ruleVersion',
        p_evidence ->> 'rule_version'
      ),
      'config-default'
    )
  );
$$;

create or replace function public.aba_recommendation_semantic_material_v3(
  p_row public.aba_clinical_recommendations
)
returns text
language sql
stable
set search_path = public
as $$
  select public.aba_recommendation_semantic_material_v3(
    p_row.organization_id,
    p_row.patient_id,
    p_row.recommendation_type,
    p_row.target_id,
    coalesce(p_row.evidence ->> 'skillId', p_row.evidence ->> 'skill_id'),
    p_row.program_id,
    p_row.behavior_id,
    p_row.metric_name,
    p_row.evidence
  );
$$;

create or replace function public.aba_merge_recommendation_evidence_v3(
  p_existing jsonb,
  p_incoming jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_result jsonb := coalesce(p_existing, '{}'::jsonb) || coalesce(p_incoming, '{}'::jsonb);
  v_key text;
  v_values jsonb;
begin
  foreach v_key in array array[
    'origins',
    'sourceSessionIds',
    'source_session_ids',
    'relatedSourceIds',
    'related_source_ids',
    'occurrenceIds',
    'occurrence_ids'
  ] loop
    if jsonb_typeof(coalesce(p_existing, '{}'::jsonb) -> v_key) = 'array'
       or jsonb_typeof(coalesce(p_incoming, '{}'::jsonb) -> v_key) = 'array' then
      select coalesce(jsonb_agg(value order by value::text), '[]'::jsonb)
      into v_values
      from (
        select distinct value
        from (
          select value
          from jsonb_array_elements(
            case
              when jsonb_typeof(coalesce(p_existing, '{}'::jsonb) -> v_key) = 'array'
                then p_existing -> v_key
              else '[]'::jsonb
            end
          )
          union all
          select value
          from jsonb_array_elements(
            case
              when jsonb_typeof(coalesce(p_incoming, '{}'::jsonb) -> v_key) = 'array'
                then p_incoming -> v_key
              else '[]'::jsonb
            end
          )
        ) combined
        order by value::text
        limit 100
      ) bounded;
      v_result := jsonb_set(v_result, array[v_key], v_values, true);
    end if;
  end loop;

  return v_result;
end;
$$;

update public.aba_clinical_recommendations recommendation
set
  suggestion_key_v3 = public.aba_recommendation_sha256(
    public.aba_recommendation_semantic_material_v3(recommendation)
  ),
  suggestion_key_version = 3
where recommendation.suggestion_key_v3 is distinct from public.aba_recommendation_sha256(
  public.aba_recommendation_semantic_material_v3(recommendation)
)
   or recommendation.suggestion_key_version <> 3;

create temporary table tmp_aba_recommendation_v3_groups
on commit drop
as
with group_stats as (
  select
    recommendation.organization_id,
    recommendation.patient_id,
    recommendation.suggestion_key_v3,
    bool_or(recommendation.status in ('ACCEPTED', 'APPLIED_TO_NEXT_SESSION')) as has_positive_terminal,
    bool_or(recommendation.status = 'REJECTED') as has_rejected_terminal,
    array_agg(recommendation.id order by recommendation.id) as grouped_ids
  from public.aba_clinical_recommendations recommendation
  where recommendation.suggestion_key_v3 is not null
  group by recommendation.organization_id, recommendation.patient_id, recommendation.suggestion_key_v3
),
ranked as (
  select
    recommendation.organization_id,
    recommendation.patient_id,
    recommendation.suggestion_key_v3,
    recommendation.id,
    stats.grouped_ids,
    stats.has_positive_terminal and stats.has_rejected_terminal as terminal_conflict,
    row_number() over (
      partition by recommendation.organization_id, recommendation.patient_id, recommendation.suggestion_key_v3
      order by
        case
          when stats.has_positive_terminal and stats.has_rejected_terminal then
            case when recommendation.status in ('ACCEPTED', 'APPLIED_TO_NEXT_SESSION', 'REJECTED') then 0 else 1 end
          else
            case recommendation.status
              when 'APPLIED_TO_NEXT_SESSION' then 0
              when 'ACCEPTED' then 1
              when 'REJECTED' then 1
              when 'EDITED' then 2
              when 'SUGGESTED' then 3
              when 'EXPIRED' then 4
              when 'SUPERSEDED' then 5
              else 6
            end
        end,
        case when stats.has_positive_terminal and stats.has_rejected_terminal then recommendation.id end asc,
        case when not (stats.has_positive_terminal and stats.has_rejected_terminal) then recommendation.updated_at end desc nulls last,
        recommendation.created_at desc nulls last,
        recommendation.id
    ) as position
  from public.aba_clinical_recommendations recommendation
  join group_stats stats
    on stats.organization_id = recommendation.organization_id
   and stats.patient_id = recommendation.patient_id
   and stats.suggestion_key_v3 = recommendation.suggestion_key_v3
)
select
  organization_id,
  patient_id,
  suggestion_key_v3,
  id as canonical_id,
  grouped_ids,
  terminal_conflict
from ranked
where position = 1;

update public.aba_clinical_recommendations recommendation
set
  canonical_recommendation_id = case
    when recommendation.id = grouped.canonical_id then null
    else grouped.canonical_id
  end,
  merged_recommendation_ids = case
    when recommendation.id = grouped.canonical_id then grouped.grouped_ids
    else recommendation.merged_recommendation_ids
  end,
  status = case
    when recommendation.id <> grouped.canonical_id
     and recommendation.status in ('SUGGESTED', 'EDITED')
      then 'SUPERSEDED'
    else recommendation.status
  end,
  resolved_at = case
    when recommendation.id <> grouped.canonical_id
     and recommendation.status in ('SUGGESTED', 'EDITED', 'SUPERSEDED')
      then coalesce(recommendation.resolved_at, now())
    else recommendation.resolved_at
  end,
  resolution_reason = case
    when recommendation.id <> grouped.canonical_id
     and recommendation.status in ('SUGGESTED', 'EDITED', 'SUPERSEDED')
      then coalesce(
        recommendation.resolution_reason,
        case
          when grouped.terminal_conflict then 'CONTRADICTORY_TERMINAL_DECISIONS'
          else 'V3_SEMANTIC_RECONCILIATION'
        end
      )
    else recommendation.resolution_reason
  end,
  terminal_conflict = grouped.terminal_conflict,
  conflict_reason = case
    when grouped.terminal_conflict then 'CONTRADICTORY_TERMINAL_DECISIONS'
    else null
  end,
  conflict_detected_at = case
    when grouped.terminal_conflict then coalesce(recommendation.conflict_detected_at, now())
    else null
  end,
  suggestion_key_version = 3,
  updated_at = case
    when recommendation.id <> grouped.canonical_id
     and recommendation.status in ('SUGGESTED', 'EDITED')
      then now()
    else recommendation.updated_at
  end
from tmp_aba_recommendation_v3_groups grouped
where recommendation.organization_id = grouped.organization_id
  and recommendation.patient_id = grouped.patient_id
  and recommendation.suggestion_key_v3 = grouped.suggestion_key_v3;

insert into public.aba_clinical_recommendation_occurrences (
  id,
  organization_id,
  clinic_id,
  patient_id,
  recommendation_id,
  occurrence_key,
  source_session_id,
  context_hash,
  evidence,
  created_at
)
select
  'occ-v3-' || public.aba_recommendation_sha256(
    recommendation.organization_id || '|' || recommendation.patient_id::text || '|' || grouped.canonical_id || '|legacy|' || recommendation.id
  ),
  recommendation.organization_id,
  recommendation.clinic_id,
  recommendation.patient_id,
  grouped.canonical_id,
  public.aba_recommendation_sha256('legacy-v3|' || recommendation.id),
  recommendation.source_session_id,
  recommendation.context_hash,
  jsonb_build_object(
    'legacyRecommendationId', recommendation.id,
    'legacySuggestionKey', recommendation.suggestion_key,
    'suggestionKeyV3', recommendation.suggestion_key_v3,
    'legacyEvidence', recommendation.evidence
  ),
  coalesce(recommendation.created_at, now())
from public.aba_clinical_recommendations recommendation
join tmp_aba_recommendation_v3_groups grouped
  on grouped.organization_id = recommendation.organization_id
 and grouped.patient_id = recommendation.patient_id
 and grouped.suggestion_key_v3 = recommendation.suggestion_key_v3
on conflict (organization_id, patient_id, recommendation_id, occurrence_key)
do nothing;

insert into public.aba_clinical_recommendation_audit_logs (
  id,
  organization_id,
  clinic_id,
  patient_id,
  recommendation_id,
  action,
  previous_status,
  new_status,
  performed_by,
  performed_at,
  metadata,
  idempotency_key,
  payload_hash
)
select
  'audit-v3-conflict-' || public.aba_recommendation_sha256(
    grouped.organization_id || '|' || grouped.patient_id::text || '|' || grouped.suggestion_key_v3
  ),
  grouped.organization_id,
  canonical.clinic_id,
  grouped.patient_id,
  grouped.canonical_id,
  'TERMINAL_CONFLICT_DETECTED',
  canonical.status,
  canonical.status,
  'system:v3-migration',
  now(),
  jsonb_build_object(
    'suggestionKeyV3', grouped.suggestion_key_v3,
    'groupedRecommendationIds', to_jsonb(grouped.grouped_ids),
    'reason', 'CONTRADICTORY_TERMINAL_DECISIONS',
    'automaticClinicalDecision', false
  ),
  'v3-terminal-conflict:' || grouped.suggestion_key_v3,
  public.aba_recommendation_sha256('TERMINAL_CONFLICT_DETECTED|' || grouped.suggestion_key_v3)
from tmp_aba_recommendation_v3_groups grouped
join public.aba_clinical_recommendations canonical
  on canonical.id = grouped.canonical_id
where grouped.terminal_conflict
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.aba_clinical_recommendations'::regclass
      and conname = 'aba_clinical_recommendations_canonical_fkey'
  ) then
    alter table public.aba_clinical_recommendations
      add constraint aba_clinical_recommendations_canonical_fkey
      foreign key (canonical_recommendation_id)
      references public.aba_clinical_recommendations(id)
      on delete restrict;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.aba_clinical_recommendations'::regclass
      and conname = 'aba_clinical_recommendations_decision_event_fkey'
  ) then
    alter table public.aba_clinical_recommendations
      add constraint aba_clinical_recommendations_decision_event_fkey
      foreign key (decision_event_id)
      references public.aba_clinical_recommendation_audit_logs(id)
      on delete restrict
      deferrable initially deferred;
  end if;
end;
$$;

create unique index if not exists uq_aba_recommendation_canonical_semantic_key_v3
  on public.aba_clinical_recommendations (
    organization_id,
    patient_id,
    suggestion_key_v3
  )
  where suggestion_key_v3 is not null
    and canonical_recommendation_id is null;

create index if not exists idx_aba_recommendation_canonical_queue_v3
  on public.aba_clinical_recommendations (
    organization_id,
    patient_id,
    status,
    created_at desc
  )
  where canonical_recommendation_id is null
    and status <> 'SUPERSEDED';

create index if not exists idx_aba_recommendation_legacy_group_v3
  on public.aba_clinical_recommendations (
    organization_id,
    patient_id,
    suggestion_key_v3,
    canonical_recommendation_id
  );

create index if not exists idx_aba_recommendation_terminal_conflict_v3
  on public.aba_clinical_recommendations (
    organization_id,
    patient_id,
    terminal_conflict,
    created_at desc
  )
  where terminal_conflict;

create index if not exists idx_aba_recommendation_occurrences_lookup
  on public.aba_clinical_recommendation_occurrences (
    organization_id,
    patient_id,
    recommendation_id,
    created_at desc
  );

create unique index if not exists uq_aba_recommendation_audit_idempotency
  on public.aba_clinical_recommendation_audit_logs (
    organization_id,
    patient_id,
    recommendation_id,
    idempotency_key
  )
  where idempotency_key is not null;

create or replace function public.aba_assert_recommendation_actor_scope_v3(
  p_clinic_id text,
  p_patient_id uuid,
  p_actor_id text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient_clinic_id text;
  v_actor_role text;
  v_actor_clinic_id text;
  v_owner_user_id text;
  v_has_active_membership boolean := false;
  v_has_coordinator_membership boolean := false;
begin
  if nullif(btrim(p_clinic_id), '') is null
     or p_patient_id is null
     or nullif(btrim(p_actor_id), '') is null then
    raise exception 'ABA_RECOMMENDATION_SCOPE_REQUIRED'
      using errcode = '22023';
  end if;

  select patient.clinic_id::text
  into v_patient_clinic_id
  from public.patients patient
  where patient.id = p_patient_id
    and coalesce(patient.is_active, true) = true
    and patient.deleted_at is null;

  if v_patient_clinic_id is null or v_patient_clinic_id <> p_clinic_id then
    raise exception 'ABA_RECOMMENDATION_PATIENT_SCOPE_INVALID'
      using errcode = '42501';
  end if;

  select clinic.owner_user_id::text
  into v_owner_user_id
  from public.clinics clinic
  where clinic.id::text = p_clinic_id;

  if not found then
    raise exception 'ABA_RECOMMENDATION_CLINIC_SCOPE_INVALID'
      using errcode = '42501';
  end if;

  select actor.role, actor.clinic_id::text
  into v_actor_role, v_actor_clinic_id
  from public.users actor
  where actor.id::text = p_actor_id;

  select
    exists (
      select 1
      from public.clinic_memberships membership
      where membership.user_id::text = p_actor_id
        and membership.clinic_id::text = p_clinic_id
        and membership.status = 'active'
    ),
    exists (
      select 1
      from public.clinic_memberships membership
      where membership.user_id::text = p_actor_id
        and membership.clinic_id::text = p_clinic_id
        and membership.status = 'active'
        and membership.role = 'coordinator'
    )
  into v_has_active_membership, v_has_coordinator_membership;

  if v_actor_role is null
     or not (
       (
         v_actor_role in ('owner', 'admin')
         and (
           v_actor_clinic_id = p_clinic_id
           or v_owner_user_id = p_actor_id
           or v_has_active_membership
         )
       )
       or (
         v_actor_role = 'coordinator'
         and (v_actor_clinic_id = p_clinic_id or v_has_coordinator_membership)
       )
     ) then
    raise exception 'ABA_RECOMMENDATION_ACTOR_FORBIDDEN'
      using errcode = '42501';
  end if;

  return p_clinic_id;
end;
$$;

create or replace function public.upsert_aba_clinical_recommendations_v3(
  p_clinic_id text,
  p_patient_id uuid,
  p_actor_id text,
  p_recommendations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_organization_id text;
  v_item jsonb;
  v_evidence jsonb;
  v_material text;
  v_suggestion_key_v3 text;
  v_recommendation_id text;
  v_occurrence_material text;
  v_occurrence_key text;
  v_occurrence_id text;
  v_occurrence_inserted integer;
  v_audit_id text;
  v_audit_key text;
  v_target_id text;
  v_skill_id text;
  v_program_id text;
  v_behavior_id text;
  v_recommendation_type text;
  v_metric_name text;
  v_result jsonb := '[]'::jsonb;
  v_recommendation public.aba_clinical_recommendations%rowtype;
begin
  v_organization_id := public.aba_assert_recommendation_actor_scope_v3(
    p_clinic_id,
    p_patient_id,
    p_actor_id
  );

  if p_recommendations is null
     or jsonb_typeof(p_recommendations) <> 'array'
     or jsonb_array_length(p_recommendations) > 100 then
    raise exception 'ABA_RECOMMENDATION_GENERATION_PAYLOAD_INVALID'
      using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_recommendations)
  loop
    if nullif(v_item ->> 'organization_id', '') is not null
       and v_item ->> 'organization_id' <> v_organization_id then
      raise exception 'ABA_RECOMMENDATION_TENANT_PAYLOAD_MISMATCH'
        using errcode = '42501';
    end if;

    if nullif(v_item ->> 'patient_id', '') is not null
       and v_item ->> 'patient_id' <> p_patient_id::text then
      raise exception 'ABA_RECOMMENDATION_PATIENT_PAYLOAD_MISMATCH'
        using errcode = '42501';
    end if;

    v_evidence := coalesce(v_item -> 'evidence', '{}'::jsonb);
    v_recommendation_type := upper(nullif(btrim(v_item ->> 'recommendation_type'), ''));
    v_target_id := nullif(btrim(v_item ->> 'target_id'), '');
    v_skill_id := nullif(btrim(coalesce(v_evidence ->> 'skillId', v_evidence ->> 'skill_id')), '');
    v_program_id := nullif(btrim(v_item ->> 'program_id'), '');
    v_behavior_id := nullif(btrim(v_item ->> 'behavior_id'), '');
    v_metric_name := nullif(btrim(v_item ->> 'metric_name'), '');

    if v_recommendation_type is null then
      raise exception 'ABA_RECOMMENDATION_TYPE_REQUIRED'
        using errcode = '22023';
    end if;

    if v_recommendation_type in ('REGRESSION_ATTENTION', 'MAINTENANCE_PROBE')
       and v_target_id is null
       and v_skill_id is null then
      raise exception 'ABA_RECOMMENDATION_TARGET_REQUIRED'
        using errcode = '22023';
    end if;

    if v_target_id is not null and not exists (
      select 1
      from public.aba_targets target
      where target.id = v_target_id
        and target.patient_id = p_patient_id
        and target.organization_id = v_organization_id
    ) then
      raise exception 'ABA_RECOMMENDATION_TARGET_SCOPE_INVALID'
        using errcode = '42501';
    end if;

    if v_skill_id is not null and not exists (
      select 1
      from public.aba_targets target
      where target.id = v_skill_id
        and target.patient_id = p_patient_id
        and target.organization_id = v_organization_id
    ) then
      raise exception 'ABA_RECOMMENDATION_SKILL_SCOPE_INVALID'
        using errcode = '42501';
    end if;

    if v_program_id is not null and not exists (
      select 1
      from public.aba_programs program
      where program.id = v_program_id
        and program.patient_id = p_patient_id
        and program.organization_id = v_organization_id
    ) then
      raise exception 'ABA_RECOMMENDATION_PROGRAM_SCOPE_INVALID'
        using errcode = '42501';
    end if;

    if v_behavior_id is not null and not exists (
      select 1
      from public.aba_behavior_definitions behavior
      where behavior.id = v_behavior_id
        and behavior.patient_id = p_patient_id
        and behavior.organization_id = v_organization_id
    ) then
      raise exception 'ABA_RECOMMENDATION_BEHAVIOR_SCOPE_INVALID'
        using errcode = '42501';
    end if;

    v_material := public.aba_recommendation_semantic_material_v3(
      v_organization_id,
      p_patient_id,
      v_recommendation_type,
      v_target_id,
      v_skill_id,
      v_program_id,
      v_behavior_id,
      v_metric_name,
      v_evidence
    );
    v_suggestion_key_v3 := public.aba_recommendation_sha256(v_material);
    v_recommendation_id := 'rec-v3-' || public.aba_recommendation_sha256(
      v_organization_id || '|' || p_patient_id::text || '|' || v_suggestion_key_v3
    );

    insert into public.aba_clinical_recommendations (
      id,
      organization_id,
      clinic_id,
      patient_id,
      source_session_id,
      next_session_focus_id,
      recommendation_type,
      priority,
      title,
      summary,
      rationale,
      suggested_action,
      target_id,
      behavior_id,
      program_id,
      domain,
      metric_name,
      previous_value,
      current_value,
      delta_value,
      evidence,
      status,
      context_hash,
      suggestion_key,
      suggestion_key_v3,
      suggestion_key_version,
      merged_recommendation_ids,
      created_at,
      updated_at
    )
    values (
      v_recommendation_id,
      v_organization_id,
      p_clinic_id,
      p_patient_id,
      nullif(v_item ->> 'source_session_id', ''),
      nullif(v_item ->> 'next_session_focus_id', ''),
      v_recommendation_type,
      v_item ->> 'priority',
      v_item ->> 'title',
      coalesce(v_item ->> 'summary', ''),
      coalesce(v_item ->> 'rationale', ''),
      v_item ->> 'suggested_action',
      v_target_id,
      v_behavior_id,
      v_program_id,
      nullif(v_item ->> 'domain', ''),
      v_metric_name,
      nullif(v_item ->> 'previous_value', '')::numeric,
      nullif(v_item ->> 'current_value', '')::numeric,
      nullif(v_item ->> 'delta_value', '')::numeric,
      v_evidence || jsonb_build_object(
        'suggestionKeyV3', v_suggestion_key_v3,
        'semanticMaterialVersion', 3,
        'clientSuggestionKeyDiagnostic', nullif(v_evidence ->> 'suggestionKey', '')
      ),
      'SUGGESTED',
      coalesce(nullif(v_item ->> 'context_hash', ''), 'v3'),
      v_suggestion_key_v3,
      v_suggestion_key_v3,
      3,
      array[v_recommendation_id],
      coalesce(nullif(v_item ->> 'created_at', '')::timestamptz, now()),
      now()
    )
    on conflict (organization_id, patient_id, suggestion_key_v3)
      where suggestion_key_v3 is not null and canonical_recommendation_id is null
    do update set
      evidence = case
        when public.aba_clinical_recommendations.status = 'SUGGESTED'
         and not public.aba_clinical_recommendations.terminal_conflict
          then public.aba_merge_recommendation_evidence_v3(
            public.aba_clinical_recommendations.evidence,
            excluded.evidence
          )
        else public.aba_clinical_recommendations.evidence
      end,
      merged_recommendation_ids = (
        select array_agg(distinct grouped_id order by grouped_id)
        from unnest(
          coalesce(public.aba_clinical_recommendations.merged_recommendation_ids, '{}'::text[])
          || array[public.aba_clinical_recommendations.id]
        ) grouped_id
      ),
      suggestion_key_version = 3,
      updated_at = case
        when public.aba_clinical_recommendations.status = 'SUGGESTED'
         and not public.aba_clinical_recommendations.terminal_conflict
          then now()
        else public.aba_clinical_recommendations.updated_at
      end
    returning * into v_recommendation;

    v_occurrence_material := concat_ws(
      '|',
      v_suggestion_key_v3,
      coalesce(v_item ->> 'source_session_id', ''),
      coalesce(v_item ->> 'context_hash', ''),
      coalesce(v_evidence ->> 'alertId', v_evidence ->> 'alert_id', ''),
      coalesce(v_evidence ->> 'scheduleId', v_evidence ->> 'schedule_id', ''),
      coalesce(v_evidence ->> 'probeResultId', v_evidence ->> 'probe_result_id', '')
    );
    v_occurrence_key := public.aba_recommendation_sha256(v_occurrence_material);
    v_occurrence_id := 'occ-v3-' || public.aba_recommendation_sha256(
      v_organization_id || '|' || p_patient_id::text || '|' || v_recommendation.id || '|' || v_occurrence_key
    );

    insert into public.aba_clinical_recommendation_occurrences (
      id,
      organization_id,
      clinic_id,
      patient_id,
      recommendation_id,
      occurrence_key,
      source_session_id,
      context_hash,
      evidence,
      created_at
    )
    values (
      v_occurrence_id,
      v_organization_id,
      p_clinic_id,
      p_patient_id,
      v_recommendation.id,
      v_occurrence_key,
      nullif(v_item ->> 'source_session_id', ''),
      nullif(v_item ->> 'context_hash', ''),
      v_evidence,
      now()
    )
    on conflict (organization_id, patient_id, recommendation_id, occurrence_key)
    do nothing;

    get diagnostics v_occurrence_inserted = row_count;

    if v_occurrence_inserted = 1 then
      v_audit_key := 'generation-v3:' || v_occurrence_key;
      v_audit_id := 'audit-v3-' || public.aba_recommendation_sha256(
        v_organization_id || '|' || p_patient_id::text || '|' || v_recommendation.id || '|GENERATED|' || v_audit_key
      );

      insert into public.aba_clinical_recommendation_audit_logs (
        id,
        organization_id,
        clinic_id,
        patient_id,
        recommendation_id,
        action,
        previous_status,
        new_status,
        performed_by,
        performed_at,
        metadata,
        idempotency_key,
        payload_hash
      )
      values (
        v_audit_id,
        v_organization_id,
        p_clinic_id,
        p_patient_id,
        v_recommendation.id,
        'GENERATED',
        null,
        v_recommendation.status,
        p_actor_id,
        now(),
        jsonb_build_object(
          'contextHash', v_item ->> 'context_hash',
          'occurrenceId', v_occurrence_id,
          'suggestionKeyV3', v_suggestion_key_v3,
          'summaryDriven', true
        ),
        v_audit_key,
        public.aba_recommendation_sha256('GENERATED|' || v_occurrence_material)
      )
      on conflict (id) do nothing;
    end if;

    v_result := v_result || jsonb_build_array(to_jsonb(v_recommendation));
  end loop;

  return jsonb_build_object(
    'success', true,
    'recommendations', v_result
  );
end;
$$;

create or replace function public.apply_aba_clinical_recommendation_decision_v3(
  p_clinic_id text,
  p_patient_id uuid,
  p_recommendation_id text,
  p_action_type text,
  p_idempotency_key text,
  p_payload jsonb,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_organization_id text;
  v_requested public.aba_clinical_recommendations%rowtype;
  v_recommendation public.aba_clinical_recommendations%rowtype;
  v_existing_audit public.aba_clinical_recommendation_audit_logs%rowtype;
  v_action text := upper(btrim(coalesce(p_action_type, '')));
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_payload_hash text;
  v_event_id text;
  v_now timestamptz := now();
  v_previous jsonb;
  v_plan_item public.aba_next_session_plan_items%rowtype;
  v_plan_item_json jsonb := null;
  v_grouped_ids text[];
  v_result jsonb;
  v_new_recommendation_type text;
  v_new_target_id text;
  v_new_behavior_id text;
  v_new_program_id text;
  v_new_metric_name text;
  v_new_material text;
  v_new_suggestion_key_v3 text;
begin
  v_organization_id := public.aba_assert_recommendation_actor_scope_v3(
    p_clinic_id,
    p_patient_id,
    p_actor_id
  );

  if nullif(btrim(p_recommendation_id), '') is null
     or nullif(btrim(p_idempotency_key), '') is null
     or length(p_idempotency_key) > 180 then
    raise exception 'ABA_RECOMMENDATION_DECISION_INPUT_INVALID'
      using errcode = '22023';
  end if;

  if v_action not in ('ACCEPTED', 'REJECTED', 'EDITED', 'APPLIED_TO_NEXT_SESSION') then
    raise exception 'ABA_RECOMMENDATION_ACTION_INVALID'
      using errcode = '22023';
  end if;

  select recommendation.*
  into v_requested
  from public.aba_clinical_recommendations recommendation
  where recommendation.id = p_recommendation_id
    and recommendation.organization_id = v_organization_id
    and recommendation.patient_id = p_patient_id
    and recommendation.clinic_id = p_clinic_id;

  if not found then
    raise exception 'ABA_RECOMMENDATION_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  perform 1
  from public.aba_clinical_recommendations recommendation
  where recommendation.organization_id = v_organization_id
    and recommendation.patient_id = p_patient_id
    and recommendation.suggestion_key_v3 = v_requested.suggestion_key_v3
  order by recommendation.id
  for update;

  select recommendation.*
  into v_recommendation
  from public.aba_clinical_recommendations recommendation
  where recommendation.organization_id = v_organization_id
    and recommendation.patient_id = p_patient_id
    and recommendation.suggestion_key_v3 = v_requested.suggestion_key_v3
    and recommendation.canonical_recommendation_id is null
  limit 1;

  if not found then
    raise exception 'ABA_RECOMMENDATION_CANONICAL_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  select array_agg(recommendation.id order by recommendation.id)
  into v_grouped_ids
  from public.aba_clinical_recommendations recommendation
  where recommendation.organization_id = v_organization_id
    and recommendation.patient_id = p_patient_id
    and recommendation.suggestion_key_v3 = v_recommendation.suggestion_key_v3;

  if v_recommendation.terminal_conflict then
    return jsonb_build_object(
      'success', false,
      'conflict', true,
      'code', 'ABA_RECOMMENDATION_TERMINAL_HISTORY_CONFLICT',
      'recommendation', to_jsonb(v_recommendation),
      'groupedRecommendationIds', to_jsonb(coalesce(v_grouped_ids, array[v_recommendation.id]))
    );
  end if;

  v_payload_hash := public.aba_recommendation_sha256(v_action || '|' || v_payload::text);

  select audit.*
  into v_existing_audit
  from public.aba_clinical_recommendation_audit_logs audit
  where audit.organization_id = v_organization_id
    and audit.patient_id = p_patient_id
    and audit.recommendation_id = v_recommendation.id
    and audit.idempotency_key = p_idempotency_key;

  if found then
    if v_existing_audit.action <> v_action
       or v_existing_audit.payload_hash <> v_payload_hash then
      return jsonb_build_object(
        'success', false,
        'conflict', true,
        'code', 'ABA_RECOMMENDATION_IDEMPOTENCY_CONFLICT',
        'recommendation', to_jsonb(v_recommendation),
        'groupedRecommendationIds', to_jsonb(coalesce(v_grouped_ids, array[v_recommendation.id]))
      );
    end if;

    return coalesce(
      v_existing_audit.metadata -> 'result',
      jsonb_build_object(
        'success', true,
        'idempotent', true,
        'recommendation', to_jsonb(v_recommendation),
        'auditEventId', v_existing_audit.id
      )
    ) || jsonb_build_object('idempotent', true);
  end if;

  if v_action = 'EDITED' then
    if v_recommendation.status not in ('SUGGESTED', 'EDITED') then
      return jsonb_build_object(
        'success', false,
        'conflict', true,
        'code', 'ABA_RECOMMENDATION_ALREADY_DECIDED',
        'recommendation', to_jsonb(v_recommendation),
        'groupedRecommendationIds', to_jsonb(coalesce(v_grouped_ids, array[v_recommendation.id]))
      );
    end if;
  elsif v_action = 'APPLIED_TO_NEXT_SESSION' then
    if v_recommendation.status not in ('SUGGESTED', 'EDITED', 'ACCEPTED') then
      return jsonb_build_object(
        'success', false,
        'conflict', true,
        'code', 'ABA_RECOMMENDATION_ALREADY_DECIDED',
        'recommendation', to_jsonb(v_recommendation),
        'groupedRecommendationIds', to_jsonb(coalesce(v_grouped_ids, array[v_recommendation.id]))
      );
    end if;
  elsif v_recommendation.status not in ('SUGGESTED', 'EDITED') then
    return jsonb_build_object(
      'success', false,
      'conflict', true,
      'code', 'ABA_RECOMMENDATION_ALREADY_DECIDED',
      'recommendation', to_jsonb(v_recommendation),
      'groupedRecommendationIds', to_jsonb(coalesce(v_grouped_ids, array[v_recommendation.id]))
    );
  end if;

  v_previous := to_jsonb(v_recommendation);
  v_event_id := 'audit-v3-' || public.aba_recommendation_sha256(
    v_organization_id || '|' || p_patient_id::text || '|' || v_recommendation.id || '|' || v_action || '|' || p_idempotency_key
  );

  if v_action = 'EDITED' then
    v_new_recommendation_type := upper(coalesce(nullif(btrim(v_payload ->> 'recommendation_type'), ''), v_recommendation.recommendation_type));
    v_new_target_id := case
      when v_payload ? 'target_id' then nullif(btrim(v_payload ->> 'target_id'), '')
      else v_recommendation.target_id
    end;
    v_new_behavior_id := case
      when v_payload ? 'behavior_id' then nullif(btrim(v_payload ->> 'behavior_id'), '')
      else v_recommendation.behavior_id
    end;
    v_new_program_id := case
      when v_payload ? 'program_id' then nullif(btrim(v_payload ->> 'program_id'), '')
      else v_recommendation.program_id
    end;
    v_new_metric_name := case
      when v_payload ? 'metric_name' then nullif(btrim(v_payload ->> 'metric_name'), '')
      else v_recommendation.metric_name
    end;

    if v_new_recommendation_type in ('REGRESSION_ATTENTION', 'MAINTENANCE_PROBE')
       and v_new_target_id is null
       and nullif(btrim(coalesce(v_recommendation.evidence ->> 'skillId', v_recommendation.evidence ->> 'skill_id', '')), '') is null then
      raise exception 'ABA_RECOMMENDATION_TARGET_REQUIRED'
        using errcode = '22023';
    end if;

    if v_new_target_id is not null and not exists (
      select 1
      from public.aba_targets target
      where target.id = v_new_target_id
        and target.patient_id = p_patient_id
        and target.organization_id = v_organization_id
    ) then
      raise exception 'ABA_RECOMMENDATION_TARGET_SCOPE_INVALID'
        using errcode = '42501';
    end if;

    if v_new_program_id is not null and not exists (
      select 1
      from public.aba_programs program
      where program.id = v_new_program_id
        and program.patient_id = p_patient_id
        and program.organization_id = v_organization_id
    ) then
      raise exception 'ABA_RECOMMENDATION_PROGRAM_SCOPE_INVALID'
        using errcode = '42501';
    end if;

    if v_new_behavior_id is not null and not exists (
      select 1
      from public.aba_behavior_definitions behavior
      where behavior.id = v_new_behavior_id
        and behavior.patient_id = p_patient_id
        and behavior.organization_id = v_organization_id
    ) then
      raise exception 'ABA_RECOMMENDATION_BEHAVIOR_SCOPE_INVALID'
        using errcode = '42501';
    end if;

    v_new_material := public.aba_recommendation_semantic_material_v3(
      v_organization_id,
      p_patient_id,
      v_new_recommendation_type,
      v_new_target_id,
      coalesce(v_recommendation.evidence ->> 'skillId', v_recommendation.evidence ->> 'skill_id'),
      v_new_program_id,
      v_new_behavior_id,
      v_new_metric_name,
      v_recommendation.evidence
    );
    v_new_suggestion_key_v3 := public.aba_recommendation_sha256(v_new_material);

    if v_new_suggestion_key_v3 <> v_recommendation.suggestion_key_v3 then
      perform pg_advisory_xact_lock(
        hashtextextended(
          v_organization_id || '|' || p_patient_id::text || '|' || v_new_suggestion_key_v3,
          0
        )
      );

      perform 1
      from public.aba_clinical_recommendations conflicting
      where conflicting.organization_id = v_organization_id
        and conflicting.patient_id = p_patient_id
        and conflicting.suggestion_key_v3 = v_new_suggestion_key_v3
        and conflicting.canonical_recommendation_id is null
        and conflicting.id <> v_recommendation.id;

      if found then
        return jsonb_build_object(
          'success', false,
          'conflict', true,
          'code', 'ABA_RECOMMENDATION_EDIT_IDENTITY_CONFLICT',
          'recommendation', to_jsonb(v_recommendation),
          'groupedRecommendationIds', to_jsonb(coalesce(v_grouped_ids, array[v_recommendation.id]))
        );
      end if;
    end if;

    update public.aba_clinical_recommendations
    set
      title = coalesce(nullif(v_payload ->> 'title', ''), title),
      summary = coalesce(v_payload ->> 'summary', summary),
      rationale = coalesce(v_payload ->> 'rationale', rationale),
      suggested_action = coalesce(nullif(v_payload ->> 'suggested_action', ''), suggested_action),
      recommendation_type = v_new_recommendation_type,
      priority = coalesce(nullif(v_payload ->> 'priority', ''), priority),
      target_id = v_new_target_id,
      behavior_id = v_new_behavior_id,
      program_id = v_new_program_id,
      domain = case when v_payload ? 'domain' then nullif(v_payload ->> 'domain', '') else domain end,
      metric_name = v_new_metric_name,
      evidence = public.aba_merge_recommendation_evidence_v3(
        evidence,
        jsonb_strip_nulls(jsonb_build_object(
          'clinical_note', nullif(v_payload ->> 'clinical_note', ''),
          'apply_for_date', nullif(v_payload ->> 'apply_for_date', ''),
          'responsible_professional_id', nullif(v_payload ->> 'responsible_professional_id', ''),
          'editedBy', p_actor_id,
          'editedAt', v_now,
          'suggestionKeyV3', v_new_suggestion_key_v3,
          'semanticMaterialVersion', 3
        ))
      ),
      suggestion_key = v_new_suggestion_key_v3,
      suggestion_key_v3 = v_new_suggestion_key_v3,
      suggestion_key_version = 3,
      status = 'EDITED',
      edited_from_id = coalesce(edited_from_id, id),
      decision_event_id = v_event_id,
      updated_at = v_now
    where id = v_recommendation.id
    returning * into v_recommendation;
  elsif v_action = 'REJECTED' then
    update public.aba_clinical_recommendations
    set
      status = 'REJECTED',
      rejected_by = p_actor_id,
      rejected_at = v_now,
      decision_event_id = v_event_id,
      updated_at = v_now
    where id = v_recommendation.id
    returning * into v_recommendation;
  else
    update public.aba_clinical_recommendations
    set
      status = v_action,
      accepted_by = p_actor_id,
      accepted_at = v_now,
      decision_event_id = v_event_id,
      updated_at = v_now
    where id = v_recommendation.id
    returning * into v_recommendation;
  end if;

  update public.aba_clinical_recommendations recommendation
  set
    status = case
      when recommendation.status in ('SUGGESTED', 'EDITED') then 'SUPERSEDED'
      else recommendation.status
    end,
    decision_event_id = v_event_id,
    resolved_at = coalesce(recommendation.resolved_at, v_now),
    resolution_reason = coalesce(recommendation.resolution_reason, 'RESOLVED_BY_EQUIVALENT'),
    updated_at = case
      when recommendation.status in ('SUGGESTED', 'EDITED') then v_now
      else recommendation.updated_at
    end
  where recommendation.organization_id = v_organization_id
    and recommendation.patient_id = p_patient_id
    and recommendation.id = any(coalesce(v_grouped_ids, array[v_recommendation.id]))
    and recommendation.id <> v_recommendation.id;

  if v_action = 'APPLIED_TO_NEXT_SESSION' then
    insert into public.aba_next_session_plan_items (
      id,
      organization_id,
      clinic_id,
      patient_id,
      source_session_id,
      source_recommendation_id,
      target_id,
      behavior_id,
      planned_trial_type,
      planned_prompt,
      priority,
      instructions,
      status,
      created_by,
      created_at,
      updated_at
    )
    values (
      'plan-v3-' || public.aba_recommendation_sha256(
        v_organization_id || '|' || p_patient_id::text || '|' || v_recommendation.id || '|NEXT_SESSION'
      ),
      v_organization_id,
      p_clinic_id,
      p_patient_id,
      v_recommendation.source_session_id,
      v_recommendation.id,
      v_recommendation.target_id,
      v_recommendation.behavior_id,
      case
        when v_recommendation.recommendation_type = 'MAINTENANCE_PROBE'
          then 'maintenance_probe'
        else null
      end,
      null,
      v_recommendation.priority,
      v_recommendation.suggested_action,
      'PLANNED',
      p_actor_id,
      v_now,
      v_now
    )
    on conflict (id) do nothing;

    select plan_item.*
    into v_plan_item
    from public.aba_next_session_plan_items plan_item
    where plan_item.id = 'plan-v3-' || public.aba_recommendation_sha256(
      v_organization_id || '|' || p_patient_id::text || '|' || v_recommendation.id || '|NEXT_SESSION'
    )
      and plan_item.organization_id = v_organization_id
      and plan_item.patient_id = p_patient_id;

    if not found then
      raise exception 'ABA_RECOMMENDATION_PLAN_ITEM_PERSISTENCE_FAILED'
        using errcode = 'P0001';
    end if;
    v_plan_item_json := to_jsonb(v_plan_item);
  end if;

  v_result := jsonb_build_object(
    'success', true,
    'idempotent', false,
    'recommendation', to_jsonb(v_recommendation),
    'planItem', v_plan_item_json,
    'auditEventId', v_event_id,
    'groupedRecommendationIds', to_jsonb(coalesce(v_grouped_ids, array[v_recommendation.id]))
  );

  insert into public.aba_clinical_recommendation_audit_logs (
    id,
    organization_id,
    clinic_id,
    patient_id,
    recommendation_id,
    action,
    previous_status,
    new_status,
    performed_by,
    performed_at,
    metadata,
    idempotency_key,
    payload_hash
  )
  values (
    v_event_id,
    v_organization_id,
    p_clinic_id,
    p_patient_id,
    v_recommendation.id,
    v_action,
    v_previous ->> 'status',
    v_recommendation.status,
    p_actor_id,
    v_now,
    jsonb_build_object(
      'before', v_previous,
      'changedFields', coalesce(v_payload -> 'changed_fields', '[]'::jsonb),
      'reason', nullif(v_payload ->> 'reason', ''),
      'notes', nullif(v_payload ->> 'notes', ''),
      'groupedRecommendationIds', to_jsonb(coalesce(v_grouped_ids, array[v_recommendation.id])),
      'result', v_result
    ),
    p_idempotency_key,
    v_payload_hash
  );

  return v_result;
end;
$$;

create or replace function public.aba_can_read_recommendation_scope_v3(
  p_clinic_id text,
  p_organization_id text,
  p_patient_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_organization_id = p_clinic_id
    and exists (
      select 1
      from public.patients patient
      join public.users actor on actor.id = auth.uid()
      left join public.clinics clinic on clinic.id::text = p_clinic_id
      where patient.id = p_patient_id
        and patient.clinic_id::text = p_clinic_id
        and (
          (
            actor.role in ('owner', 'admin')
            and (
              actor.clinic_id::text = p_clinic_id
              or clinic.owner_user_id = actor.id
              or exists (
                select 1
                from public.clinic_memberships membership
                where membership.user_id = actor.id
                  and membership.clinic_id::text = p_clinic_id
                  and membership.status = 'active'
              )
            )
          )
          or (
            actor.role = 'coordinator'
            and (
              actor.clinic_id::text = p_clinic_id
              or exists (
                select 1
                from public.clinic_memberships membership
                where membership.user_id = actor.id
                  and membership.clinic_id::text = p_clinic_id
                  and membership.status = 'active'
                  and membership.role = 'coordinator'
              )
            )
          )
          or (
            actor.role = 'therapist'
            and patient.therapist_id = actor.id
            and (
              actor.clinic_id::text = p_clinic_id
              or exists (
                select 1
                from public.clinic_memberships membership
                where membership.user_id = actor.id
                  and membership.clinic_id::text = p_clinic_id
                  and membership.status = 'active'
                  and membership.role in ('therapist', 'coordinator')
              )
            )
          )
        )
    );
$$;

alter table public.aba_clinical_recommendation_occurrences enable row level security;

drop policy if exists aba_clinical_recommendations_patient_scope_rw
  on public.aba_clinical_recommendations;
drop policy if exists aba_clinical_recommendations_patient_scope_select
  on public.aba_clinical_recommendations;
drop policy if exists aba_clinical_recommendations_patient_scope_select_v3
  on public.aba_clinical_recommendations;
create policy aba_clinical_recommendations_patient_scope_select_v3
on public.aba_clinical_recommendations
for select
to authenticated
using (
  public.aba_can_read_recommendation_scope_v3(
    clinic_id,
    organization_id,
    patient_id
  )
);

drop policy if exists aba_clinical_recommendation_occurrences_patient_scope_select
  on public.aba_clinical_recommendation_occurrences;
drop policy if exists aba_clinical_recommendation_occurrences_patient_scope_select_v3
  on public.aba_clinical_recommendation_occurrences;
create policy aba_clinical_recommendation_occurrences_patient_scope_select_v3
on public.aba_clinical_recommendation_occurrences
for select
to authenticated
using (
  public.aba_can_read_recommendation_scope_v3(
    clinic_id,
    organization_id,
    patient_id
  )
);

drop policy if exists aba_clinical_recommendation_audit_logs_patient_scope_rw
  on public.aba_clinical_recommendation_audit_logs;
drop policy if exists aba_clinical_recommendation_audit_logs_patient_scope_select
  on public.aba_clinical_recommendation_audit_logs;
drop policy if exists aba_clinical_recommendation_audit_logs_patient_scope_select_v3
  on public.aba_clinical_recommendation_audit_logs;
create policy aba_clinical_recommendation_audit_logs_patient_scope_select_v3
on public.aba_clinical_recommendation_audit_logs
for select
to authenticated
using (
  public.aba_can_read_recommendation_scope_v3(
    clinic_id,
    organization_id,
    patient_id
  )
);

revoke insert, update, delete
  on public.aba_clinical_recommendations
  from anon, authenticated;
revoke insert, update, delete
  on public.aba_clinical_recommendation_audit_logs
  from anon, authenticated;
revoke insert, update, delete
  on public.aba_clinical_recommendation_occurrences
  from anon, authenticated;
grant select
  on public.aba_clinical_recommendations,
     public.aba_clinical_recommendation_audit_logs,
     public.aba_clinical_recommendation_occurrences
  to authenticated;

create or replace function public.aba_recommendation_audit_append_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if session_user in ('postgres', 'supabase_admin') then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  raise exception 'ABA_RECOMMENDATION_AUDIT_APPEND_ONLY'
    using errcode = '42501';
end;
$$;

drop trigger if exists aba_recommendation_audit_append_only
  on public.aba_clinical_recommendation_audit_logs;
create trigger aba_recommendation_audit_append_only
before update or delete
on public.aba_clinical_recommendation_audit_logs
for each row
execute function public.aba_recommendation_audit_append_only();

revoke all on function public.aba_assert_recommendation_actor_scope_v3(text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.aba_can_read_recommendation_scope_v3(text, text, uuid)
  from public, anon;
revoke all on function public.upsert_aba_clinical_recommendations_v3(text, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.apply_aba_clinical_recommendation_decision_v3(text, uuid, text, text, text, jsonb, text)
  from public, anon, authenticated;

grant execute on function public.upsert_aba_clinical_recommendations_v3(text, uuid, text, jsonb)
  to service_role;
grant execute on function public.apply_aba_clinical_recommendation_decision_v3(text, uuid, text, text, text, jsonb, text)
  to service_role;
grant execute on function public.aba_can_read_recommendation_scope_v3(text, text, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

-- Post-migration audit (read-only). Run after COMMIT in the Supabase SQL editor.
-- 1. Global reconciliation summary.
-- select
--   count(*) as total_records,
--   count(*) filter (where canonical_recommendation_id is null) as canonical_records,
--   count(*) filter (where canonical_recommendation_id is not null) as linked_legacy_records,
--   count(*) filter (where status = 'SUPERSEDED') as superseded_records,
--   count(*) filter (
--     where canonical_recommendation_id is null
--       and status in ('SUGGESTED', 'EDITED')
--       and not terminal_conflict
--   ) as visible_pending_canonical_records,
--   count(*) filter (where terminal_conflict) as records_in_terminal_conflict_groups,
--   count(distinct (organization_id, patient_id, suggestion_key_v3)) as semantic_groups_v3
-- from public.aba_clinical_recommendations;
--
-- 2. Canonical groups by clinical type. For the audited patient, regression and maintenance
-- should each collapse to their real target-level group count, without using the title.
-- select
--   organization_id,
--   patient_id,
--   recommendation_type,
--   count(*) as canonical_groups,
--   count(*) filter (where status in ('SUGGESTED', 'EDITED') and not terminal_conflict) as pending_groups,
--   count(*) filter (where terminal_conflict) as conflict_groups
-- from public.aba_clinical_recommendations
-- where canonical_recommendation_id is null
--   and status <> 'SUPERSEDED'
-- group by organization_id, patient_id, recommendation_type
-- order by organization_id, patient_id, recommendation_type;
--
-- 3. Must return zero rows: more than one canonical record for the same v3 identity.
-- select organization_id, patient_id, suggestion_key_v3, count(*) as canonical_count,
--        array_agg(id order by id) as canonical_ids,
--        array_agg(status order by id) as canonical_statuses
-- from public.aba_clinical_recommendations
-- where suggestion_key_v3 is not null
--   and canonical_recommendation_id is null
-- group by organization_id, patient_id, suggestion_key_v3
-- having count(*) > 1;
--
-- 4. Must return zero rows: a visible pending record left in a group with a terminal decision.
-- select
--   pending.organization_id,
--   pending.patient_id,
--   pending.suggestion_key_v3,
--   array_agg(distinct pending.id) as pending_ids,
--   array_agg(distinct terminal.id) as terminal_ids,
--   array_agg(distinct terminal.status) as terminal_statuses
-- from public.aba_clinical_recommendations pending
-- join public.aba_clinical_recommendations terminal
--   on terminal.organization_id = pending.organization_id
--  and terminal.patient_id = pending.patient_id
--  and terminal.suggestion_key_v3 = pending.suggestion_key_v3
--  and terminal.status in ('ACCEPTED', 'REJECTED', 'APPLIED_TO_NEXT_SESSION')
-- where pending.status in ('SUGGESTED', 'EDITED')
--   and pending.canonical_recommendation_id is null
-- group by pending.organization_id, pending.patient_id, pending.suggestion_key_v3;
--
-- 5. Terminal conflicts preserved for clinical review. Both terminal records remain stored;
-- only the technical canonical row is exposed in the normal queue.
-- select
--   recommendation.organization_id,
--   recommendation.patient_id,
--   recommendation.suggestion_key_v3,
--   min(recommendation.conflict_reason) as conflict_reason,
--   array_agg(recommendation.id order by recommendation.id) as grouped_ids,
--   array_agg(recommendation.status order by recommendation.id) as grouped_statuses
-- from public.aba_clinical_recommendations recommendation
-- where recommendation.terminal_conflict
-- group by recommendation.organization_id, recommendation.patient_id, recommendation.suggestion_key_v3
-- order by recommendation.organization_id, recommendation.patient_id, recommendation.suggestion_key_v3;
