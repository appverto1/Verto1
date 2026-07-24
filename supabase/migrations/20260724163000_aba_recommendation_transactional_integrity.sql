-- Transactional integrity for the ABA clinical recommendation queue.
-- Additive and idempotent. Existing recommendations and audit history are preserved.

begin;

create extension if not exists pgcrypto with schema extensions;

alter table public.aba_clinical_recommendations
  add column if not exists suggestion_key text,
  add column if not exists suggestion_key_version smallint not null default 2,
  add column if not exists canonical_recommendation_id text,
  add column if not exists merged_recommendation_ids text[] not null default '{}'::text[],
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_reason text,
  add column if not exists decision_event_id text;

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

create or replace function public.aba_recommendation_semantic_material(
  p_row public.aba_clinical_recommendations
)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    nullif(p_row.evidence ->> 'suggestionKey', ''),
    concat_ws(
      '|',
      public.aba_recommendation_normalize_key_part(p_row.organization_id, 'organization-missing'),
      public.aba_recommendation_normalize_key_part(p_row.patient_id::text, 'patient-missing'),
      public.aba_recommendation_normalize_key_part(p_row.recommendation_type, 'type-missing'),
      public.aba_recommendation_normalize_key_part(p_row.target_id, 'target-none'),
      public.aba_recommendation_normalize_key_part(coalesce(p_row.evidence ->> 'skillId', p_row.evidence ->> 'skill_id'), 'skill-none'),
      public.aba_recommendation_normalize_key_part(p_row.program_id, 'program-none'),
      public.aba_recommendation_normalize_key_part(p_row.behavior_id, 'behavior-none'),
      public.aba_recommendation_normalize_key_part(
        coalesce(
          p_row.evidence ->> 'reasonCode',
          p_row.evidence ->> 'reason_code',
          p_row.evidence ->> 'ruleCode',
          p_row.evidence ->> 'rule_code',
          p_row.metric_name,
          p_row.recommendation_type
        ),
        'reason-missing'
      ),
      public.aba_recommendation_normalize_key_part(
        coalesce(
          p_row.evidence ->> 'clinicalWindowKey',
          p_row.evidence ->> 'clinical_window_key',
          p_row.evidence ->> 'scheduleId',
          p_row.evidence ->> 'schedule_id',
          p_row.evidence ->> 'probeResultId',
          p_row.evidence ->> 'probe_result_id',
          p_row.source_session_id,
          'active'
        ),
        'window-missing'
      ),
      public.aba_recommendation_normalize_key_part(
        coalesce(
          p_row.evidence ->> 'configurationKey',
          p_row.evidence ->> 'configuration_key',
          p_row.evidence ->> 'ruleVersion',
          p_row.evidence ->> 'rule_version'
        ),
        'config-default'
      )
    )
  );
$$;

