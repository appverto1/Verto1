-- ABA V2 Epic 11: auditable maintenance and regression monitoring.
-- Additive only. Maintenance probes can create alerts and summaries, but never
-- move a mastered target to REGRESSION_CONFIRMED without human review.

create extension if not exists pgcrypto;

alter table public.aba_targets
  add column if not exists clinical_status text not null default 'ACQUISITION'
    check (clinical_status in ('ACQUISITION', 'READY_FOR_REVIEW', 'MASTERED', 'MAINTENANCE', 'REGRESSION_RISK', 'REGRESSION_CONFIRMED'));

alter table public.aba_session_summaries
  add column if not exists maintenance_summary jsonb not null default '[]'::jsonb;

alter table public.aba_patient_aba_summaries
  add column if not exists maintenance_targets_count integer not null default 0,
  add column if not exists pending_maintenance_probes_count integer not null default 0,
  add column if not exists active_regression_risks_count integer not null default 0;

create table if not exists public.aba_maintenance_schedules (
  id text primary key default gen_random_uuid()::text,
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  target_id text not null,
  mastery_evaluation_id text not null,
  schedule_day integer not null,
  scheduled_for timestamptz not null,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'COMPLETED', 'MISSED', 'CANCELLED')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (schedule_day > 0)
);

create table if not exists public.aba_maintenance_probe_results (
  id text primary key default gen_random_uuid()::text,
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  target_id text not null,
  maintenance_schedule_id text references public.aba_maintenance_schedules(id) on delete set null,
  session_id text,
  occurred_at timestamptz not null default now(),
  total_trials integer not null default 0,
  independent_trials integer not null default 0,
  prompted_trials integer not null default 0,
  error_trials integer not null default 0,
  accuracy_percent numeric(6,2) not null default 0,
  independence_percent numeric(6,2) not null default 0,
  status text not null
    check (status in ('MAINTAINED', 'WATCH', 'REGRESSION_RISK')),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (total_trials >= 0),
  check (independent_trials >= 0),
  check (prompted_trials >= 0),
  check (error_trials >= 0),
  check (accuracy_percent >= 0 and accuracy_percent <= 100),
  check (independence_percent >= 0 and independence_percent <= 100)
);

create table if not exists public.aba_regression_alerts (
  id text primary key default gen_random_uuid()::text,
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  target_id text not null,
  maintenance_probe_result_id text references public.aba_maintenance_probe_results(id) on delete set null,
  severity text not null
    check (severity in ('LOW', 'MEDIUM', 'HIGH')),
  message text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text
);

create unique index if not exists idx_aba_maintenance_schedules_unique_day
  on public.aba_maintenance_schedules (target_id, mastery_evaluation_id, schedule_day);
create index if not exists idx_aba_maintenance_schedules_org_patient_due
  on public.aba_maintenance_schedules (organization_id, patient_id, status, scheduled_for);
create index if not exists idx_aba_maintenance_schedules_target_due
  on public.aba_maintenance_schedules (patient_id, target_id, status, scheduled_for);
create index if not exists idx_aba_maintenance_probe_results_org_patient_target
  on public.aba_maintenance_probe_results (organization_id, patient_id, target_id, occurred_at desc);
create index if not exists idx_aba_maintenance_probe_results_session
  on public.aba_maintenance_probe_results (session_id, occurred_at desc);
create index if not exists idx_aba_regression_alerts_org_patient_active
  on public.aba_regression_alerts (organization_id, patient_id, resolved_at, created_at desc);
create index if not exists idx_aba_regression_alerts_target_active
  on public.aba_regression_alerts (patient_id, target_id, resolved_at, created_at desc);
create index if not exists idx_aba_targets_clinical_status
  on public.aba_targets (organization_id, patient_id, clinical_status);

alter table public.aba_maintenance_schedules enable row level security;
alter table public.aba_maintenance_probe_results enable row level security;
alter table public.aba_regression_alerts enable row level security;

drop policy if exists aba_maintenance_schedules_patient_scope_rw on public.aba_maintenance_schedules;
create policy aba_maintenance_schedules_patient_scope_rw
on public.aba_maintenance_schedules
for all
to authenticated
using (
  exists (
    select 1
    from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_maintenance_schedules.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_maintenance_schedules.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_maintenance_schedules.clinic_id)
      )
  )
)
with check (
  exists (
    select 1
    from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_maintenance_schedules.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_maintenance_schedules.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_maintenance_schedules.clinic_id)
      )
  )
);

drop policy if exists aba_maintenance_probe_results_patient_scope_rw on public.aba_maintenance_probe_results;
create policy aba_maintenance_probe_results_patient_scope_rw
on public.aba_maintenance_probe_results
for all
to authenticated
using (
  exists (
    select 1
    from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_maintenance_probe_results.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_maintenance_probe_results.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_maintenance_probe_results.clinic_id)
      )
  )
)
with check (
  exists (
    select 1
    from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_maintenance_probe_results.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_maintenance_probe_results.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_maintenance_probe_results.clinic_id)
      )
  )
);

