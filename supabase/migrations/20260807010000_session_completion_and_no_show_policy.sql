-- Verto: encerramento atômico de sessão, presença e política configurável de falta.
-- Migration aditiva e idempotente. Não remove registros clínicos, financeiros ou históricos.

begin;

create extension if not exists pgcrypto;

alter table if exists public.clinics
  add column if not exists auto_no_show_enabled boolean,
  add column if not exists no_show_tolerance_minutes integer,
  add column if not exists no_show_mode text;

update public.clinics
set
  auto_no_show_enabled = coalesce(auto_no_show_enabled, true),
  no_show_tolerance_minutes = coalesce(no_show_tolerance_minutes, 30),
  no_show_mode = coalesce(nullif(upper(trim(no_show_mode)), ''), 'AUTO');

alter table if exists public.clinics
  alter column auto_no_show_enabled set default true,
  alter column auto_no_show_enabled set not null,
  alter column no_show_tolerance_minutes set default 30,
  alter column no_show_tolerance_minutes set not null,
  alter column no_show_mode set default 'AUTO',
  alter column no_show_mode set not null;

do $$
begin
  if to_regclass('public.clinics') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.clinics'::regclass
         and conname = 'clinics_no_show_tolerance_minutes_check'
     ) then
    alter table public.clinics
      add constraint clinics_no_show_tolerance_minutes_check
      check (no_show_tolerance_minutes between 5 and 180) not valid;
  end if;

  if to_regclass('public.clinics') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.clinics'::regclass
         and conname = 'clinics_no_show_mode_check'
     ) then
    alter table public.clinics
      add constraint clinics_no_show_mode_check
      check (no_show_mode in ('AUTO', 'REVIEW')) not valid;
  end if;
end
$$;

alter table if exists public.appointments
  add column if not exists attendance_status text,
  add column if not exists active_aba_session_id text,
  add column if not exists session_start_previous_status text,
  add column if not exists no_show_classified_at timestamptz,
  add column if not exists no_show_policy_minutes integer,
  add column if not exists no_show_source text,
  add column if not exists no_show_previous_status text,
  add column if not exists no_show_review_required_at timestamptz,
  add column if not exists no_show_reopened_at timestamptz,
  add column if not exists no_show_reopened_by uuid references public.users(id) on delete set null,
  add column if not exists no_show_reopen_reason text;

do $$
begin
  if to_regclass('public.appointments') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.appointments'::regclass
         and conname = 'appointments_attendance_status_check'
     ) then
    alter table public.appointments
      add constraint appointments_attendance_status_check
      check (
        attendance_status is null
        or attendance_status in (
          'ATTENDED', 'LATE', 'PARTIAL', 'NO_SHOW',
          'CANCELLED_PATIENT', 'CANCELLED_CLINIC', 'PENDING_REVIEW'
        )
      ) not valid;
  end if;
end
$$;

alter table if exists public.aba_sessions
  add column if not exists attendance_status text;

alter table if exists public.aba_session_summaries
  add column if not exists attendance_status text,
  add column if not exists billing_status text;

do $$
begin
  if to_regclass('public.aba_sessions') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.aba_sessions'::regclass
         and conname = 'aba_sessions_attendance_status_check'
     ) then
    alter table public.aba_sessions
      add constraint aba_sessions_attendance_status_check
      check (
        attendance_status is null
        or attendance_status in (
          'ATTENDED', 'LATE', 'PARTIAL', 'NO_SHOW',
          'CANCELLED_PATIENT', 'CANCELLED_CLINIC'
        )
      ) not valid;
  end if;

  if to_regclass('public.aba_session_summaries') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.aba_session_summaries'::regclass
         and conname = 'aba_session_summaries_attendance_status_check'
     ) then
    alter table public.aba_session_summaries
      add constraint aba_session_summaries_attendance_status_check
      check (
        attendance_status is null
        or attendance_status in (
          'ATTENDED', 'LATE', 'PARTIAL', 'NO_SHOW',
          'CANCELLED_PATIENT', 'CANCELLED_CLINIC'
        )
      ) not valid;
  end if;
end
$$;

create index if not exists appointments_auto_no_show_scan_idx
  on public.appointments (clinic_id, scheduled_start_at, status)
  where deleted_at is null
    and coalesce(is_active, true) = true
    and actual_start_at is null
    and no_show_classified_at is null;

create index if not exists appointments_active_aba_session_idx
  on public.appointments (active_aba_session_id)
  where active_aba_session_id is not null;

create index if not exists aba_sessions_appointment_status_idx
  on public.aba_sessions (appointment_id, status, updated_at desc)
  where appointment_id is not null;

create table if not exists public.appointment_attendance_audit_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  session_id text,
  actor_id uuid references public.users(id) on delete set null,
  action text not null,
  previous_status text,
  new_status text,
  attendance_status text,
  reason text,
  idempotency_key text,
  payload_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists appointment_attendance_audit_idempotency_idx
  on public.appointment_attendance_audit_events (clinic_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists appointment_attendance_audit_lookup_idx
  on public.appointment_attendance_audit_events (clinic_id, appointment_id, created_at desc);

alter table public.appointment_attendance_audit_events enable row level security;
revoke all on public.appointment_attendance_audit_events from anon, authenticated;
grant select, insert on public.appointment_attendance_audit_events to service_role;

create table if not exists public.aba_session_completion_operations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  session_id text not null,
  appointment_id uuid references public.appointments(id) on delete set null,
  actor_id uuid not null references public.users(id) on delete restrict,
  idempotency_key text not null,
  payload_hash text not null,
  response_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (clinic_id, idempotency_key)
);

