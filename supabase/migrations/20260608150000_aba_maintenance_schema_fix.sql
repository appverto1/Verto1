-- ABA Maintenance schema fix.
-- Aligns the legacy maintenance schedule table with the statuses and nullable
-- scheduling fields used by the application.

alter table public.aba_maintenance_schedules
  alter column scheduled_for drop not null;

alter table public.aba_maintenance_schedules
  add column if not exists source_mastery_evaluation_id text,
  add column if not exists interval_label text,
  add column if not exists due_date timestamptz,
  add column if not exists target_due_date timestamptz,
  add column if not exists appointment_id text,
  add column if not exists candidate_appointment_id text,
  add column if not exists schedule_mode text,
  add column if not exists sequence_index integer,
  add column if not exists window_start timestamptz,
  add column if not exists window_end timestamptz,
  add column if not exists completed_by text,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by text,
  add column if not exists created_by text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz,
  add column if not exists raw_payload jsonb not null default '{}'::jsonb;

update public.aba_maintenance_schedules
set metadata = coalesce(metadata, '{}'::jsonb),
    raw_payload = coalesce(raw_payload, '{}'::jsonb),
    updated_at = coalesce(updated_at, created_at, now()),
    due_date = coalesce(due_date, target_due_date, scheduled_for)
where metadata is null
   or raw_payload is null
   or updated_at is null
   or due_date is null;

alter table public.aba_maintenance_schedules
  drop constraint if exists aba_maintenance_schedules_status_check;

alter table public.aba_maintenance_schedules
  add constraint aba_maintenance_schedules_status_check
  check (status in (
    'PENDING',
    'PENDING_NEXT_SESSION',
    'PENDING_CONFIRMATION',
    'PENDING_LINK',
    'PENDING_SCHEDULING',
    'SCHEDULED',
    'SCHEDULED_BY_DATE',
    'UNSCHEDULED',
    'DUE_TODAY',
    'OVERDUE',
    'IN_MAINTENANCE',
    'AVAILABLE_IN_SESSION',
    'NEEDS_REVIEW',
    'WATCH',
    'REGRESSION_RISK',
    'COMPLETED',
    'MISSED',
    'CANCELLED',
    'ARCHIVED'
  ));

alter table public.aba_maintenance_schedules
  drop constraint if exists aba_maintenance_schedules_schedule_mode_check;

alter table public.aba_maintenance_schedules
  add constraint aba_maintenance_schedules_schedule_mode_check
  check (
    schedule_mode is null
    or schedule_mode in ('DEFAULT_SEQUENCE', 'CUSTOM_DATE', 'NEXT_PATIENT_SESSION', 'NEXT_AVAILABLE_SESSION')
  );

update public.aba_maintenance_schedules
set status = upper(raw_payload->>'originalStatus'),
    scheduled_for = case
      when upper(raw_payload->>'originalStatus') in ('PENDING_NEXT_SESSION', 'PENDING_LINK', 'PENDING_SCHEDULING', 'UNSCHEDULED')
        then null
      else scheduled_for
    end,
    due_date = case
      when upper(raw_payload->>'originalStatus') in ('PENDING_NEXT_SESSION', 'PENDING_LINK', 'PENDING_SCHEDULING', 'UNSCHEDULED')
        then null
      else due_date
    end,
    target_due_date = case
      when upper(raw_payload->>'originalStatus') = 'PENDING_NEXT_SESSION'
        then null
      else target_due_date
    end,
    schedule_mode = case
      when upper(raw_payload->>'originalStatus') = 'PENDING_NEXT_SESSION'
        then 'NEXT_PATIENT_SESSION'
      else schedule_mode
    end,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'schemaFixRestoredStatus', upper(raw_payload->>'originalStatus'),
      'schemaFixAppliedAt', now()
    ),
    raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object(
      'schemaFixRestoredStatus', upper(raw_payload->>'originalStatus'),
      'schemaFixAppliedAt', now()
    ),
    updated_at = now()
where status = 'PENDING'
  and lower(coalesce(raw_payload->>'legacyScheduleFallback', 'false')) = 'true'
  and upper(coalesce(raw_payload->>'originalStatus', '')) in (
    'PENDING_NEXT_SESSION',
    'PENDING_CONFIRMATION',
    'PENDING_LINK',
    'PENDING_SCHEDULING',
    'SCHEDULED',
    'SCHEDULED_BY_DATE',
    'UNSCHEDULED',
    'DUE_TODAY',
    'OVERDUE',
    'IN_MAINTENANCE',
    'AVAILABLE_IN_SESSION',
    'NEEDS_REVIEW',
    'WATCH',
    'REGRESSION_RISK'
  );

create index if not exists idx_aba_maintenance_schedules_org_patient_status_due_date
  on public.aba_maintenance_schedules (organization_id, patient_id, status, due_date);

create index if not exists idx_aba_maintenance_schedules_org_patient_target_status
  on public.aba_maintenance_schedules (organization_id, patient_id, target_id, status);

create index if not exists idx_aba_maintenance_schedules_org_appointment_id
  on public.aba_maintenance_schedules (organization_id, appointment_id)
  where appointment_id is not null;

create index if not exists idx_aba_maintenance_schedules_org_candidate_appointment
  on public.aba_maintenance_schedules (organization_id, candidate_appointment_id)
  where candidate_appointment_id is not null;

create or replace function public.aba_mark_pending_next_session_probe_candidate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.patient_id is null or new.id is null then
    return new;
  end if;

  if coalesce(new.is_active, true) = false
     or lower(coalesce(new.status, 'scheduled')) in ('cancelled', 'canceled', 'deleted') then
    return new;
  end if;

  update public.aba_maintenance_schedules s
  set status = 'PENDING_CONFIRMATION',
      candidate_appointment_id = new.id::text,
      metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
        'candidateAppointmentId', new.id::text,
        'candidateScheduledAt', new.scheduled_at,
        'pendingConfirmationPreviousStatus', s.status,
        'auditAction', 'MAINTENANCE_PROBE_PENDING_CONFIRMATION'
      ),
      raw_payload = coalesce(s.raw_payload, '{}'::jsonb) || jsonb_build_object(
        'candidateAppointmentId', new.id::text,
        'candidateScheduledAt', new.scheduled_at,
        'pendingConfirmationPreviousStatus', s.status,
        'humanMessage', 'Ha sondagem de manutencao pendente para esta consulta. Confirme antes de vincular.',
        'noSilentLink', true
      ),
      updated_at = now()
  where s.patient_id = new.patient_id
    and s.appointment_id is null
    and s.candidate_appointment_id is null
    and s.status = 'PENDING_NEXT_SESSION'
    and (
      new.organization_id is null
      or s.organization_id::text = new.organization_id::text
    );

  return new;
end;
$$;

drop trigger if exists trg_aba_mark_pending_next_session_probe_candidate on public.appointments;
create trigger trg_aba_mark_pending_next_session_probe_candidate
after insert or update of scheduled_at, status, is_active on public.appointments
for each row
execute function public.aba_mark_pending_next_session_probe_candidate();
