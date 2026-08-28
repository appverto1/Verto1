-- Adult task canonical clinical-plan linkage.
-- Additive and fail-closed: no legacy rows are guessed/backfilled by names.

begin;

alter table public.assigned_tasks
  add column if not exists therapeutic_plan_id uuid,
  add column if not exists therapeutic_objective_id uuid,
  add column if not exists therapeutic_program_id text,
  add column if not exists clinical_target_id text,
  add column if not exists clinical_link_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists clinical_link_version smallint not null default 1;

alter table public.assigned_tasks
  drop constraint if exists assigned_tasks_clinical_link_version_check,
  add constraint assigned_tasks_clinical_link_version_check
    check (clinical_link_version >= 1 and clinical_link_version <= 100);

create index if not exists idx_assigned_tasks_clinical_plan
  on public.assigned_tasks(patient_id, therapeutic_plan_id, scheduled_at desc)
  where therapeutic_plan_id is not null;
create index if not exists idx_assigned_tasks_clinical_program
  on public.assigned_tasks(patient_id, therapeutic_program_id, scheduled_at desc)
  where therapeutic_program_id is not null;
create index if not exists idx_assigned_tasks_clinical_target
  on public.assigned_tasks(patient_id, clinical_target_id, scheduled_at desc)
  where clinical_target_id is not null;

alter table public.adult_task_reviews
  add column if not exists therapeutic_plan_id uuid,
  add column if not exists therapeutic_objective_id uuid,
  add column if not exists therapeutic_program_id text,
  add column if not exists clinical_target_id text,
  add column if not exists clinical_link_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists evidence_kind text not null default 'contextual_task_review';

alter table public.adult_task_reviews
  drop constraint if exists adult_task_reviews_evidence_kind_check,
  add constraint adult_task_reviews_evidence_kind_check
    check (evidence_kind in ('contextual_task_review'));

create index if not exists idx_adult_task_reviews_clinical_plan
  on public.adult_task_reviews(patient_id, therapeutic_plan_id, reviewed_at desc)
  where therapeutic_plan_id is not null;
create index if not exists idx_adult_task_reviews_clinical_program
  on public.adult_task_reviews(patient_id, therapeutic_program_id, reviewed_at desc)
  where therapeutic_program_id is not null;

alter table public.history
  add column if not exists therapeutic_plan_id uuid,
  add column if not exists therapeutic_objective_id uuid,
  add column if not exists therapeutic_program_id text,
  add column if not exists clinical_target_id text,
  add column if not exists clinical_link_snapshot jsonb not null default '{}'::jsonb;

create index if not exists idx_history_clinical_plan_context
  on public.history(patient_id, therapeutic_plan_id, created_at desc)
  where therapeutic_plan_id is not null and deleted_at is null;

create or replace function public.validate_assigned_task_clinical_link_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_plan public.patient_therapeutic_plans%rowtype;
  v_program public.aba_programs%rowtype;
  v_target public.aba_targets%rowtype;
  v_objective public.patient_therapeutic_objectives%rowtype;
