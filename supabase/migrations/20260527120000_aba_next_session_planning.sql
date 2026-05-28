-- ABA next-session planning and flexible maintenance scheduling.
-- Additive only. Recommendations are assistive, deterministic and require human approval.

create extension if not exists pgcrypto;

alter table public.appointments
  add column if not exists organization_id uuid,
  add column if not exists deleted_at timestamptz,
  add column if not exists is_active boolean default true;

alter table public.aba_maintenance_schedules
  add column if not exists target_due_date timestamptz,
  add column if not exists appointment_id text,
  add column if not exists source_mastery_evaluation_id text,
  add column if not exists schedule_mode text not null default 'DEFAULT_SEQUENCE',
  add column if not exists sequence_index integer,
  add column if not exists interval_label text,
  add column if not exists window_start timestamptz,
  add column if not exists window_end timestamptz,
  add column if not exists completed_by text,
  add column if not exists created_by text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists raw_payload jsonb not null default '{}'::jsonb;

alter table public.aba_maintenance_schedules
  alter column scheduled_for drop not null;

update public.aba_maintenance_schedules
set target_due_date = coalesce(target_due_date, scheduled_for),
    source_mastery_evaluation_id = coalesce(source_mastery_evaluation_id, mastery_evaluation_id),
    interval_label = coalesce(interval_label, schedule_day::text || ' dias'),
    updated_at = coalesce(updated_at, created_at, now())
where target_due_date is null;

update public.aba_maintenance_schedules
set source_mastery_evaluation_id = coalesce(source_mastery_evaluation_id, mastery_evaluation_id),
    interval_label = coalesce(interval_label, schedule_day::text || ' dias'),
    updated_at = coalesce(updated_at, created_at, now())
where source_mastery_evaluation_id is null
   or interval_label is null;

alter table public.aba_maintenance_schedules
  drop constraint if exists aba_maintenance_schedules_status_check;

alter table public.aba_maintenance_schedules
  add constraint aba_maintenance_schedules_status_check
  check (status in ('PENDING', 'SCHEDULED', 'UNSCHEDULED', 'DUE_TODAY', 'OVERDUE', 'COMPLETED', 'MISSED', 'CANCELLED'));

alter table public.aba_maintenance_schedules
  drop constraint if exists aba_maintenance_schedules_schedule_mode_check;

alter table public.aba_maintenance_schedules
  add constraint aba_maintenance_schedules_schedule_mode_check
  check (schedule_mode in ('DEFAULT_SEQUENCE', 'CUSTOM_DATE', 'NEXT_PATIENT_SESSION', 'NEXT_AVAILABLE_SESSION'));

create index if not exists idx_aba_maintenance_schedules_org_patient_target_status_due
  on public.aba_maintenance_schedules (organization_id, patient_id, target_id, status, scheduled_for);

create index if not exists idx_aba_maintenance_schedules_target_due_date
  on public.aba_maintenance_schedules (organization_id, patient_id, target_id, status, target_due_date);

create index if not exists idx_aba_maintenance_schedules_org_appointment_status
  on public.aba_maintenance_schedules (organization_id, appointment_id, status);

create index if not exists idx_aba_maintenance_probe_results_org_patient_target_created
  on public.aba_maintenance_probe_results (organization_id, patient_id, target_id, created_at desc);

create unique index if not exists idx_aba_maintenance_schedules_active_unique
  on public.aba_maintenance_schedules (
    organization_id,
    patient_id,
    target_id,
    schedule_day,
    coalesce(appointment_id, ''),
    coalesce(scheduled_for, target_due_date)
  )
  where status in ('PENDING', 'SCHEDULED', 'UNSCHEDULED', 'DUE_TODAY', 'OVERDUE');