create index if not exists aba_session_completion_operations_session_idx
  on public.aba_session_completion_operations (clinic_id, session_id, created_at desc);

alter table public.aba_session_completion_operations enable row level security;
revoke all on public.aba_session_completion_operations from anon, authenticated;
grant select, insert on public.aba_session_completion_operations to service_role;

create or replace function public.verto_clinic_actor_role_v1(
  p_actor_id uuid,
  p_clinic_id uuid
) returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(
    case when clinic.owner_user_id = p_actor_id then 'owner' end,
    nullif(membership.role, ''),
    case when actor.clinic_id = clinic.id then nullif(actor.role, '') end,
    ''
  ))
  from public.clinics clinic
  left join public.clinic_memberships membership
    on membership.clinic_id = clinic.id
   and membership.user_id = p_actor_id
   and lower(coalesce(membership.status, 'active')) = 'active'
  left join public.users actor
    on actor.id = p_actor_id
  where clinic.id = p_clinic_id
    and (
      clinic.owner_user_id = p_actor_id
      or membership.user_id is not null
      or actor.clinic_id = clinic.id
    )
  limit 1
$$;

revoke all on function public.verto_clinic_actor_role_v1(uuid,uuid) from public, anon, authenticated;
grant execute on function public.verto_clinic_actor_role_v1(uuid,uuid) to service_role;

create or replace function public.set_clinic_appointment_policy_v2(
  p_actor_id uuid,
  p_clinic_id uuid,
  p_allow_patient_reschedule boolean,
  p_auto_no_show_enabled boolean,
  p_no_show_tolerance_minutes integer,
  p_no_show_mode text,
  p_reason text,
  p_idempotency_key text,
  p_payload_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_before record;
  v_existing public.clinic_policy_audit_events%rowtype;
  v_mode text := upper(trim(coalesce(p_no_show_mode, '')));
  v_now timestamptz := now();
begin
  if auth.uid() is not null and auth.uid() <> p_actor_id then
    raise exception 'CLINIC_POLICY_ACTOR_MISMATCH';
  end if;
  if p_actor_id is null or p_clinic_id is null
     or p_allow_patient_reschedule is null
     or p_auto_no_show_enabled is null
     or p_no_show_tolerance_minutes is null then
    raise exception 'CLINIC_POLICY_REQUIRED';
  end if;
  if p_no_show_tolerance_minutes < 5 or p_no_show_tolerance_minutes > 180 then
    raise exception 'CLINIC_POLICY_NO_SHOW_TOLERANCE_INVALID';
  end if;
  if v_mode not in ('AUTO', 'REVIEW') then
    raise exception 'CLINIC_POLICY_NO_SHOW_MODE_INVALID';
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null
     or length(p_idempotency_key) > 180
     or nullif(trim(coalesce(p_payload_hash, '')), '') is null
     or length(p_payload_hash) > 128 then
    raise exception 'CLINIC_POLICY_IDEMPOTENCY_REQUIRED';
  end if;

  v_actor_role := public.verto_clinic_actor_role_v1(p_actor_id, p_clinic_id);
  if coalesce(v_actor_role, '') not in ('owner', 'admin', 'coordinator') then
    raise exception 'CLINIC_POLICY_ACCESS_DENIED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('clinic-appointment-policy:' || p_clinic_id::text, 0));

  select audit.*
  into v_existing
  from public.clinic_policy_audit_events audit
  where audit.clinic_id = p_clinic_id
    and audit.idempotency_key = p_idempotency_key
  limit 1;

  if found then
    if v_existing.payload_hash <> p_payload_hash then
      raise exception 'CLINIC_POLICY_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object(
      'success', true,
      'idempotentReplay', true,
      'data', v_existing.after_state || jsonb_build_object(
        'clinicId', p_clinic_id,
        'updatedAt', v_existing.created_at
      )
    );
  end if;

  select
    clinic.allow_patient_reschedule,
    clinic.auto_no_show_enabled,
    clinic.no_show_tolerance_minutes,
    clinic.no_show_mode,
    coalesce(clinic.school_organization_id, clinic.id) as organization_id
  into v_before
  from public.clinics clinic
  where clinic.id = p_clinic_id
  for update;

  if not found then
    raise exception 'CLINIC_POLICY_CLINIC_NOT_FOUND';
  end if;

  update public.clinics
  set
    allow_patient_reschedule = p_allow_patient_reschedule,
    auto_no_show_enabled = p_auto_no_show_enabled,
    no_show_tolerance_minutes = p_no_show_tolerance_minutes,
    no_show_mode = v_mode,
    updated_at = v_now
  where id = p_clinic_id;

  insert into public.clinic_policy_audit_events (
    clinic_id,
    organization_id,
    actor_id,
    policy_key,
    before_state,
    after_state,
    reason,
    idempotency_key,
    payload_hash,
    created_at
  ) values (
    p_clinic_id,
    v_before.organization_id,
    p_actor_id,
    'APPOINTMENT_OPERATIONAL_POLICY',
    jsonb_build_object(
      'allowPatientReschedule', coalesce(v_before.allow_patient_reschedule, true),
      'autoNoShowEnabled', coalesce(v_before.auto_no_show_enabled, true),
      'noShowToleranceMinutes', coalesce(v_before.no_show_tolerance_minutes, 30),
      'noShowMode', coalesce(v_before.no_show_mode, 'AUTO')
    ),
    jsonb_build_object(
      'clinicId', p_clinic_id,
      'allowPatientReschedule', p_allow_patient_reschedule,
      'autoNoShowEnabled', p_auto_no_show_enabled,
      'noShowToleranceMinutes', p_no_show_tolerance_minutes,
      'noShowMode', v_mode,
      'updatedAt', v_now
    ),
    left(nullif(trim(coalesce(p_reason, '')), ''), 1000),
    p_idempotency_key,
    p_payload_hash,
    v_now
  );

  return jsonb_build_object(
    'success', true,
    'idempotentReplay', false,
    'data', jsonb_build_object(
      'clinicId', p_clinic_id,
      'allowPatientReschedule', p_allow_patient_reschedule,
      'autoNoShowEnabled', p_auto_no_show_enabled,
      'noShowToleranceMinutes', p_no_show_tolerance_minutes,
      'noShowMode', v_mode,
      'updatedAt', v_now
    )
  );