drop policy if exists aba_regression_alerts_patient_scope_rw on public.aba_regression_alerts;
create policy aba_regression_alerts_patient_scope_rw
on public.aba_regression_alerts
for all
to authenticated
using (
  exists (
    select 1
    from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_regression_alerts.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_regression_alerts.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_regression_alerts.clinic_id)
      )
  )
)
with check (
  exists (
    select 1
    from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_regression_alerts.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_regression_alerts.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_regression_alerts.clinic_id)
      )
  )
);

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
    insert into public.aba_maintenance_schedules (
      id,
      organization_id,
      clinic_id,
      patient_id,
      target_id,
      mastery_evaluation_id,
      schedule_day,
      scheduled_for,
      status,
      created_at
    )
    values (
      'maintenance-' || p_target_id || '-' || p_mastery_evaluation_id || '-' || v_day::text,
      coalesce(nullif(p_organization_id, ''), p_clinic_id),
      p_clinic_id,
      p_patient_id,
      p_target_id,
      p_mastery_evaluation_id,
      v_day,
      coalesce(p_approved_at, now()) + make_interval(days => v_day),
      'PENDING',
      now()
    )
    on conflict (target_id, mastery_evaluation_id, schedule_day) do nothing;
  end loop;
end;
$$;

create or replace function public.aba_schedule_maintenance_after_mastery_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days jsonb := null;
begin
  if upper(coalesce(new.new_status, '')) <> 'MASTERED' then
    return new;
  end if;

  select coalesce(criteria -> 'maintenance_days', criteria -> 'maintenanceDays')
  into v_days
  from public.aba_mastery_evaluations
  where id = new.evaluation_id
  limit 1;

  perform public.aba_create_maintenance_schedules_for_mastery(
    new.organization_id,
    new.clinic_id,
    new.patient_id,
    new.target_id,
    new.evaluation_id,
    coalesce(new.changed_at, now()),
    v_days
  );
  return new;
end;
$$;

drop trigger if exists trg_aba_schedule_maintenance_after_mastery_audit on public.aba_target_status_audit_logs;
create trigger trg_aba_schedule_maintenance_after_mastery_audit
after insert on public.aba_target_status_audit_logs
for each row
execute function public.aba_schedule_maintenance_after_mastery_audit();

create or replace function public.aba_audit_target_clinical_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.clinical_status is not distinct from new.clinical_status then
    return new;
  end if;
  if upper(coalesce(new.clinical_status, '')) not in ('MASTERED', 'MAINTENANCE', 'REGRESSION_CONFIRMED') then
    return new;
  end if;

  insert into public.aba_target_status_audit_logs (
    id,
    organization_id,
    clinic_id,
    patient_id,
    target_id,
    previous_status,
    new_status,
    evaluation_id,
    changed_by,
    changed_at,
    reason,
    created_at
  )
  values (
    'target-status-' || new.id || '-' || extract(epoch from now())::bigint::text,
    coalesce(nullif(new.organization_id, ''), new.clinic_id),
    new.clinic_id,
    new.patient_id,
    new.id,
    old.clinical_status,
    new.clinical_status,
    'target-status-change-' || new.id || '-' || extract(epoch from now())::bigint::text,
    coalesce(auth.uid()::text, new.created_by, 'system'),
    now(),
    'Mudanca de status clinico sensivel exige auditoria humana.',
    now()
  );
  return new;
end;
$$;

drop trigger if exists trg_aba_audit_target_clinical_status_change on public.aba_targets;
create trigger trg_aba_audit_target_clinical_status_change
after update of clinical_status on public.aba_targets
for each row
execute function public.aba_audit_target_clinical_status_change();

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
    and status in ('PENDING', 'COMPLETED');

  select count(*)
  into v_pending_probes
  from public.aba_maintenance_schedules
  where patient_id = p_patient_id
    and status = 'PENDING';

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

create or replace function public.aba_refresh_maintenance_summary_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.aba_refresh_patient_maintenance_summary(new.patient_id);
  return new;
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
        completed_at = coalesce(new.occurred_at, now())
    where id = new.maintenance_schedule_id
      and status = 'PENDING';
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
      when v_failure_count >= 2 then v_failure_count::text || ' probes consecutivos abaixo do criterio. Sugerir retorno para aquisicao somente apos revisao humana.'
      else 'Risco de regressao em maintenance probe. Revisao humana obrigatoria antes de qualquer mudanca de status.'
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

drop trigger if exists trg_aba_regression_alert_after_probe_result on public.aba_maintenance_probe_results;
create trigger trg_aba_regression_alert_after_probe_result
after insert on public.aba_maintenance_probe_results
for each row
execute function public.aba_regression_alert_after_probe_result();

drop trigger if exists trg_aba_refresh_maintenance_summary_after_schedule on public.aba_maintenance_schedules;
create trigger trg_aba_refresh_maintenance_summary_after_schedule
after insert or update on public.aba_maintenance_schedules
for each row
execute function public.aba_refresh_maintenance_summary_trigger();

drop trigger if exists trg_aba_refresh_maintenance_summary_after_alert on public.aba_regression_alerts;
create trigger trg_aba_refresh_maintenance_summary_after_alert
after insert or update on public.aba_regression_alerts
for each row
execute function public.aba_refresh_maintenance_summary_trigger();