create table if not exists public.aba_next_session_focuses (
  id text primary key default gen_random_uuid()::text,
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  source_session_id text,
  focus_type text not null
    check (focus_type in ('MAINTENANCE', 'NEW_SKILLS', 'BEHAVIOR_REDUCTION', 'GENERALIZATION', 'MASTERY_REVIEW', 'BALANCED')),
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'GENERATED', 'ACCEPTED', 'CANCELLED')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aba_clinical_recommendations (
  id text primary key default gen_random_uuid()::text,
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  source_session_id text,
  next_session_focus_id text references public.aba_next_session_focuses(id) on delete set null,
  recommendation_type text not null
    check (recommendation_type in (
      'MAINTENANCE_PROBE',
      'REGRESSION_ATTENTION',
      'MASTERY_REVIEW',
      'CONTINUE_TRAINING',
      'INTRODUCE_NEW_TARGET',
      'BEHAVIOR_MONITORING',
      'ABC_COLLECTION',
      'PROMPT_FADING',
      'GENERALIZATION'
    )),
  priority text not null
    check (priority in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  title text not null,
  summary text not null,
  rationale text not null,
  suggested_action text not null,
  target_id text,
  behavior_id text,
  program_id text,
  domain text,
  metric_name text,
  previous_value numeric,
  current_value numeric,
  delta_value numeric,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'SUGGESTED'
    check (status in ('SUGGESTED', 'ACCEPTED', 'EDITED', 'REJECTED', 'APPLIED_TO_NEXT_SESSION', 'EXPIRED')),
  accepted_by text,
  accepted_at timestamptz,
  rejected_by text,
  rejected_at timestamptz,
  edited_from_id text references public.aba_clinical_recommendations(id) on delete set null,
  context_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aba_next_session_plan_items (
  id text primary key default gen_random_uuid()::text,
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  source_session_id text,
  source_recommendation_id text references public.aba_clinical_recommendations(id) on delete set null,
  target_id text,
  behavior_id text,
  planned_trial_type text,
  planned_prompt text,
  priority text not null default 'MEDIUM'
    check (priority in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  instructions text not null,
  status text not null default 'PLANNED'
    check (status in ('PLANNED', 'USED_IN_SESSION', 'SKIPPED', 'CANCELLED')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aba_clinical_recommendation_audit_logs (
  id text primary key default gen_random_uuid()::text,
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  recommendation_id text not null references public.aba_clinical_recommendations(id) on delete cascade,
  action text not null
    check (action in ('GENERATED', 'ACCEPTED', 'EDITED', 'REJECTED', 'APPLIED_TO_NEXT_SESSION', 'EXPIRED')),
  previous_status text,
  new_status text,
  performed_by text,
  performed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_aba_clinical_recommendations_context
  on public.aba_clinical_recommendations (organization_id, patient_id, source_session_id, context_hash);

create index if not exists idx_aba_clinical_recommendations_status_created
  on public.aba_clinical_recommendations (organization_id, patient_id, status, created_at);

create index if not exists idx_aba_next_session_plan_items_status_created
  on public.aba_next_session_plan_items (organization_id, patient_id, status, created_at);

create index if not exists idx_aba_regression_alerts_org_patient_target_resolved
  on public.aba_regression_alerts (organization_id, patient_id, target_id, resolved_at);

create index if not exists idx_aba_session_metric_snapshots_org_patient_session_type
  on public.aba_session_metric_snapshots (organization_id, patient_id, session_id, metric_type);

create index if not exists idx_aba_mastery_evaluations_org_patient_target_evaluated
  on public.aba_mastery_evaluations (organization_id, patient_id, target_id, evaluated_at);

alter table public.aba_next_session_focuses enable row level security;
alter table public.aba_clinical_recommendations enable row level security;
alter table public.aba_next_session_plan_items enable row level security;
alter table public.aba_clinical_recommendation_audit_logs enable row level security;

drop policy if exists aba_next_session_focuses_patient_scope_rw on public.aba_next_session_focuses;
create policy aba_next_session_focuses_patient_scope_rw
on public.aba_next_session_focuses
for all
to authenticated
using (
  exists (
    select 1
    from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_next_session_focuses.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_next_session_focuses.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_next_session_focuses.clinic_id)
      )
  )
)
with check (
  exists (
    select 1
    from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_next_session_focuses.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_next_session_focuses.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_next_session_focuses.clinic_id)
      )
  )
);

drop policy if exists aba_clinical_recommendations_patient_scope_rw on public.aba_clinical_recommendations;
create policy aba_clinical_recommendations_patient_scope_rw
on public.aba_clinical_recommendations
for all
to authenticated
using (
  exists (
    select 1
    from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_clinical_recommendations.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_clinical_recommendations.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_clinical_recommendations.clinic_id)
      )
  )
)
with check (
  exists (
    select 1
    from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_clinical_recommendations.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_clinical_recommendations.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_clinical_recommendations.clinic_id)
      )
  )
);