begin
  if tg_op = 'UPDATE' and (
    new.therapeutic_plan_id is distinct from old.therapeutic_plan_id
    or new.therapeutic_objective_id is distinct from old.therapeutic_objective_id
    or new.therapeutic_program_id is distinct from old.therapeutic_program_id
    or new.clinical_target_id is distinct from old.clinical_target_id
    or new.clinical_link_snapshot is distinct from old.clinical_link_snapshot
    or new.clinical_link_version is distinct from old.clinical_link_version
  ) then
    raise exception 'ASSIGNED_TASK_CLINICAL_LINK_IMMUTABLE';
  end if;

  if new.therapeutic_plan_id is null
     and new.therapeutic_objective_id is null
     and nullif(trim(new.therapeutic_program_id), '') is null
     and nullif(trim(new.clinical_target_id), '') is null then
    return new;
  end if;

  if new.therapeutic_plan_id is null then
    raise exception 'ASSIGNED_TASK_CLINICAL_PLAN_REQUIRED';
  end if;
  if nullif(trim(new.therapeutic_program_id), '') is null then
    raise exception 'ASSIGNED_TASK_CLINICAL_PROGRAM_REQUIRED';
  end if;
  if nullif(trim(new.clinical_target_id), '') is null then
    raise exception 'ASSIGNED_TASK_CLINICAL_TARGET_REQUIRED';
  end if;

  select * into v_plan
  from public.patient_therapeutic_plans
  where id = new.therapeutic_plan_id
    and patient_id = new.patient_id
    and organization_id::text = new.clinic_id::text
    and clinic_id::text = new.clinic_id::text
    and status <> 'archived';
  if v_plan.id is null then
    raise exception 'ASSIGNED_TASK_CLINICAL_PLAN_SCOPE_INVALID';
  end if;

  if new.therapeutic_objective_id is not null then
    select * into v_objective
    from public.patient_therapeutic_objectives
    where id = new.therapeutic_objective_id
      and patient_id = new.patient_id
      and organization_id::text = new.clinic_id::text
      and clinic_id::text = new.clinic_id::text
      and status <> 'ARCHIVED';
    if v_objective.id is null then
      raise exception 'ASSIGNED_TASK_CLINICAL_OBJECTIVE_SCOPE_INVALID';
    end if;
  end if;

  if nullif(trim(new.therapeutic_program_id), '') is not null then
    select * into v_program
    from public.aba_programs
    where id = new.therapeutic_program_id
      and patient_id = new.patient_id
      and organization_id::text = new.clinic_id::text
      and clinic_id::text = new.clinic_id::text
      and therapeutic_plan_id = new.therapeutic_plan_id
      and status <> 'archived';
    if v_program.id is null then
      raise exception 'ASSIGNED_TASK_CLINICAL_PROGRAM_SCOPE_INVALID';
    end if;
    if new.therapeutic_objective_id is not null
       and v_program.therapeutic_objective_id is not null
       and v_program.therapeutic_objective_id is distinct from new.therapeutic_objective_id then
      raise exception 'ASSIGNED_TASK_CLINICAL_OBJECTIVE_PROGRAM_MISMATCH';
    end if;
  end if;

  if nullif(trim(new.clinical_target_id), '') is not null then
    select * into v_target
    from public.aba_targets
    where id = new.clinical_target_id
      and patient_id = new.patient_id
      and clinic_id::text = new.clinic_id::text
      and program_id = new.therapeutic_program_id;
    if v_target.id is null then
      raise exception 'ASSIGNED_TASK_CLINICAL_TARGET_SCOPE_INVALID';
    end if;
  end if;

  if jsonb_typeof(coalesce(new.clinical_link_snapshot, '{}'::jsonb)) <> 'object' then
    raise exception 'ASSIGNED_TASK_CLINICAL_SNAPSHOT_INVALID';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_assigned_task_clinical_link_v1 on public.assigned_tasks;
create trigger trg_validate_assigned_task_clinical_link_v1
before insert or update on public.assigned_tasks
for each row execute function public.validate_assigned_task_clinical_link_v1();

-- Keep patient completion atomic while projecting the immutable clinical linkage
-- into longitudinal history. Contextual task reviews remain separate from
-- quantitative Clinical Measurement V3 observations.
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

  begin v_clinic := v_task.clinic_id::uuid;
  exception when others then raise exception 'ASSIGNED_TASK_CLINIC_INVALID'; end;

  select p.clinic_id into v_patient_clinic
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
    assigned_task_id, source, task_data, therapeutic_plan_id, therapeutic_objective_id, therapeutic_program_id,
    clinical_target_id, clinical_link_snapshot, is_active, deleted_at
  ) values (
    p_history_id, v_task.patient_id, v_task.patient_email,
    coalesce(nullif(v_task.task_type, ''), 'task'),
    coalesce(nullif(v_task.task_data->>'title', ''), 'Tarefa concluída'),
    null, p_patient_effort, coalesce(p_patient_comment, ''),
    coalesce(nullif(v_task.task_data->>'icon', ''), '📌'), v_task.professional_id,
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

commit;