end;
$$;

revoke all on function public.set_clinic_appointment_policy_v2(uuid,uuid,boolean,boolean,integer,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.set_clinic_appointment_policy_v2(uuid,uuid,boolean,boolean,integer,text,text,text,text)
  to service_role;

create or replace function public.claim_appointment_for_session_start_v1(
  p_actor_id uuid,
  p_clinic_id uuid,
  p_appointment_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_started_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_appointment public.appointments%rowtype;
  v_status text;
  v_claimed_now boolean := false;
  v_started_at timestamptz := coalesce(p_started_at, now());
begin
  if auth.uid() is not null and auth.uid() <> p_actor_id then
    raise exception 'SESSION_START_ACTOR_MISMATCH';
  end if;
  if p_actor_id is null or p_clinic_id is null or p_appointment_id is null
     or p_patient_id is null or nullif(trim(coalesce(p_session_id, '')), '') is null
     or length(p_session_id) > 180 then
    raise exception 'SESSION_START_REQUIRED';
  end if;

  v_actor_role := public.verto_clinic_actor_role_v1(p_actor_id, p_clinic_id);
  if coalesce(v_actor_role, '') not in ('owner', 'admin', 'coordinator', 'therapist') then
    raise exception 'SESSION_START_ACCESS_DENIED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('appointment-session-start:' || p_appointment_id::text, 0));

  select appointment.*
  into v_appointment
  from public.appointments appointment
  where appointment.id = p_appointment_id
    and coalesce(appointment.organization_id, appointment.clinic_id) = p_clinic_id
    and appointment.patient_id = p_patient_id
    and appointment.deleted_at is null
    and coalesce(appointment.is_active, true) = true
  for update;

  if not found then
    raise exception 'SESSION_START_APPOINTMENT_NOT_FOUND';
  end if;

  if v_actor_role = 'therapist' and v_appointment.therapist_id is distinct from p_actor_id then
    raise exception 'SESSION_START_ACCESS_DENIED';
  end if;

  v_status := lower(trim(coalesce(v_appointment.status, 'scheduled')));

  if v_status in ('no_show', 'missed') or v_appointment.attendance_status = 'NO_SHOW' then
    raise exception 'SESSION_START_APPOINTMENT_NO_SHOW';
  end if;
  if v_status in ('cancelled', 'canceled', 'deleted') then
    raise exception 'SESSION_START_APPOINTMENT_CANCELLED';
  end if;
  if v_status = 'completed' then
    raise exception 'SESSION_START_APPOINTMENT_COMPLETED';
  end if;

  if v_status = 'in_progress' then
    if v_appointment.active_aba_session_id = p_session_id then
      return jsonb_build_object(
        'success', true,
        'claimedNow', false,
        'data', jsonb_build_object(
          'appointmentId', p_appointment_id,
          'sessionId', p_session_id,
          'status', 'IN_PROGRESS',
          'actualStartAt', coalesce(v_appointment.actual_start_at, v_started_at)
        )
      );
    end if;

    if v_appointment.active_aba_session_id is null and exists (
      select 1
      from public.aba_sessions session_row
      where session_row.id = p_session_id
        and session_row.appointment_id = p_appointment_id
        and lower(coalesce(session_row.status, '')) in ('active', 'in_progress')
    ) then
      update public.appointments
      set
        active_aba_session_id = p_session_id,
        actual_start_at = coalesce(actual_start_at, v_started_at),
        updated_at = now()
      where id = p_appointment_id;
      return jsonb_build_object(
        'success', true,
        'claimedNow', false,
        'data', jsonb_build_object(
          'appointmentId', p_appointment_id,
          'sessionId', p_session_id,
          'status', 'IN_PROGRESS',
          'actualStartAt', coalesce(v_appointment.actual_start_at, v_started_at)
        )
      );
    end if;

    raise exception 'SESSION_START_APPOINTMENT_ALREADY_IN_PROGRESS';
  end if;

  if v_status not in ('scheduled', 'pending', 'pending_confirmation', 'confirmed', 'rescheduled', 'reschedule') then
    raise exception 'SESSION_START_APPOINTMENT_STATUS_INVALID';
  end if;

  update public.appointments
  set
    session_start_previous_status = v_status,
    status = 'in_progress',
    attendance_status = null,
    actual_start_at = coalesce(actual_start_at, v_started_at),
    active_aba_session_id = p_session_id,
    no_show_review_required_at = null,
    updated_at = now()
  where id = p_appointment_id;

  v_claimed_now := true;

  insert into public.appointment_attendance_audit_events (
    clinic_id,
    appointment_id,
    patient_id,
    session_id,
    actor_id,
    action,
    previous_status,
    new_status,
    attendance_status,
    metadata
  ) values (
    p_clinic_id,
    p_appointment_id,
    p_patient_id,
    p_session_id,
    p_actor_id,
    'SESSION_STARTED',
    upper(v_status),
    'IN_PROGRESS',
    null,
    jsonb_build_object('source', 'session_start_rpc')
  );

  return jsonb_build_object(
    'success', true,
    'claimedNow', v_claimed_now,
    'data', jsonb_build_object(
      'appointmentId', p_appointment_id,
      'sessionId', p_session_id,
      'status', 'IN_PROGRESS',
      'actualStartAt', v_started_at
    )
  );
end;
$$;

revoke all on function public.claim_appointment_for_session_start_v1(uuid,uuid,uuid,uuid,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_appointment_for_session_start_v1(uuid,uuid,uuid,uuid,text,timestamptz)
  to service_role;

create or replace function public.release_appointment_session_start_claim_v1(
  p_actor_id uuid,
  p_clinic_id uuid,
  p_appointment_id uuid,
  p_session_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_appointment public.appointments%rowtype;
  v_restore_status text;
begin
  if p_actor_id is null or p_clinic_id is null or p_appointment_id is null
     or nullif(trim(coalesce(p_session_id, '')), '') is null then
    return jsonb_build_object('success', false, 'released', false);
  end if;

  v_actor_role := public.verto_clinic_actor_role_v1(p_actor_id, p_clinic_id);
  if coalesce(v_actor_role, '') not in ('owner', 'admin', 'coordinator', 'therapist') then
    raise exception 'SESSION_START_ACCESS_DENIED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('appointment-session-start:' || p_appointment_id::text, 0));

  select appointment.*
  into v_appointment
  from public.appointments appointment
  where appointment.id = p_appointment_id
    and coalesce(appointment.organization_id, appointment.clinic_id) = p_clinic_id
  for update;

  if not found
     or lower(coalesce(v_appointment.status, '')) <> 'in_progress'
     or v_appointment.active_aba_session_id is distinct from p_session_id
     or exists (select 1 from public.aba_sessions session_row where session_row.id = p_session_id) then
    return jsonb_build_object('success', true, 'released', false);
  end if;

  v_restore_status := lower(coalesce(nullif(v_appointment.session_start_previous_status, ''), 'scheduled'));
  if v_restore_status not in ('scheduled', 'pending', 'pending_confirmation', 'confirmed', 'rescheduled', 'reschedule') then
    v_restore_status := 'scheduled';
  end if;

  update public.appointments
  set
    status = v_restore_status,
    actual_start_at = null,
    active_aba_session_id = null,
    session_start_previous_status = null,
    updated_at = now()
  where id = p_appointment_id;

  return jsonb_build_object('success', true, 'released', true);
end;
$$;

revoke all on function public.release_appointment_session_start_claim_v1(uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.release_appointment_session_start_claim_v1(uuid,uuid,uuid,text)
  to service_role;

create or replace function public.complete_aba_session_atomic_v1(
  p_actor_id uuid,
  p_clinic_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_appointment_id uuid,
  p_attendance_status text,
  p_ended_at timestamptz,
  p_session_note text,
  p_summary jsonb,
  p_idempotency_key text,
  p_payload_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_attendance text := upper(trim(coalesce(p_attendance_status, '')));
  v_session public.aba_sessions%rowtype;
  v_appointment public.appointments%rowtype;
  v_existing public.aba_session_completion_operations%rowtype;
  v_appointment_id uuid;
  v_started_at timestamptz;
  v_ended_at timestamptz := coalesce(p_ended_at, now());
  v_duration_seconds integer := 0;
  v_session_status text;
  v_appointment_status text;
  v_billing_status text;
  v_summary_id text;
  v_response jsonb;
  v_clinical_record_count integer := 0;
  v_now timestamptz := now();
begin
  if auth.uid() is not null and auth.uid() <> p_actor_id then
    raise exception 'SESSION_COMPLETION_ACTOR_MISMATCH';
  end if;
  if p_actor_id is null or p_clinic_id is null or p_patient_id is null
     or nullif(trim(coalesce(p_session_id, '')), '') is null
     or length(p_session_id) > 180 then
    raise exception 'SESSION_COMPLETION_REQUIRED';
  end if;
  if v_attendance not in ('ATTENDED', 'LATE', 'PARTIAL', 'NO_SHOW', 'CANCELLED_PATIENT', 'CANCELLED_CLINIC') then
    raise exception 'SESSION_COMPLETION_ATTENDANCE_INVALID';
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null
     or length(p_idempotency_key) > 180
     or nullif(trim(coalesce(p_payload_hash, '')), '') is null
     or length(p_payload_hash) > 128 then
    raise exception 'SESSION_COMPLETION_IDEMPOTENCY_REQUIRED';
  end if;
  if octet_length(coalesce(p_summary, '{}'::jsonb)::text) > 196608 then
    raise exception 'SESSION_COMPLETION_SUMMARY_TOO_LARGE';
  end if;
  if length(coalesce(p_session_note, '')) > 4000 then
    raise exception 'SESSION_COMPLETION_NOTE_TOO_LARGE';
  end if;

  v_actor_role := public.verto_clinic_actor_role_v1(p_actor_id, p_clinic_id);
  if coalesce(v_actor_role, '') not in ('owner', 'admin', 'coordinator', 'therapist') then
    raise exception 'SESSION_COMPLETION_ACCESS_DENIED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('aba-session-complete:' || p_clinic_id::text || ':' || p_session_id, 0));

  select operation.*
  into v_existing
  from public.aba_session_completion_operations operation
  where operation.clinic_id = p_clinic_id
    and operation.idempotency_key = p_idempotency_key
  limit 1;

  if found then
    if v_existing.payload_hash <> p_payload_hash then
      raise exception 'SESSION_COMPLETION_IDEMPOTENCY_CONFLICT';
    end if;
    return v_existing.response_payload || jsonb_build_object('idempotentReplay', true);
  end if;

  select session_row.*
  into v_session
  from public.aba_sessions session_row
  where session_row.id = p_session_id
    and session_row.patient_id = p_patient_id
    and session_row.clinic_id = p_clinic_id::text
  for update;

  if not found then
    raise exception 'SESSION_COMPLETION_SESSION_NOT_FOUND';
  end if;

  if v_actor_role = 'therapist'
     and nullif(trim(coalesce(v_session.therapist_id, '')), '') is not null
     and v_session.therapist_id <> p_actor_id::text then
    raise exception 'SESSION_COMPLETION_ACCESS_DENIED';
  end if;

  if lower(coalesce(v_session.status, '')) in ('completed', 'canceled') then
    raise exception 'SESSION_COMPLETION_ALREADY_FINALIZED';
  end if;

  v_appointment_id := coalesce(p_appointment_id, v_session.appointment_id);
  if v_appointment_id is not null then
    select appointment.*
    into v_appointment
    from public.appointments appointment
    where appointment.id = v_appointment_id
      and coalesce(appointment.organization_id, appointment.clinic_id) = p_clinic_id
      and appointment.patient_id = p_patient_id
    for update;

    if not found then
      raise exception 'SESSION_COMPLETION_APPOINTMENT_NOT_FOUND';
    end if;
    if v_actor_role = 'therapist' and v_appointment.therapist_id is distinct from p_actor_id then
      raise exception 'SESSION_COMPLETION_ACCESS_DENIED';
    end if;
    if v_appointment.attendance_status = 'NO_SHOW' and v_attendance in ('ATTENDED', 'LATE', 'PARTIAL') then
      raise exception 'SESSION_COMPLETION_NO_SHOW_REOPEN_REQUIRED';
    end if;
  end if;

  select
    (select count(*) from public.aba_trials row_item where row_item.session_id = p_session_id)
    + (select count(*) from public.aba_behavior_events row_item where row_item.session_id = p_session_id)
    + (select count(*) from public.aba_interval_records row_item where row_item.session_id = p_session_id)
    + (select count(*) from public.aba_abc_events row_item where row_item.session_id = p_session_id)
  into v_clinical_record_count;

  if v_attendance in ('NO_SHOW', 'CANCELLED_PATIENT', 'CANCELLED_CLINIC') then
    if length(trim(coalesce(p_session_note, ''))) < 5 then
      raise exception 'SESSION_COMPLETION_ABSENCE_REASON_REQUIRED';
    end if;
    if v_clinical_record_count > 0 then
      raise exception 'SESSION_COMPLETION_ABSENCE_HAS_CLINICAL_RECORDS';
    end if;
  end if;

  v_started_at := coalesce(v_session.actual_start_at, v_session.started_at, v_appointment.actual_start_at, v_appointment.scheduled_start_at, v_appointment.scheduled_at, v_ended_at);
  if v_attendance in ('ATTENDED', 'LATE', 'PARTIAL') then
    if v_ended_at > v_now + interval '5 minutes' then
      raise exception 'SESSION_COMPLETION_END_TIME_INVALID';
    end if;
    if v_ended_at < v_started_at then
      raise exception 'SESSION_COMPLETION_END_BEFORE_START';
    end if;
    v_duration_seconds := greatest(0, floor(extract(epoch from (v_ended_at - v_started_at)))::integer);
    v_session_status := 'completed';
    v_appointment_status := 'completed';
    v_billing_status := 'PENDING_REVIEW';
  else
    v_duration_seconds := 0;
    v_session_status := 'canceled';
    v_appointment_status := case when v_attendance = 'NO_SHOW' then 'no_show' else 'cancelled' end;
    v_billing_status := 'NOT_BILLABLE';
  end if;

  -- O identificador do resumo é derivado exclusivamente da sessão. Não aceite um ID
  -- fornecido pelo cliente, pois isso permitiria sobrescrever o resumo de outra sessão.
  v_summary_id := 'summary-' || p_session_id;
  if length(v_summary_id) > 180 then
    v_summary_id := 'summary-' || left(encode(digest(p_session_id, 'sha256'), 'hex'), 32);
  end if;

  insert into public.aba_session_summaries (
    id,
    organization_id,
    clinic_id,
    session_id,
    appointment_id,
    patient_id,
    therapist_id,
    care_setting,
    location_name_snapshot,
    location_context_snapshot,
    attendance_status,
    billing_status,
    started_at,
    ended_at,
    duration_seconds,
    total_trials,
    independent_trials,
    prompted_trials,
    error_trials,
    accuracy_percent,
    independence_percent,
    trial_types_used,
    total_behavior_events,
    frequency_summary,
    duration_summary,
    interval_summary,
    abc_summary,
    mastery_summary,
    maintenance_summary,
    blocking_items,
    warning_items,
    pending_items,
    pending_warnings,
    session_note,
    sync_status,
    source,
    summary_payload,
    created_at,
    updated_at
  ) values (
    v_summary_id,
    p_clinic_id::text,
    p_clinic_id::text,
    p_session_id,
    v_appointment_id,
    p_patient_id,
    coalesce(nullif(v_session.therapist_id, ''), p_actor_id::text),
    v_session.care_setting,
    v_session.location_name_snapshot,
    coalesce(v_session.location_context_snapshot, '{}'::jsonb),
    v_attendance,
    v_billing_status,
    v_started_at,
    v_ended_at,
    v_duration_seconds,
    coalesce((p_summary->>'totalTrials')::integer, 0),
    coalesce((p_summary->>'independentTrials')::integer, 0),
    coalesce((p_summary->>'promptedTrials')::integer, 0),
    coalesce((p_summary->>'errorTrials')::integer, 0),
    coalesce((p_summary->>'accuracyPercent')::numeric, 0),
    coalesce((p_summary->>'independencePercent')::numeric, 0),
    coalesce(p_summary->'trialTypesUsed', '[]'::jsonb),
    coalesce((p_summary->>'totalBehaviorEvents')::integer, 0),
    coalesce(p_summary->'frequencySummary', '[]'::jsonb),
    coalesce(p_summary->'durationSummary', '[]'::jsonb),
    coalesce(p_summary->'intervalSummary', '[]'::jsonb),
    coalesce(p_summary->'abcSummary', '[]'::jsonb),
    coalesce(p_summary->'masterySummary', '[]'::jsonb),
    coalesce(p_summary->'maintenanceSummary', '[]'::jsonb),
    coalesce(p_summary->'blockingItems', '[]'::jsonb),
    coalesce(p_summary->'warningItems', '[]'::jsonb),
    coalesce(p_summary->'pendingItems', '[]'::jsonb),
    coalesce(p_summary->'pendingWarnings', '[]'::jsonb),
    left(coalesce(p_session_note, ''), 4000),
    'synced',
    'verto_web',
    coalesce(p_summary, '{}'::jsonb) || jsonb_build_object(
      'attendanceStatus', v_attendance,
      'billingStatus', v_billing_status,
      'appointmentId', v_appointment_id,
      'therapistId', coalesce(nullif(v_session.therapist_id, ''), p_actor_id::text),
      'sessionNote', left(coalesce(p_session_note, ''), 4000)
    ),
    coalesce(nullif(p_summary->>'createdAt', '')::timestamptz, v_now),
    v_now
  )
  on conflict (id) do update set
    appointment_id = excluded.appointment_id,
    attendance_status = excluded.attendance_status,
    billing_status = excluded.billing_status,
    started_at = excluded.started_at,
    ended_at = excluded.ended_at,
    duration_seconds = excluded.duration_seconds,
    total_trials = excluded.total_trials,
    independent_trials = excluded.independent_trials,
    prompted_trials = excluded.prompted_trials,
    error_trials = excluded.error_trials,
    accuracy_percent = excluded.accuracy_percent,
    independence_percent = excluded.independence_percent,
    trial_types_used = excluded.trial_types_used,
    total_behavior_events = excluded.total_behavior_events,
    frequency_summary = excluded.frequency_summary,
    duration_summary = excluded.duration_summary,
    interval_summary = excluded.interval_summary,
    abc_summary = excluded.abc_summary,
    mastery_summary = excluded.mastery_summary,
    maintenance_summary = excluded.maintenance_summary,
    blocking_items = excluded.blocking_items,
    warning_items = excluded.warning_items,
    pending_items = excluded.pending_items,
    pending_warnings = excluded.pending_warnings,
    session_note = excluded.session_note,
    sync_status = 'synced',
    summary_payload = excluded.summary_payload,
    updated_at = v_now;

  update public.aba_sessions
  set
    status = v_session_status,
    attendance_status = v_attendance,
    appointment_id = coalesce(v_appointment_id, appointment_id),
    actual_end_at = v_ended_at,
    ended_at = v_ended_at,
    actual_duration_minutes = ceil(v_duration_seconds / 60.0)::integer,
    duration_seconds = v_duration_seconds,
    duration_minutes = ceil(v_duration_seconds / 60.0)::integer,
    record_count = v_clinical_record_count,
    notes = left(coalesce(p_session_note, ''), 2000),
    sync_status = 'synced',
    updated_at = v_now
  where id = p_session_id;

  if v_appointment_id is not null then
    update public.appointments
    set
      status = v_appointment_status,
      attendance_status = v_attendance,
      active_aba_session_id = null,
      actual_start_at = case
        when v_attendance in ('ATTENDED', 'LATE', 'PARTIAL') then coalesce(actual_start_at, v_started_at)
        else actual_start_at
      end,
      actual_end_at = case
        when v_attendance in ('ATTENDED', 'LATE', 'PARTIAL') then v_ended_at
        else actual_end_at
      end,
      actual_duration_minutes = case
        when v_attendance in ('ATTENDED', 'LATE', 'PARTIAL') then ceil(v_duration_seconds / 60.0)::integer
        else 0
      end,
      no_show_classified_at = case when v_attendance = 'NO_SHOW' then coalesce(no_show_classified_at, v_now) else no_show_classified_at end,
      no_show_source = case when v_attendance = 'NO_SHOW' then coalesce(no_show_source, 'SESSION_CLOSURE') else no_show_source end,
      no_show_previous_status = case when v_attendance = 'NO_SHOW' then coalesce(no_show_previous_status, session_start_previous_status, 'in_progress') else no_show_previous_status end,
      no_show_review_required_at = null,
      updated_at = v_now
    where id = v_appointment_id;

    insert into public.appointment_attendance_audit_events (
      clinic_id,
      appointment_id,
      patient_id,
      session_id,
      actor_id,
      action,
      previous_status,
      new_status,
      attendance_status,
      reason,
      idempotency_key,
      payload_hash,
      metadata
    ) values (
      p_clinic_id,
      v_appointment_id,
      p_patient_id,
      p_session_id,
      p_actor_id,
      'SESSION_COMPLETED',
      upper(coalesce(v_appointment.status, 'IN_PROGRESS')),
      upper(v_appointment_status),
      v_attendance,
      left(nullif(trim(coalesce(p_session_note, '')), ''), 1000),
      p_idempotency_key,
      p_payload_hash,
      jsonb_build_object(
        'durationSeconds', v_duration_seconds,
        'clinicalRecordCount', v_clinical_record_count,
        'billingStatus', v_billing_status
      )
    );
  end if;

  v_response := jsonb_build_object(
    'success', true,
    'idempotentReplay', false,
    'data', jsonb_build_object(
      'sessionId', p_session_id,
      'summaryId', v_summary_id,
      'appointmentId', v_appointment_id,
      'therapistId', coalesce(nullif(v_session.therapist_id, ''), p_actor_id::text),
      'attendanceStatus', v_attendance,
      'clinicalStatus', upper(v_session_status),
      'billingStatus', v_billing_status,
      'startedAt', v_started_at,
      'endedAt', v_ended_at,
      'durationSeconds', v_duration_seconds,
      'recordCount', v_clinical_record_count
    )
  );

  insert into public.aba_session_completion_operations (
    clinic_id,
    session_id,
    appointment_id,
    actor_id,
    idempotency_key,
    payload_hash,
    response_payload
  ) values (
    p_clinic_id,
    p_session_id,
    v_appointment_id,
    p_actor_id,
    p_idempotency_key,
    p_payload_hash,
    v_response
  );

  return v_response;
end;
$$;

revoke all on function public.complete_aba_session_atomic_v1(uuid,uuid,uuid,text,uuid,text,timestamptz,text,jsonb,text,text)
  from public, anon, authenticated;
grant execute on function public.complete_aba_session_atomic_v1(uuid,uuid,uuid,text,uuid,text,timestamptz,text,jsonb,text,text)
  to service_role;

create or replace function public.classify_overdue_appointments_no_show_v1(
  p_limit integer default 250
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_now timestamptz := now();
  v_limit integer := greatest(1, least(coalesce(p_limit, 250), 500));
  v_classified jsonb := '[]'::jsonb;
  v_flagged jsonb := '[]'::jsonb;
  v_failed integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'NO_SHOW_JOB_SERVICE_ROLE_REQUIRED';
  end if;

  for v_row in
    select
      appointment.id,
      appointment.clinic_id,
      coalesce(appointment.organization_id, appointment.clinic_id) as organization_id,
      appointment.patient_id,
      appointment.status,
      appointment.scheduled_start_at,
      clinic.no_show_tolerance_minutes,
      clinic.no_show_mode
    from public.appointments appointment
    join public.clinics clinic
      on clinic.id = coalesce(appointment.organization_id, appointment.clinic_id)
    where clinic.auto_no_show_enabled = true
      and appointment.deleted_at is null
      and coalesce(appointment.is_active, true) = true
      and appointment.actual_start_at is null
      and appointment.no_show_classified_at is null
      and appointment.no_show_review_required_at is null
      and (
        appointment.no_show_reopened_at is null
        or appointment.no_show_reopened_at + interval '15 minutes' <= v_now
      )
      and appointment.active_aba_session_id is null
      and lower(coalesce(appointment.status, 'scheduled')) in (
        'scheduled', 'pending', 'pending_confirmation', 'confirmed', 'rescheduled', 'reschedule'
      )
      and coalesce(appointment.scheduled_start_at, appointment.scheduled_at)
          + make_interval(mins => clinic.no_show_tolerance_minutes) <= v_now
      and not exists (
        select 1
        from public.aba_sessions session_row
        where session_row.appointment_id = appointment.id
          and lower(coalesce(session_row.status, '')) in ('active', 'in_progress', 'completed')
      )
    order by coalesce(appointment.scheduled_start_at, appointment.scheduled_at), appointment.id
    limit v_limit
    for update of appointment skip locked
  loop
    begin
      if v_row.no_show_mode = 'REVIEW' then
        update public.appointments
        set
          attendance_status = 'PENDING_REVIEW',
          no_show_review_required_at = coalesce(no_show_review_required_at, v_now),
          no_show_policy_minutes = v_row.no_show_tolerance_minutes,
          no_show_source = 'AUTOMATIC_REVIEW',
          updated_at = v_now
        where id = v_row.id;

        insert into public.appointment_attendance_audit_events (
          clinic_id, appointment_id, patient_id, action, previous_status,
          new_status, attendance_status, metadata
        ) values (
          v_row.organization_id,
          v_row.id,
          v_row.patient_id,
          'NO_SHOW_REVIEW_FLAGGED',
          upper(v_row.status),
          upper(v_row.status),
          'PENDING_REVIEW',
          jsonb_build_object('toleranceMinutes', v_row.no_show_tolerance_minutes, 'source', 'server_cron')
        );

        v_flagged := v_flagged || jsonb_build_array(jsonb_build_object(
          'appointmentId', v_row.id,
          'clinicId', v_row.organization_id,
          'patientId', v_row.patient_id
        ));
      else
        update public.appointments
        set
          no_show_previous_status = lower(coalesce(status, 'scheduled')),
          status = 'no_show',
          attendance_status = 'NO_SHOW',
          no_show_classified_at = v_now,
          no_show_policy_minutes = v_row.no_show_tolerance_minutes,
          no_show_source = 'AUTOMATIC_POLICY',
          no_show_review_required_at = null,
          actual_duration_minutes = 0,
          updated_at = v_now
        where id = v_row.id;

        insert into public.appointment_attendance_audit_events (
          clinic_id, appointment_id, patient_id, action, previous_status,
          new_status, attendance_status, metadata
        ) values (
          v_row.organization_id,
          v_row.id,
          v_row.patient_id,
          'NO_SHOW_AUTO_CLASSIFIED',
          upper(v_row.status),
          'NO_SHOW',
          'NO_SHOW',
          jsonb_build_object('toleranceMinutes', v_row.no_show_tolerance_minutes, 'source', 'server_cron')
        );

        v_classified := v_classified || jsonb_build_array(jsonb_build_object(
          'appointmentId', v_row.id,
          'clinicId', v_row.organization_id,
          'patientId', v_row.patient_id
        ));
      end if;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object(
    'success', true,
    'classified', v_classified,
    'flaggedForReview', v_flagged,
    'classifiedCount', jsonb_array_length(v_classified),
    'flaggedCount', jsonb_array_length(v_flagged),
    'failedCount', v_failed,
    'executedAt', v_now
  );
end;
$$;

revoke all on function public.classify_overdue_appointments_no_show_v1(integer)
  from public, anon, authenticated;
grant execute on function public.classify_overdue_appointments_no_show_v1(integer)
  to service_role;

create or replace function public.reopen_appointment_no_show_v1(
  p_actor_id uuid,
  p_clinic_id uuid,
  p_appointment_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_payload_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_appointment public.appointments%rowtype;
  v_existing public.appointment_attendance_audit_events%rowtype;
  v_restore_status text;
  v_now timestamptz := now();
  v_response jsonb;
begin
  if auth.uid() is not null and auth.uid() <> p_actor_id then
    raise exception 'NO_SHOW_REOPEN_ACTOR_MISMATCH';
  end if;
  if p_actor_id is null or p_clinic_id is null or p_appointment_id is null then
    raise exception 'NO_SHOW_REOPEN_REQUIRED';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 or length(p_reason) > 1000 then
    raise exception 'NO_SHOW_REOPEN_REASON_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null
     or length(p_idempotency_key) > 180
     or nullif(trim(coalesce(p_payload_hash, '')), '') is null
     or length(p_payload_hash) > 128 then
    raise exception 'NO_SHOW_REOPEN_IDEMPOTENCY_REQUIRED';
  end if;

  v_actor_role := public.verto_clinic_actor_role_v1(p_actor_id, p_clinic_id);
  if coalesce(v_actor_role, '') not in ('owner', 'admin', 'coordinator') then
    raise exception 'NO_SHOW_REOPEN_ACCESS_DENIED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('appointment-no-show-reopen:' || p_appointment_id::text, 0));

  select audit.*
  into v_existing
  from public.appointment_attendance_audit_events audit
  where audit.clinic_id = p_clinic_id
    and audit.idempotency_key = p_idempotency_key
  limit 1;

  if found then
    if v_existing.payload_hash <> p_payload_hash then
      raise exception 'NO_SHOW_REOPEN_IDEMPOTENCY_CONFLICT';
    end if;
    return coalesce(v_existing.metadata->'response', '{}'::jsonb)
      || jsonb_build_object('success', true, 'idempotentReplay', true);
  end if;

  select appointment.*
  into v_appointment
  from public.appointments appointment
  where appointment.id = p_appointment_id
    and coalesce(appointment.organization_id, appointment.clinic_id) = p_clinic_id
  for update;

  if not found then
    raise exception 'NO_SHOW_REOPEN_APPOINTMENT_NOT_FOUND';
  end if;

  if lower(coalesce(v_appointment.status, '')) not in ('no_show', 'missed')
     and v_appointment.attendance_status <> 'NO_SHOW' then
    return jsonb_build_object(
      'success', true,
      'idempotentReplay', true,
      'data', jsonb_build_object(
        'appointmentId', p_appointment_id,
        'status', upper(coalesce(v_appointment.status, 'scheduled')),
        'attendanceStatus', v_appointment.attendance_status
      )
    );
  end if;

  v_restore_status := lower(coalesce(nullif(v_appointment.no_show_previous_status, ''), 'scheduled'));
  if v_restore_status not in ('scheduled', 'pending', 'pending_confirmation', 'confirmed', 'rescheduled', 'reschedule') then
    v_restore_status := 'scheduled';
  end if;

  update public.appointments
  set
    status = v_restore_status,
    attendance_status = null,
    no_show_classified_at = null,
    no_show_policy_minutes = null,
    no_show_source = null,
    no_show_previous_status = null,
    no_show_reopened_at = v_now,
    no_show_reopened_by = p_actor_id,
    no_show_reopen_reason = left(trim(p_reason), 1000),
    no_show_review_required_at = null,
    actual_duration_minutes = null,
    updated_at = v_now
  where id = p_appointment_id;

  v_response := jsonb_build_object(
    'success', true,
    'idempotentReplay', false,
    'data', jsonb_build_object(
      'appointmentId', p_appointment_id,
      'status', upper(v_restore_status),
      'attendanceStatus', null,
      'reopenedAt', v_now,
      'reopenedBy', p_actor_id
    )
  );

  insert into public.appointment_attendance_audit_events (
    clinic_id,
    appointment_id,
    patient_id,
    actor_id,
    action,
    previous_status,
    new_status,
    attendance_status,
    reason,
    idempotency_key,
    payload_hash,
    metadata
  ) values (
    p_clinic_id,
    p_appointment_id,
    v_appointment.patient_id,
    p_actor_id,
    'NO_SHOW_REOPENED',
    upper(coalesce(v_appointment.status, 'NO_SHOW')),
    upper(v_restore_status),
    null,
    left(trim(p_reason), 1000),
    p_idempotency_key,
    p_payload_hash,
    jsonb_build_object('response', v_response, 'source', 'professional_action')
  );

  return v_response;
end;
$$;

revoke all on function public.reopen_appointment_no_show_v1(uuid,uuid,uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.reopen_appointment_no_show_v1(uuid,uuid,uuid,text,text,text)
  to service_role;

commit;
