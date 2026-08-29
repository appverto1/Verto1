-- Block 6 smoke follow-up: append-only wellbeing events + assigned-task completion identity bridge.
--
-- `assigned_tasks.professional_id` is a legacy-compatible TEXT column, while
-- `history.therapist_id` is UUID NOT NULL and references auth.users(id).
-- The atomic completion RPC must therefore resolve a valid auth UUID before
-- projecting the completion into history. A malformed/stale legacy professional
-- identifier must never roll back the patient's task completion.
--
-- Preservation rules:
-- - no task/history rows are deleted;
-- - the immutable clinical-link snapshot is preserved unchanged;
-- - the assigned professional is used when it is a valid auth user;
-- - otherwise the patient's canonical therapist_id is used as the legacy fallback;
-- - completion + history + audit remain one transaction inside the RPC.

begin;

-- Mood/energy is an append-only event stream, not a one-row-per-day state.
-- Remove only the exact legacy unique constraint over
-- (clinic_id, patient_id, metric_kind, local_date). Existing rows are untouched.
do $drop_daily_wellbeing_unique$
declare
  v_constraint_name text;
begin
  select constraint_row.conname
    into v_constraint_name
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.patient_wellbeing_checkins'::regclass
    and constraint_row.contype = 'u'
    and (
      select array_agg(attribute_row.attname::text order by key_row.ordinality)
      from unnest(constraint_row.conkey) with ordinality as key_row(attnum, ordinality)
      join pg_catalog.pg_attribute attribute_row
        on attribute_row.attrelid = constraint_row.conrelid
       and attribute_row.attnum = key_row.attnum
    ) = array['clinic_id','patient_id','metric_kind','local_date']::text[]
  limit 1;

  if v_constraint_name is not null then
    execute format(
      'alter table public.patient_wellbeing_checkins drop constraint %I',
      v_constraint_name
    );
  end if;
end;
$drop_daily_wellbeing_unique$;

create index if not exists idx_patient_wellbeing_checkins_patient_created
  on public.patient_wellbeing_checkins (clinic_id, patient_id, created_at desc, id desc);

-- One-time/idempotent legacy bridge. Adult check-ins previously lived in history.
-- Copy each historical event once so removing the textual history from the adult
-- portal does not make existing patient data disappear. The legacy rows remain
-- untouched and continue to be available to historical/audit consumers.
with legacy_wellbeing as (
  select
    history_row.id,
    patient_row.clinic_id,
    patient_row.id as patient_id,
    lower(coalesce(
      nullif(history_row.task_data->>'metricKind', ''),
      nullif(history_row.task_data->>'metric_kind', ''),
      case when history_row.energy is not null then 'energy' else null end
    )) as metric_kind,
    case
      when coalesce(
        nullif(history_row.task_data->>'metricValue', ''),
        nullif(history_row.task_data->>'metric_value', '')
      ) ~ '^[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$' then
        coalesce(
          nullif(history_row.task_data->>'metricValue', ''),
          nullif(history_row.task_data->>'metric_value', '')
        )::numeric
      when history_row.energy between 0 and 100 then history_row.energy::numeric
      when history_row.score between 0 and 100 then history_row.score::numeric
      else null
    end as metric_value,
    left(nullif(trim(coalesce(history_row.task_data->>'tagId', history_row.task_data->>'tag_id', '')), ''), 80) as tag_id,
    left(nullif(trim(coalesce(history_row.task_data->>'tagLabel', history_row.task_data->>'tag_label', '')), ''), 120) as tag_label,
    nullif(history_row.note, '') as note,
    nullif(history_row.icon, '') as icon,
    coalesce(history_row.created_at, now()) as recorded_at
  from public.history history_row
  join public.patients patient_row
    on patient_row.id::text = history_row.patient_id
   and coalesce(patient_row.is_active, true)
   and patient_row.deleted_at is null
  where lower(coalesce(history_row.type, '')) = 'checkin'
    and coalesce(history_row.is_active, true)
    and history_row.deleted_at is null
)
insert into public.patient_wellbeing_checkins (
  id, organization_id, clinic_id, patient_id, actor_user_id, metric_kind, metric_value,
  tag_id, tag_label, note, icon, local_date, created_at, updated_at
)
select
  legacy.id,
  legacy.clinic_id,
  legacy.clinic_id,
  legacy.patient_id,
  null,
  legacy.metric_kind,
  round(legacy.metric_value)::integer,
  legacy.tag_id,
  legacy.tag_label,
  legacy.note,
  legacy.icon,
  (legacy.recorded_at at time zone 'America/Sao_Paulo')::date,
  legacy.recorded_at,
  legacy.recorded_at