drop policy if exists aba_next_session_plan_items_patient_scope_rw on public.aba_next_session_plan_items;
create policy aba_next_session_plan_items_patient_scope_rw
on public.aba_next_session_plan_items
for all
to authenticated
using (
  exists (
    select 1
    from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_next_session_plan_items.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_next_session_plan_items.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_next_session_plan_items.clinic_id)
      )
  )
)
with check (
  exists (
    select 1
    from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_next_session_plan_items.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_next_session_plan_items.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_next_session_plan_items.clinic_id)
      )
  )
);

drop policy if exists aba_clinical_recommendation_audit_logs_patient_scope_rw on public.aba_clinical_recommendation_audit_logs;
create policy aba_clinical_recommendation_audit_logs_patient_scope_rw
on public.aba_clinical_recommendation_audit_logs
for all
to authenticated
using (
  exists (
    select 1
    from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_clinical_recommendation_audit_logs.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_clinical_recommendation_audit_logs.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_clinical_recommendation_audit_logs.clinic_id)
      )
  )
)
with check (
  exists (
    select 1
    from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_clinical_recommendation_audit_logs.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_clinical_recommendation_audit_logs.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_clinical_recommendation_audit_logs.clinic_id)
      )
  )
);

create or replace function public.aba_maintenance_probe_tolerance_bounds(
  p_schedule_day integer,
  p_target_due_date timestamptz,
  out window_start timestamptz,
  out window_end timestamptz
)
returns record
language plpgsql
immutable
as $$
declare
  v_before integer := 10;
  v_after integer := 14;
begin
  if coalesce(p_schedule_day, 0) <= 7 then
    v_before := 1;
    v_after := 3;
  elsif p_schedule_day <= 14 then
    v_before := 2;
    v_after := 4;
  elsif p_schedule_day <= 30 then
    v_before := 5;
    v_after := 7;
  end if;
  window_start := p_target_due_date - make_interval(days => v_before);
  window_end := p_target_due_date + make_interval(days => v_after);
end;
$$;

create or replace function public.aba_find_best_appointment_for_maintenance_probe(
  p_organization_id text,
  p_patient_id uuid,
  p_target_due_date timestamptz,
  p_schedule_day integer default 7,
  p_limit integer default 20,
  p_clinic_id text default null
)
returns table (
  appointment_id text,
  scheduled_for timestamptz,
  match_type text
)
language sql
stable
set search_path = public
as $$
  with bounds as (
    select b.window_start, b.window_end
    from public.aba_maintenance_probe_tolerance_bounds(p_schedule_day, p_target_due_date) as b
  ),
  candidates as (
    select
      a.id::text as appointment_id,
      a.scheduled_at as scheduled_for,
      case
        when a.scheduled_at >= p_target_due_date then 'AFTER_TARGET_DUE_DATE'
        else 'BEFORE_TARGET_DUE_DATE'
      end as match_type,
      case when a.scheduled_at >= p_target_due_date then 0 else 1 end as direction_rank,
      abs(extract(epoch from (a.scheduled_at - p_target_due_date))) as distance_seconds
    from public.appointments a
    cross join bounds
    where a.patient_id = p_patient_id
      and a.scheduled_at is not null
      and a.scheduled_at >= bounds.window_start
      and a.scheduled_at <= bounds.window_end
      and coalesce(a.is_active, true) = true
      and a.deleted_at is null
      and lower(coalesce(a.status, 'scheduled')) not in ('cancelled', 'canceled', 'deleted')
      and (
        nullif(p_organization_id, '') is null
        or a.organization_id::text = p_organization_id
        or a.clinic_id::text = p_organization_id
      )
      and (
        nullif(p_clinic_id, '') is null
        or a.clinic_id::text = p_clinic_id
      )
    order by direction_rank asc, distance_seconds asc, scheduled_for asc
    limit greatest(1, least(coalesce(p_limit, 20), 50))
  )
  select candidates.appointment_id, candidates.scheduled_for, candidates.match_type
  from candidates
  limit 1;
$$;