create or replace function public.aba_merge_recommendation_evidence(
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
  suggestion_key = public.aba_recommendation_sha256(
    public.aba_recommendation_semantic_material(recommendation)
  ),
  suggestion_key_version = 2
where recommendation.suggestion_key is null
   or recommendation.suggestion_key = '';

with ranked as (
  select
    recommendation.id,
    recommendation.organization_id,
    recommendation.patient_id,
    recommendation.suggestion_key,
    first_value(recommendation.id) over (
      partition by recommendation.organization_id, recommendation.patient_id, recommendation.suggestion_key
      order by
        case recommendation.status
          when 'APPLIED_TO_NEXT_SESSION' then 70
          when 'ACCEPTED' then 60
          when 'REJECTED' then 60
          when 'EDITED' then 50
          when 'SUGGESTED' then 40
          when 'EXPIRED' then 30
          when 'SUPERSEDED' then 10
          else 0
        end desc,
        recommendation.updated_at desc nulls last,
        recommendation.created_at desc nulls last,
        recommendation.id
    ) as canonical_id,
    array_agg(recommendation.id) over (
      partition by recommendation.organization_id, recommendation.patient_id, recommendation.suggestion_key
    ) as grouped_ids
  from public.aba_clinical_recommendations recommendation
  where recommendation.suggestion_key is not null
),
canonical_updates as (
  update public.aba_clinical_recommendations recommendation
  set
    canonical_recommendation_id = case
      when recommendation.id = ranked.canonical_id then null
      else ranked.canonical_id
    end,
    merged_recommendation_ids = case
      when recommendation.id = ranked.canonical_id then ranked.grouped_ids
      else recommendation.merged_recommendation_ids
    end,
    status = case
      when recommendation.id <> ranked.canonical_id
       and recommendation.status in ('SUGGESTED', 'EDITED')
        then 'SUPERSEDED'
      else recommendation.status
    end,
    resolved_at = case
      when recommendation.id <> ranked.canonical_id
       and recommendation.status in ('SUGGESTED', 'EDITED', 'SUPERSEDED')
        then coalesce(recommendation.resolved_at, now())
      else recommendation.resolved_at
    end,
    resolution_reason = case
      when recommendation.id <> ranked.canonical_id
       and recommendation.status in ('SUGGESTED', 'EDITED', 'SUPERSEDED')
        then coalesce(recommendation.resolution_reason, 'LEGACY_SEMANTIC_RECONCILIATION')
      else recommendation.resolution_reason
    end
  from ranked
  where recommendation.id = ranked.id
  returning recommendation.id
)
select count(*) from canonical_updates;

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

create unique index if not exists uq_aba_recommendation_canonical_semantic_key
  on public.aba_clinical_recommendations (
    organization_id,
    patient_id,
    suggestion_key
  )
  where suggestion_key is not null
    and canonical_recommendation_id is null;

create index if not exists idx_aba_recommendation_canonical_queue
  on public.aba_clinical_recommendations (
    organization_id,
    patient_id,
    status,
    created_at desc
  )
  where canonical_recommendation_id is null
    and status <> 'SUPERSEDED';

create index if not exists idx_aba_recommendation_legacy_group
  on public.aba_clinical_recommendations (
    organization_id,
    patient_id,
    suggestion_key,
    canonical_recommendation_id
  );

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

alter table public.aba_clinical_recommendation_occurrences enable row level security;

drop policy if exists aba_clinical_recommendations_patient_scope_rw
  on public.aba_clinical_recommendations;
drop policy if exists aba_clinical_recommendations_patient_scope_select
  on public.aba_clinical_recommendations;
create policy aba_clinical_recommendations_patient_scope_select
on public.aba_clinical_recommendations
for select
to authenticated
using (
  exists (
    select 1
    from public.patients patient
    join public.users actor on actor.id = auth.uid()
    where patient.id = aba_clinical_recommendations.patient_id
      and (
        actor.role in ('owner', 'admin')
        or (
          actor.role in ('coordinator', 'therapist')
          and actor.clinic_id::text = aba_clinical_recommendations.clinic_id
        )
      )
  )
);

drop policy if exists aba_clinical_recommendation_occurrences_patient_scope_select
  on public.aba_clinical_recommendation_occurrences;
create policy aba_clinical_recommendation_occurrences_patient_scope_select
on public.aba_clinical_recommendation_occurrences
for select
to authenticated
using (
  exists (
    select 1
    from public.patients patient
    join public.users actor on actor.id = auth.uid()
    where patient.id = aba_clinical_recommendation_occurrences.patient_id
      and (
        actor.role in ('owner', 'admin')
        or (
          actor.role in ('coordinator', 'therapist')
          and actor.clinic_id::text = aba_clinical_recommendation_occurrences.clinic_id
        )
      )
  )
);

drop policy if exists aba_clinical_recommendation_audit_logs_patient_scope_rw
  on public.aba_clinical_recommendation_audit_logs;
drop policy if exists aba_clinical_recommendation_audit_logs_patient_scope_select
  on public.aba_clinical_recommendation_audit_logs;
create policy aba_clinical_recommendation_audit_logs_patient_scope_select
on public.aba_clinical_recommendation_audit_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.patients patient
    join public.users actor on actor.id = auth.uid()
    where patient.id = aba_clinical_recommendation_audit_logs.patient_id
      and (
        actor.role in ('owner', 'admin')
        or (
          actor.role in ('coordinator', 'therapist')
          and actor.clinic_id::text = aba_clinical_recommendation_audit_logs.clinic_id
        )
      )
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

create or replace function public.aba_assert_recommendation_actor_scope(
  p_organization_id text,
  p_clinic_id text,
  p_patient_id uuid,
  p_actor_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient_clinic_id text;
  v_actor_role text;
  v_actor_clinic_id text;
begin
  if nullif(btrim(p_organization_id), '') is null
     or nullif(btrim(p_clinic_id), '') is null
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

  select actor.role, actor.clinic_id::text
  into v_actor_role, v_actor_clinic_id
  from public.users actor
  where actor.id::text = p_actor_id;

  if v_actor_role is null
     or not (
       v_actor_role in ('owner', 'admin')
       or (v_actor_role = 'coordinator' and v_actor_clinic_id = p_clinic_id)
     ) then
    raise exception 'ABA_RECOMMENDATION_ACTOR_FORBIDDEN'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.upsert_aba_clinical_recommendations_v2(
  p_organization_id text,
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
  v_item jsonb;
  v_evidence jsonb;
  v_material text;
  v_suggestion_key text;
  v_recommendation_id text;
  v_occurrence_material text;
  v_occurrence_key text;
  v_occurrence_id text;
  v_occurrence_inserted integer;
  v_audit_id text;
  v_audit_key text;
  v_result jsonb := '[]'::jsonb;
  v_recommendation public.aba_clinical_recommendations%rowtype;
begin
  perform public.aba_assert_recommendation_actor_scope(
    p_organization_id,
    p_clinic_id,
    p_patient_id,
    p_actor_id
  );

  if jsonb_typeof(p_recommendations) <> 'array'
     or jsonb_array_length(p_recommendations) > 100 then
    raise exception 'ABA_RECOMMENDATION_GENERATION_PAYLOAD_INVALID'
      using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_recommendations)
  loop
    if coalesce(v_item ->> 'organization_id', '') <> p_organization_id
       or coalesce(v_item ->> 'patient_id', '') <> p_patient_id::text then
      raise exception 'ABA_RECOMMENDATION_TENANT_PAYLOAD_MISMATCH'
        using errcode = '42501';
    end if;

    v_evidence := coalesce(v_item -> 'evidence', '{}'::jsonb);
    v_material := nullif(v_evidence ->> 'suggestionKey', '');
    if v_material is null then
      raise exception 'ABA_RECOMMENDATION_SEMANTIC_KEY_REQUIRED'
        using errcode = '22023';
    end if;

    v_suggestion_key := public.aba_recommendation_sha256(v_material);
    if nullif(v_item ->> 'suggestion_key', '') is not null
       and v_item ->> 'suggestion_key' <> v_suggestion_key then
      raise exception 'ABA_RECOMMENDATION_SEMANTIC_HASH_MISMATCH'
        using errcode = '22023';
    end if;

    v_recommendation_id := 'rec-sha256-' || v_suggestion_key;

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
      suggestion_key_version,
      merged_recommendation_ids,
      created_at,
      updated_at
    )
    values (
      v_recommendation_id,
      p_organization_id,
      p_clinic_id,
      p_patient_id,
      nullif(v_item ->> 'source_session_id', ''),
      nullif(v_item ->> 'next_session_focus_id', ''),
      v_item ->> 'recommendation_type',
      v_item ->> 'priority',
      v_item ->> 'title',
      coalesce(v_item ->> 'summary', ''),
      coalesce(v_item ->> 'rationale', ''),
      v_item ->> 'suggested_action',
      nullif(v_item ->> 'target_id', ''),
      nullif(v_item ->> 'behavior_id', ''),
      nullif(v_item ->> 'program_id', ''),
      nullif(v_item ->> 'domain', ''),
      nullif(v_item ->> 'metric_name', ''),
      nullif(v_item ->> 'previous_value', '')::numeric,
      nullif(v_item ->> 'current_value', '')::numeric,
      nullif(v_item ->> 'delta_value', '')::numeric,
      v_evidence,
      'SUGGESTED',
      v_item ->> 'context_hash',
      v_suggestion_key,
      2,
      array[v_recommendation_id],
      coalesce(nullif(v_item ->> 'created_at', '')::timestamptz, now()),
      now()
    )
    on conflict (organization_id, patient_id, suggestion_key)
      where suggestion_key is not null and canonical_recommendation_id is null
    do update set
      evidence = public.aba_merge_recommendation_evidence(
        public.aba_clinical_recommendations.evidence,
        excluded.evidence
      ),
      merged_recommendation_ids = (
        select array_agg(distinct grouped_id order by grouped_id)
        from unnest(
          coalesce(public.aba_clinical_recommendations.merged_recommendation_ids, '{}'::text[])
          || array[public.aba_clinical_recommendations.id]
        ) grouped_id
      ),
      updated_at = case
        when public.aba_clinical_recommendations.status in ('SUGGESTED', 'EDITED')
          then now()
        else public.aba_clinical_recommendations.updated_at
      end
    returning * into v_recommendation;

    v_occurrence_material := concat_ws(
      '|',
      v_suggestion_key,
      coalesce(v_item ->> 'source_session_id', ''),
      coalesce(v_item ->> 'context_hash', ''),
      coalesce(v_evidence ->> 'sourceSessionId', v_evidence ->> 'source_session_id', ''),
      coalesce(v_evidence ->> 'alertId', v_evidence ->> 'alert_id', ''),
      coalesce(v_evidence ->> 'scheduleId', v_evidence ->> 'schedule_id', ''),
      coalesce(v_evidence ->> 'snapshotId', v_evidence ->> 'snapshot_id', ''),
      coalesce(v_evidence ->> 'probeResultId', v_evidence ->> 'probe_result_id', '')
    );
    v_occurrence_key := public.aba_recommendation_sha256(v_occurrence_material);
    v_occurrence_id := 'occurrence-sha256-' || public.aba_recommendation_sha256(
      p_organization_id || '|' || p_patient_id::text || '|' || v_recommendation.id || '|' || v_occurrence_key
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
      p_organization_id,
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
      v_audit_key := 'generation:' || v_occurrence_key;
      v_audit_id := 'audit-sha256-' || public.aba_recommendation_sha256(
        p_organization_id || '|' || p_patient_id::text || '|' || v_recommendation.id || '|GENERATED|' || v_audit_key
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
        p_organization_id,
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
          'summaryDriven', true
        ),
        v_audit_key,
        public.aba_recommendation_sha256('GENERATED|' || v_occurrence_material)
      );
    end if;

    v_result := v_result || jsonb_build_array(to_jsonb(v_recommendation));
  end loop;

  return jsonb_build_object(
    'success', true,
    'recommendations', v_result
  );
end;
$$;

create or replace function public.apply_aba_clinical_recommendation_decision_v2(
  p_organization_id text,
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
  v_target_id text;
begin
  perform public.aba_assert_recommendation_actor_scope(
    p_organization_id,
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
    and recommendation.organization_id = p_organization_id
    and recommendation.patient_id = p_patient_id
    and recommendation.clinic_id = p_clinic_id;

  if not found then
    raise exception 'ABA_RECOMMENDATION_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  perform 1
  from public.aba_clinical_recommendations recommendation
  where recommendation.organization_id = p_organization_id
    and recommendation.patient_id = p_patient_id
    and recommendation.suggestion_key = v_requested.suggestion_key
  order by recommendation.id
  for update;

  select recommendation.*
  into v_recommendation
  from public.aba_clinical_recommendations recommendation
  where recommendation.organization_id = p_organization_id
    and recommendation.patient_id = p_patient_id
    and recommendation.suggestion_key = v_requested.suggestion_key
  order by
    case recommendation.status
      when 'APPLIED_TO_NEXT_SESSION' then 70
      when 'ACCEPTED' then 60
      when 'REJECTED' then 60
      when 'EDITED' then 50
      when 'SUGGESTED' then 40
      when 'EXPIRED' then 30
      when 'SUPERSEDED' then 10
      else 0
    end desc,
    recommendation.updated_at desc nulls last,
    recommendation.created_at desc nulls last,
    recommendation.id
  limit 1;

  select array_agg(recommendation.id order by recommendation.id)
  into v_grouped_ids
  from public.aba_clinical_recommendations recommendation
  where recommendation.organization_id = p_organization_id
    and recommendation.patient_id = p_patient_id
    and recommendation.suggestion_key = v_requested.suggestion_key;

  update public.aba_clinical_recommendations recommendation
  set
    canonical_recommendation_id = v_recommendation.id,
    status = case
      when recommendation.status in ('SUGGESTED', 'EDITED') then 'SUPERSEDED'
      else recommendation.status
    end,
    resolved_at = case
      when recommendation.status in ('SUGGESTED', 'EDITED', 'SUPERSEDED')
        then coalesce(recommendation.resolved_at, v_now)
      else recommendation.resolved_at
    end,
    resolution_reason = case
      when recommendation.status in ('SUGGESTED', 'EDITED', 'SUPERSEDED')
        then coalesce(recommendation.resolution_reason, 'SEMANTIC_DUPLICATE')
      else recommendation.resolution_reason
    end,
    updated_at = case
      when recommendation.status in ('SUGGESTED', 'EDITED') then v_now
      else recommendation.updated_at
    end
  where recommendation.organization_id = p_organization_id
    and recommendation.patient_id = p_patient_id
    and recommendation.suggestion_key = v_requested.suggestion_key
    and recommendation.id <> v_recommendation.id;

  update public.aba_clinical_recommendations
  set
    canonical_recommendation_id = null,
    merged_recommendation_ids = coalesce(v_grouped_ids, array[v_recommendation.id])
  where id = v_recommendation.id;

  select locked_recommendation.*
  into v_recommendation
  from public.aba_clinical_recommendations locked_recommendation
  where locked_recommendation.id = v_recommendation.id
  for update;

  v_payload_hash := public.aba_recommendation_sha256(v_action || '|' || v_payload::text);

  select audit.*
  into v_existing_audit
  from public.aba_clinical_recommendation_audit_logs audit
  where audit.organization_id = p_organization_id
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
  v_event_id := 'audit-sha256-' || public.aba_recommendation_sha256(
    p_organization_id || '|' || p_patient_id::text || '|' || v_recommendation.id || '|' || v_action || '|' || p_idempotency_key
  );

  if v_action = 'EDITED' then
    v_target_id := nullif(v_payload ->> 'target_id', '');
    if v_target_id is not null and not exists (
      select 1
      from public.aba_targets target
      where target.id = v_target_id
        and target.patient_id = p_patient_id
        and target.organization_id = p_organization_id
    ) then
      raise exception 'ABA_RECOMMENDATION_TARGET_SCOPE_INVALID'
        using errcode = '42501';
    end if;

    update public.aba_clinical_recommendations
    set
      title = coalesce(nullif(v_payload ->> 'title', ''), title),
      summary = coalesce(v_payload ->> 'summary', summary),
      rationale = coalesce(v_payload ->> 'rationale', rationale),
      suggested_action = coalesce(nullif(v_payload ->> 'suggested_action', ''), suggested_action),
      recommendation_type = coalesce(nullif(v_payload ->> 'recommendation_type', ''), recommendation_type),
      priority = coalesce(nullif(v_payload ->> 'priority', ''), priority),
      target_id = case when v_payload ? 'target_id' then v_target_id else target_id end,
      behavior_id = case when v_payload ? 'behavior_id' then nullif(v_payload ->> 'behavior_id', '') else behavior_id end,
      program_id = case when v_payload ? 'program_id' then nullif(v_payload ->> 'program_id', '') else program_id end,
      domain = case when v_payload ? 'domain' then nullif(v_payload ->> 'domain', '') else domain end,
      metric_name = case when v_payload ? 'metric_name' then nullif(v_payload ->> 'metric_name', '') else metric_name end,
      evidence = public.aba_merge_recommendation_evidence(
        evidence,
        jsonb_strip_nulls(jsonb_build_object(
          'clinical_note', nullif(v_payload ->> 'clinical_note', ''),
          'apply_for_date', nullif(v_payload ->> 'apply_for_date', ''),
          'responsible_professional_id', nullif(v_payload ->> 'responsible_professional_id', ''),
          'editedBy', p_actor_id,
          'editedAt', v_now
        ))
      ),
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
    decision_event_id = v_event_id,
    resolved_at = coalesce(recommendation.resolved_at, v_now),
    resolution_reason = coalesce(recommendation.resolution_reason, 'RESOLVED_BY_EQUIVALENT'),
    updated_at = v_now
  where recommendation.organization_id = p_organization_id
    and recommendation.patient_id = p_patient_id
    and recommendation.suggestion_key = v_recommendation.suggestion_key
    and recommendation.id <> v_recommendation.id
    and recommendation.status = 'SUPERSEDED';

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
      'plan-sha256-' || public.aba_recommendation_sha256(
        p_organization_id || '|' || p_patient_id::text || '|' || v_recommendation.id || '|NEXT_SESSION'
      ),
      p_organization_id,
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
    where plan_item.id = 'plan-sha256-' || public.aba_recommendation_sha256(
      p_organization_id || '|' || p_patient_id::text || '|' || v_recommendation.id || '|NEXT_SESSION'
    )
      and plan_item.organization_id = p_organization_id
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
    p_organization_id,
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

revoke all on function public.aba_assert_recommendation_actor_scope(text, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.upsert_aba_clinical_recommendations_v2(text, text, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.apply_aba_clinical_recommendation_decision_v2(text, text, uuid, text, text, text, jsonb, text)
  from public, anon, authenticated;

grant execute on function public.upsert_aba_clinical_recommendations_v2(text, text, uuid, text, jsonb)
  to service_role;
grant execute on function public.apply_aba_clinical_recommendation_decision_v2(text, text, uuid, text, text, text, jsonb, text)
  to service_role;

notify pgrst, 'reload schema';

commit;