from legacy_wellbeing legacy
where legacy.metric_kind in ('mood', 'energy')
  and legacy.metric_value between 0 and 100
on conflict (id) do nothing;

-- The application no longer updates/deletes wellbeing events. New intentional
-- records are appended; request replay idempotency is handled by the event UUID.
revoke update, delete on table public.patient_wellbeing_checkins from service_role;
grant select, insert on table public.patient_wellbeing_checkins to service_role;

comment on table public.patient_wellbeing_checkins is
  'Canonical append-only patient-portal mood/energy events. Multiple events per day are preserved. Values are longitudinal context, not a diagnostic or global clinical score.';

create or replace function public.complete_patient_assigned_task_v2(
  p_task_id uuid,
  p_actor_user_id uuid,
  p_expected_patient_id uuid,
  p_patient_effort integer,
  p_patient_effort_emoji text,
  p_patient_effort_label text,
  p_effort_semantics text,
  p_patient_comment text,
  p_completed_at timestamptz,
  p_history_id uuid,
  p_date_group text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_task public.assigned_tasks%rowtype;
  v_history public.history%rowtype;
  v_task_data jsonb;
  v_completed_at timestamptz := coalesce(p_completed_at, now());
  v_clinic uuid;
  v_patient_clinic uuid;
  v_patient_therapist_id uuid;
  v_task_professional_uuid uuid;
  v_history_therapist_id uuid;
  v_semantics text := coalesce(nullif(trim(p_effort_semantics), ''), 'effort_min_0_max_100_v2');
begin
  if v_semantics <> 'effort_min_0_max_100_v2' then
    raise exception 'ASSIGNED_TASK_EFFORT_SEMANTICS_INVALID';
  end if;

  select * into v_task
  from public.assigned_tasks
  where id = p_task_id
  for update;

  if v_task.id is null then raise exception 'ASSIGNED_TASK_NOT_FOUND'; end if;
  if p_expected_patient_id is null or v_task.patient_id is distinct from p_expected_patient_id then
    raise exception 'ASSIGNED_TASK_SCOPE_CHANGED';
  end if;
  if p_patient_effort is not null and (p_patient_effort < 0 or p_patient_effort > 100) then
    raise exception 'ASSIGNED_TASK_EFFORT_INVALID';
  end if;

  begin
    v_clinic := v_task.clinic_id::uuid;
  exception when invalid_text_representation then
    raise exception 'ASSIGNED_TASK_CLINIC_INVALID';
  end;

  select p.clinic_id, p.therapist_id
    into v_patient_clinic, v_patient_therapist_id
  from public.patients p
  where p.id = v_task.patient_id
    and coalesce(p.is_active, true)
    and p.deleted_at is null
  for share;

  if v_patient_clinic is null or v_patient_clinic is distinct from v_clinic then
    raise exception 'ASSIGNED_TASK_PATIENT_CLINIC_SCOPE_INVALID';
  end if;

  -- Legacy assigned_tasks.professional_id is TEXT. Resolve it defensively before
  -- writing history. A bad legacy value must not be cast directly into UUID.
  begin
    v_task_professional_uuid := nullif(trim(v_task.professional_id), '')::uuid;
  exception when invalid_text_representation then
    v_task_professional_uuid := null;
  end;

  if v_task_professional_uuid is not null
     and exists (select 1 from auth.users auth_user where auth_user.id = v_task_professional_uuid) then
    v_history_therapist_id := v_task_professional_uuid;
  else
    v_history_therapist_id := v_patient_therapist_id;
  end if;

  if v_history_therapist_id is null then
    raise exception 'ASSIGNED_TASK_HISTORY_THERAPIST_UNRESOLVED';
  end if;

  v_task_data := coalesce(v_task.task_data, '{}'::jsonb) || jsonb_build_object(
    'patientEffort', p_patient_effort,
    'patient_effort', p_patient_effort,
    'patientEffortEmoji', nullif(p_patient_effort_emoji, ''),
    'patient_effort_emoji', nullif(p_patient_effort_emoji, ''),
    'patientEffortLabel', nullif(p_patient_effort_label, ''),
    'patient_effort_label', nullif(p_patient_effort_label, ''),
    'patientEffortSemantics', v_semantics,
    'patient_effort_semantics', v_semantics
  );

  update public.assigned_tasks
  set patient_effort = p_patient_effort,
      patient_effort_emoji = nullif(p_patient_effort_emoji, ''),
      patient_effort_label = nullif(p_patient_effort_label, ''),
      patient_comment = coalesce(p_patient_comment, ''),
      task_data = v_task_data,
      status = 'completed',
      completed_at = coalesce(v_task.completed_at, v_completed_at),
      last_history_event_id = p_history_id,
      updated_at = now()
  where id = p_task_id
  returning * into v_task;

  insert into public.history(
    id, patient_id, patient_email, type, title, score, energy, note, icon, therapist_id, created_at, date_group,
    assigned_task_id, source, task_data, therapeutic_plan_id, therapeutic_objective_id, therapeutic_program_id,
    clinical_target_id, clinical_link_snapshot, is_active, deleted_at
  ) values (
    p_history_id, v_task.patient_id, v_task.patient_email,
    coalesce(nullif(v_task.task_type, ''), 'task'),
    coalesce(nullif(v_task.task_data->>'title', ''), 'Tarefa concluída'),
    null, p_patient_effort, coalesce(p_patient_comment, ''),
    coalesce(nullif(v_task.task_data->>'icon', ''), '📌'), v_history_therapist_id,
    coalesce(v_task.completed_at, v_completed_at), p_date_group, v_task.id,
    'assigned_task_completion', v_task.task_data,
    v_task.therapeutic_plan_id, v_task.therapeutic_objective_id, v_task.therapeutic_program_id,
    v_task.clinical_target_id, v_task.clinical_link_snapshot, true, null
  )
  on conflict (id) do update set
    patient_id = excluded.patient_id,
    patient_email = excluded.patient_email,
    type = excluded.type,
    title = excluded.title,
    score = null,
    energy = excluded.energy,
    note = excluded.note,
    icon = excluded.icon,
    therapist_id = excluded.therapist_id,
    created_at = excluded.created_at,
    date_group = excluded.date_group,
    assigned_task_id = excluded.assigned_task_id,
    source = excluded.source,
    task_data = excluded.task_data,
    therapeutic_plan_id = excluded.therapeutic_plan_id,
    therapeutic_objective_id = excluded.therapeutic_objective_id,
    therapeutic_program_id = excluded.therapeutic_program_id,
    clinical_target_id = excluded.clinical_target_id,
    clinical_link_snapshot = excluded.clinical_link_snapshot,
    is_active = true,
    deleted_at = null
  returning * into v_history;

  insert into public.patient_portal_submission_audit(
    organization_id, clinic_id, patient_id, actor_user_id, resource_type, resource_id, action, idempotency_key
  ) values (
    v_clinic, v_clinic, v_task.patient_id, p_actor_user_id, 'assigned_task', v_task.id,
    'patient_task_completed', 'assigned-task-completion:' || v_task.id::text
  ) on conflict (idempotency_key) do nothing;

  return jsonb_build_object('task', to_jsonb(v_task), 'history', to_jsonb(v_history));
end;
$$;

revoke all on function public.complete_patient_assigned_task_v2(
  uuid, uuid, uuid, integer, text, text, text, text, timestamptz, uuid, text
) from public, anon, authenticated;
grant execute on function public.complete_patient_assigned_task_v2(
  uuid, uuid, uuid, integer, text, text, text, text, timestamptz, uuid, text
) to service_role;

notify pgrst, 'reload schema';

commit;