create or replace function public.aba_create_maintenance_schedules_for_mastery(
  p_organization_id text,
  p_clinic_id text,
  p_patient_id uuid,
  p_target_id text,
  p_mastery_evaluation_id text,
  p_approved_at timestamptz default now(),
  p_maintenance_days jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer[] := array[7, 14, 30, 60];
  v_day integer;
  v_target_due_date timestamptz;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_appointment_id text;
  v_scheduled_for timestamptz;
  v_status text;
begin
  if p_patient_id is null or nullif(p_target_id, '') is null or nullif(p_mastery_evaluation_id, '') is null then
    return;
  end if;

  if p_maintenance_days is not null and jsonb_typeof(p_maintenance_days) = 'array' then
    select array_agg(distinct greatest(1, value::integer) order by greatest(1, value::integer))
    into v_days
    from jsonb_array_elements_text(p_maintenance_days)
    where value ~ '^[0-9]+$';
  end if;
  if coalesce(array_length(v_days, 1), 0) = 0 then
    v_days := array[7, 14, 30, 60];
  end if;

  foreach v_day in array v_days loop
    v_target_due_date := coalesce(p_approved_at, now()) + make_interval(days => v_day);
    select b.window_start, b.window_end
    into v_window_start, v_window_end
    from public.aba_maintenance_probe_tolerance_bounds(v_day, v_target_due_date) as b;

    select a.appointment_id, a.scheduled_for
    into v_appointment_id, v_scheduled_for
    from public.aba_find_best_appointment_for_maintenance_probe(
      coalesce(nullif(p_organization_id, ''), p_clinic_id),
      p_patient_id,
      v_target_due_date,
      v_day,
      20,
      p_clinic_id
    ) as a
    limit 1;

    v_status := case when v_appointment_id is null then 'UNSCHEDULED' else 'SCHEDULED' end;

    insert into public.aba_maintenance_schedules (
      id,
      organization_id,
      clinic_id,
      patient_id,
      target_id,
      mastery_evaluation_id,
      source_mastery_evaluation_id,
      schedule_day,
      interval_label,
      target_due_date,
      scheduled_for,
      appointment_id,
      schedule_mode,
      sequence_index,
      window_start,
      window_end,
      status,
      raw_payload,
      created_at,
      updated_at
    )
    values (
      'maintenance-' || p_target_id || '-' || p_mastery_evaluation_id || '-' || v_day::text,
      coalesce(nullif(p_organization_id, ''), p_clinic_id),
      p_clinic_id,
      p_patient_id,
      p_target_id,
      p_mastery_evaluation_id,
      p_mastery_evaluation_id,
      v_day,
      v_day::text || ' dias',
      v_target_due_date,
      v_scheduled_for,
      v_appointment_id,
      'DEFAULT_SEQUENCE',
      array_position(v_days, v_day),
      v_window_start,
      v_window_end,
      v_status,
      jsonb_build_object('target_due_date', v_target_due_date, 'appointment_id', v_appointment_id, 'scheduled_for', v_scheduled_for),
      now(),
      now()
    )
    on conflict (target_id, mastery_evaluation_id, schedule_day) do update set
      target_due_date = excluded.target_due_date,
      scheduled_for = coalesce(public.aba_maintenance_schedules.scheduled_for, excluded.scheduled_for),
      appointment_id = coalesce(public.aba_maintenance_schedules.appointment_id, excluded.appointment_id),
      source_mastery_evaluation_id = coalesce(public.aba_maintenance_schedules.source_mastery_evaluation_id, excluded.source_mastery_evaluation_id),
      schedule_mode = excluded.schedule_mode,
      sequence_index = excluded.sequence_index,
      interval_label = excluded.interval_label,
      window_start = excluded.window_start,
      window_end = excluded.window_end,
      status = case
        when public.aba_maintenance_schedules.status in ('COMPLETED', 'CANCELLED') then public.aba_maintenance_schedules.status
        when coalesce(public.aba_maintenance_schedules.appointment_id, excluded.appointment_id) is null then 'UNSCHEDULED'
        else 'SCHEDULED'
      end,
      raw_payload = excluded.raw_payload,
      updated_at = now();
  end loop;
end;
$$;

create or replace function public.aba_refresh_patient_maintenance_summary(p_patient_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org text;
  v_clinic text;
  v_maintenance_targets integer := 0;
  v_pending_probes integer := 0;
  v_active_risks integer := 0;
begin
  if p_patient_id is null then
    return;
  end if;

  select organization_id, clinic_id
  into v_org, v_clinic
  from (
    select organization_id, clinic_id, created_at from public.aba_maintenance_schedules where patient_id = p_patient_id
    union all
    select organization_id, clinic_id, created_at from public.aba_maintenance_probe_results where patient_id = p_patient_id
    union all
    select organization_id, clinic_id, created_at from public.aba_regression_alerts where patient_id = p_patient_id
  ) source_rows
  order by created_at desc
  limit 1;

  if v_clinic is null then
    return;
  end if;

  select count(distinct target_id)
  into v_maintenance_targets
  from public.aba_maintenance_schedules
  where patient_id = p_patient_id
    and status in ('PENDING', 'SCHEDULED', 'UNSCHEDULED', 'DUE_TODAY', 'OVERDUE', 'COMPLETED', 'MISSED');

  select count(*)
  into v_pending_probes
  from public.aba_maintenance_schedules
  where patient_id = p_patient_id
    and status in ('PENDING', 'SCHEDULED', 'UNSCHEDULED', 'DUE_TODAY', 'OVERDUE', 'MISSED');

  select count(*)
  into v_active_risks
  from public.aba_regression_alerts
  where patient_id = p_patient_id
    and resolved_at is null;

  insert into public.aba_patient_aba_summaries (
    id,
    organization_id,
    clinic_id,
    patient_id,
    maintenance_targets_count,
    pending_maintenance_probes_count,
    active_regression_risks_count,
    updated_at
  )
  values (
    'patient-' || p_patient_id::text,
    coalesce(nullif(v_org, ''), v_clinic),
    v_clinic,
    p_patient_id,
    v_maintenance_targets,
    v_pending_probes,
    v_active_risks,
    now()
  )
  on conflict (patient_id) do update set
    organization_id = excluded.organization_id,
    clinic_id = excluded.clinic_id,
    maintenance_targets_count = excluded.maintenance_targets_count,
    pending_maintenance_probes_count = excluded.pending_maintenance_probes_count,
    active_regression_risks_count = excluded.active_regression_risks_count,
    updated_at = now();
end;
$$;

create or replace function public.aba_regression_alert_after_probe_result()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_failure_count integer := 0;
  v_severity text := 'LOW';
  v_message text;
begin
  if new.maintenance_schedule_id is not null then
    update public.aba_maintenance_schedules
    set status = 'COMPLETED',
        completed_at = coalesce(new.occurred_at, now()),
        updated_at = now()
    where id = new.maintenance_schedule_id
      and status in ('PENDING', 'SCHEDULED', 'UNSCHEDULED', 'DUE_TODAY', 'OVERDUE', 'MISSED');
  end if;

  select count(*)
  into v_failure_count
  from (
    select status
    from public.aba_maintenance_probe_results
    where patient_id = new.patient_id
      and target_id = new.target_id
    order by occurred_at desc
    limit 2
  ) recent_results
  where status in ('WATCH', 'REGRESSION_RISK');

  if new.status = 'REGRESSION_RISK' or v_failure_count >= 2 then
    v_severity := case
      when new.status = 'REGRESSION_RISK' and v_failure_count >= 2 then 'HIGH'
      when new.status = 'REGRESSION_RISK' then 'MEDIUM'
      else 'LOW'
    end;
    v_message := case
      when v_failure_count >= 2 then v_failure_count::text || ' probes consecutivos abaixo do criterio. Revisao humana antes de retorno para aquisicao.'
      else 'Risco de regressao em maintenance probe. Revisao humana antes de qualquer mudanca de status.'
    end;

    insert into public.aba_regression_alerts (
      id,
      organization_id,
      clinic_id,
      patient_id,
      target_id,
      maintenance_probe_result_id,
      severity,
      message,
      created_at
    )
    values (
      'regression-alert-' || new.id,
      new.organization_id,
      new.clinic_id,
      new.patient_id,
      new.target_id,
      new.id,
      v_severity,
      v_message,
      now()
    )
    on conflict (id) do nothing;
  end if;

  perform public.aba_refresh_patient_maintenance_summary(new.patient_id);
  return new;
end;
$$;
