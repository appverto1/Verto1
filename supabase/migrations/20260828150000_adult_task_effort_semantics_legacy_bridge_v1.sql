-- Adult task semantics + legacy bridge.
-- New adult completions use one explicit meaning:
--   0 = minimum perceived effort
--   100 = maximum perceived effort
-- Historical rows without the semantics marker remain untouched and must be treated as ambiguous legacy data.
-- Legacy `tasks` rows are never marked completed by the patient portal. Instead, completion is projected once
-- into canonical `assigned_tasks` and then completed atomically.

begin;

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
  v_semantics text := coalesce(nullif(trim(p_effort_semantics), ''), 'effort_min_0_max_100_v2');
begin
  if v_semantics <> 'effort_min_0_max_100_v2' then
    raise exception 'ASSIGNED_TASK_EFFORT_SEMANTICS_INVALID';
  end if;

  select *
  into v_task
  from public.assigned_tasks
  where id = p_task_id
  for update;

  if v_task.id is null then
    raise exception 'ASSIGNED_TASK_NOT_FOUND';
  end if;
  if p_expected_patient_id is null or v_task.patient_id is distinct from p_expected_patient_id then
    raise exception 'ASSIGNED_TASK_SCOPE_CHANGED';
  end if;
  if p_patient_effort is not null and (p_patient_effort < 0 or p_patient_effort > 100) then
    raise exception 'ASSIGNED_TASK_EFFORT_INVALID';
  end if;

  begin
    v_clinic := v_task.clinic_id::uuid;
  exception when others then
    raise exception 'ASSIGNED_TASK_CLINIC_INVALID';
  end;

  select p.clinic_id
  into v_patient_clinic
  from public.patients p
  where p.id = v_task.patient_id
    and coalesce(p.is_active, true)
    and p.deleted_at is null
  for share;

  if v_patient_clinic is null or v_patient_clinic is distinct from v_clinic then
    raise exception 'ASSIGNED_TASK_PATIENT_CLINIC_SCOPE_INVALID';
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
    assigned_task_id, source, task_data, is_active, deleted_at
  ) values (
    p_history_id,
    v_task.patient_id,
    v_task.patient_email,
    coalesce(nullif(v_task.task_type, ''), 'task'),
    coalesce(nullif(v_task.task_data->>'title', ''), 'Tarefa concluída'),
    null,
    p_patient_effort,
    coalesce(p_patient_comment, ''),
    coalesce(nullif(v_task.task_data->>'icon', ''), '📌'),
    v_task.professional_id,
    coalesce(v_task.completed_at, v_completed_at),
    p_date_group,
    v_task.id,
    'assigned_task_completion',
    v_task.task_data,
    true,
    null
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
    is_active = true,
    deleted_at = null
  returning * into v_history;

  insert into public.patient_portal_submission_audit(
    organization_id, clinic_id, patient_id, actor_user_id, resource_type, resource_id, action, idempotency_key
  ) values (
    v_clinic,
    v_clinic,
    v_task.patient_id,
    p_actor_user_id,
    'assigned_task',
    v_task.id,
    'patient_task_completed',
    'assigned-task-completion:' || v_task.id::text
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object('task', to_jsonb(v_task), 'history', to_jsonb(v_history));
end;
$$;

revoke all on function public.complete_patient_assigned_task_v2(
  uuid, uuid, uuid, integer, text, text, text, text, timestamptz, uuid, text
) from public, anon, authenticated;
grant execute on function public.complete_patient_assigned_task_v2(
  uuid, uuid, uuid, integer, text, text, text, text, timestamptz, uuid, text
) to service_role;

create or replace function public.complete_patient_legacy_task_v1(
  p_legacy_task_id text,
  p_assigned_task_id uuid,
  p_actor_user_id uuid,
  p_expected_patient_id uuid,
  p_expected_clinic_id uuid,
  p_patient_email text,
  p_professional_id text,
  p_task_type text,
  p_task_data jsonb,
  p_scheduled_at timestamptz,
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
  v_legacy_patient_id text;
  v_patient_clinic uuid;
  v_assigned public.assigned_tasks%rowtype;
  v_bridge_data jsonb;
begin
  if nullif(trim(p_legacy_task_id), '') is null
     or p_assigned_task_id is null
     or p_expected_patient_id is null
     or p_expected_clinic_id is null then
    raise exception 'LEGACY_TASK_SCOPE_INVALID';
  end if;

  select t.patient_id::text
  into v_legacy_patient_id
  from public.tasks t
  where t.id::text = p_legacy_task_id
  for update;

  if not found then
    raise exception 'LEGACY_TASK_NOT_FOUND';
  end if;
  if v_legacy_patient_id is distinct from p_expected_patient_id::text then
    raise exception 'LEGACY_TASK_SCOPE_CHANGED';
  end if;

  select p.clinic_id
  into v_patient_clinic
  from public.patients p
  where p.id = p_expected_patient_id
    and coalesce(p.is_active, true)
    and p.deleted_at is null
  for share;

  if v_patient_clinic is null or v_patient_clinic is distinct from p_expected_clinic_id then
    raise exception 'LEGACY_TASK_PATIENT_CLINIC_SCOPE_INVALID';
  end if;

  insert into public.assigned_tasks(
    id,
    clinic_id,
    patient_id,
    patient_email,
    professional_id,
    task_type,
    task_data,
    scheduled_at,
    status
  ) values (
    p_assigned_task_id,
    p_expected_clinic_id::text,
    p_expected_patient_id,
    nullif(trim(p_patient_email), ''),
    coalesce(nullif(trim(p_professional_id), ''), 'legacy-task-migration'),
    coalesce(nullif(trim(p_task_type), ''), 'task'),
    coalesce(p_task_data, '{}'::jsonb) || jsonb_build_object(
      'legacyTaskId', p_legacy_task_id,
      'legacy_task_id', p_legacy_task_id,
      'legacySource', 'tasks',
      'legacy_source', 'tasks'
    ),
    coalesce(p_scheduled_at, now()),
    'pending'
  )
  on conflict (id) do nothing;

  select *
  into v_assigned
  from public.assigned_tasks
  where id = p_assigned_task_id
  for update;

  if v_assigned.id is null
     or v_assigned.patient_id is distinct from p_expected_patient_id
     or v_assigned.clinic_id is distinct from p_expected_clinic_id::text then
    raise exception 'LEGACY_TASK_BRIDGE_SCOPE_INVALID';
  end if;

  v_bridge_data := public.complete_patient_assigned_task_v2(
    p_assigned_task_id,
    p_actor_user_id,
    p_expected_patient_id,
    p_patient_effort,
    p_patient_effort_emoji,
    p_patient_effort_label,
    p_effort_semantics,
    p_patient_comment,
    p_completed_at,
    p_history_id,
    p_date_group
  );

  return v_bridge_data;
end;
$$;

revoke all on function public.complete_patient_legacy_task_v1(
  text, uuid, uuid, uuid, uuid, text, text, text, jsonb, timestamptz,
  integer, text, text, text, text, timestamptz, uuid, text
) from public, anon, authenticated;
grant execute on function public.complete_patient_legacy_task_v1(
  text, uuid, uuid, uuid, uuid, text, text, text, jsonb, timestamptz,
  integer, text, text, text, text, timestamptz, uuid, text
) to service_role;

notify pgrst, 'reload schema';

commit;
