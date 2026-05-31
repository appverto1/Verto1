-- Maintenance Probe pending confirmation flow.
-- Additive only: preserves existing schedules and legacy UNSCHEDULED status.

alter table public.aba_maintenance_schedules
  add column if not exists candidate_appointment_id text,
  add column if not exists due_date timestamptz,
  add column if not exists schedule_reason text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by text;

update public.aba_maintenance_schedules
set due_date = coalesce(due_date, scheduled_for, target_due_date),
    metadata = coalesce(metadata, '{}'::jsonb),
    updated_at = coalesce(updated_at, now())
where due_date is null
   or metadata is null;

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
    'UNSCHEDULED',
    'DUE_TODAY',
    'OVERDUE',
    'COMPLETED',
    'MISSED',
    'CANCELLED'
  ));

create index if not exists idx_aba_maintenance_schedules_org_patient_status_due_date
  on public.aba_maintenance_schedules (organization_id, patient_id, status, due_date);

create index if not exists idx_aba_maintenance_schedules_org_candidate_appointment
  on public.aba_maintenance_schedules (organization_id, candidate_appointment_id)
  where candidate_appointment_id is not null;

create index if not exists idx_aba_maintenance_schedules_org_appointment_id
  on public.aba_maintenance_schedules (organization_id, appointment_id)
  where appointment_id is not null;

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
