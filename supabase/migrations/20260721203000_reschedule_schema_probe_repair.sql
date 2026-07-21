-- Aligns the production appointment contract before rebuilding only the
-- reschedule approval functions. Additive and idempotent.

alter table if exists public.appointments
  add column if not exists organization_id uuid,
  add column if not exists scheduled_start_at timestamptz,
  add column if not exists scheduled_end_at timestamptz,
  add column if not exists scheduled_duration_minutes integer,
  add column if not exists room_id text,
  add column if not exists room_name text,
  add column if not exists location_type text,
  add column if not exists source_payload jsonb not null default '{}'::jsonb,
  add column if not exists patient_response text,
  add column if not exists patient_responded_at timestamptz,
  add column if not exists patient_confirmation_status text,
  add column if not exists patient_confirmation_at timestamptz,
  add column if not exists patient_confirmation_by text,
  add column if not exists patient_confirmation_source text,
  add column if not exists reschedule_requested_at timestamptz,
  add column if not exists reschedule_requested_by text,
  add column if not exists notification_24h_sent_at timestamptz,
  add column if not exists notification_12h_sent_at timestamptz,
  add column if not exists notification_sent boolean not null default false,
  add column if not exists notification_sent_at timestamptz,
  add column if not exists notification_12h_sent boolean not null default false;

alter table if exists public.appointment_billing_contexts
  add column if not exists payer_type text,
  add column if not exists service_catalog_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.appointments
   set scheduled_start_at = coalesce(scheduled_start_at, scheduled_at),
       scheduled_duration_minutes = coalesce(scheduled_duration_minutes, duration_minutes, 50),
       scheduled_end_at = coalesce(
         scheduled_end_at,
         coalesce(scheduled_start_at, scheduled_at) + make_interval(mins => greatest(coalesce(scheduled_duration_minutes, duration_minutes, 50), 1))
       ),
       organization_id = coalesce(organization_id, clinic_id)
 where scheduled_start_at is null
    or scheduled_end_at is null
    or scheduled_duration_minutes is null
    or organization_id is null;

-- Atomically approves a patient reschedule request while preserving the original appointment.

create or replace function public.approve_appointment_reschedule(
  p_organization_id uuid,
  p_clinic_id uuid,
  p_request_id uuid,
  p_appointment_id uuid,
  p_patient_id uuid,
  p_selected_option_index integer,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz,
  p_duration_minutes integer,
  p_professional_id uuid,
  p_professional_name text,
  p_room_id text,
  p_room_name text,
  p_location_type text,
  p_session_buffer_minutes integer,
  p_actor_id text,
  p_actor_role text,
  p_resolution_note text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.appointment_action_requests%rowtype;
  v_appointment public.appointments%rowtype;
  v_updated_request public.appointment_action_requests%rowtype;
  v_audit public.appointment_status_audit_logs%rowtype;
  v_now timestamptz := clock_timestamp();
  v_old_start timestamptz;
  v_old_end timestamptz;
  v_old_status text;
  v_buffer interval := make_interval(mins => greatest(coalesce(p_session_buffer_minutes, 0), 0));
  v_is_recovery boolean := false;
  v_existing_approved_start timestamptz;
  v_expected_original_start timestamptz;
  v_expected_original_end timestamptz;
  v_billing_context public.appointment_billing_contexts%rowtype;
  v_authorization public.patient_payer_authorizations%rowtype;
  v_authorization_id uuid;
  v_future_commitments integer := 0;
  v_historical_official_commitments integer := 0;
  v_authorized_quantity numeric := 0;
  v_consumed_quantity numeric := 0;
  v_reserved_quantity numeric := 0;
  v_requested_timezone text;
  v_timezone text := 'America/Sao_Paulo';
  v_appointment_date date;
  v_context_procedure_code text;
  v_authorization_procedure_code text;
  v_team_member_id uuid;
  v_financial_type text;
begin
  if p_organization_id is null or p_clinic_id is null or p_request_id is null or p_appointment_id is null or p_patient_id is null then
    raise exception using errcode = '22023', message = 'RESCHEDULE_SCOPE_INVALID';
  end if;
  if lower(coalesce(p_actor_role, '')) not in ('owner', 'admin', 'coordinator') then
    raise exception using errcode = '42501', message = 'RESCHEDULE_APPROVAL_FORBIDDEN';
  end if;
  if not exists (
    select 1
      from public.users u
     where u.id::text = p_actor_id
       and u.clinic_id = p_clinic_id
       and lower(coalesce(u.role, '')) in ('owner', 'admin', 'coordinator')
  ) and not exists (
    select 1
      from public.clinic_memberships cm
     where cm.user_id::text = p_actor_id
       and cm.clinic_id = p_clinic_id
       and lower(coalesce(cm.role, '')) in ('owner', 'admin', 'coordinator')
       and lower(coalesce(cm.status, 'active')) = 'active'
  ) then
    raise exception using errcode = '42501', message = 'RESCHEDULE_APPROVAL_FORBIDDEN';
  end if;

  select request_row.*
    into v_request
    from public.appointment_action_requests request_row
   where request_row.id = p_request_id
     and request_row.organization_id = p_organization_id
     and request_row.appointment_id = p_appointment_id
     and request_row.patient_id = p_patient_id
     and request_row.request_type = 'RESCHEDULE'
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'RESCHEDULE_REQUEST_NOT_FOUND';
  end if;

  select appointment_row.*
    into v_appointment
    from public.appointments appointment_row
   where appointment_row.id = p_appointment_id
     and appointment_row.patient_id = p_patient_id
     and appointment_row.clinic_id = p_clinic_id
     and coalesce(appointment_row.organization_id, appointment_row.clinic_id) = p_organization_id
     and appointment_row.deleted_at is null
     and coalesce(appointment_row.is_active, true)
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'RESCHEDULE_APPOINTMENT_NOT_FOUND';
  end if;

  if v_request.status = 'APPROVED' then
    v_existing_approved_start := nullif(v_request.metadata ->> 'approvedStart', '')::timestamptz;
    if coalesce(v_appointment.scheduled_start_at, v_appointment.scheduled_at) = coalesce(v_existing_approved_start, p_scheduled_start) then
      return jsonb_build_object(
        'idempotent', true,
        'repaired', false,
        'appointment', to_jsonb(v_appointment),
        'request', to_jsonb(v_request)
      );
    end if;
    if v_existing_approved_start is null or v_existing_approved_start <> p_scheduled_start then
      raise exception using errcode = '40001', message = 'RESCHEDULE_REQUEST_ALREADY_RESOLVED';
    end if;
    v_is_recovery := true;
  elsif v_request.status <> 'PENDING' then
    raise exception using errcode = '40001', message = 'RESCHEDULE_REQUEST_ALREADY_RESOLVED';
  end if;

  if not v_is_recovery then
    v_expected_original_start := nullif(v_request.metadata ->> 'originalScheduledStart', '')::timestamptz;
    v_expected_original_end := nullif(v_request.metadata ->> 'originalScheduledEnd', '')::timestamptz;
    if v_expected_original_start is not null
      and coalesce(v_appointment.scheduled_start_at, v_appointment.scheduled_at) is distinct from v_expected_original_start then
      raise exception using errcode = '40001', message = 'RESCHEDULE_APPOINTMENT_CHANGED';
    end if;
    if v_expected_original_end is not null
      and coalesce(
        v_appointment.scheduled_end_at,
        coalesce(v_appointment.scheduled_start_at, v_appointment.scheduled_at)
          + make_interval(mins => greatest(coalesce(v_appointment.scheduled_duration_minutes, v_appointment.duration_minutes, 50), 1))
      ) is distinct from v_expected_original_end then
      raise exception using errcode = '40001', message = 'RESCHEDULE_APPOINTMENT_CHANGED';
    end if;
    if lower(coalesce(to_jsonb(v_appointment) ->> 'patient_confirmation_status', v_appointment.patient_response, ''))
      not in ('reschedule_requested', 'reschedule', 'remarcar') then
      raise exception using errcode = '40001', message = 'RESCHEDULE_APPOINTMENT_CHANGED';
    end if;
  end if;

  if jsonb_typeof(v_request.metadata -> 'rescheduleOptions') = 'array' then
    if p_selected_option_index < 0
      or p_selected_option_index >= jsonb_array_length(v_request.metadata -> 'rescheduleOptions')
      or nullif(v_request.metadata -> 'rescheduleOptions' -> p_selected_option_index ->> 'scheduledStart', '')::timestamptz is distinct from p_scheduled_start
      or nullif(v_request.metadata -> 'rescheduleOptions' -> p_selected_option_index ->> 'scheduledEnd', '')::timestamptz is distinct from p_scheduled_end then
      raise exception using errcode = '22023', message = 'RESCHEDULE_OPTION_INVALID';
    end if;
  end if;

  if lower(coalesce(v_appointment.status, '')) in ('cancelled', 'canceled', 'completed', 'no_show', 'missed', 'deleted') then
    raise exception using errcode = '40001', message = 'RESCHEDULE_APPOINTMENT_NOT_MOVABLE';
  end if;
  if p_scheduled_start is null or p_scheduled_end is null or p_scheduled_end <= p_scheduled_start then
    raise exception using errcode = '22023', message = 'RESCHEDULE_TIME_INVALID';
  end if;
  if p_duration_minutes is null or p_duration_minutes < 1 or p_duration_minutes > 720 then
    raise exception using errcode = '22023', message = 'RESCHEDULE_DURATION_INVALID';
  end if;
  if abs(extract(epoch from (p_scheduled_end - p_scheduled_start)) / 60 - p_duration_minutes) > 1 then
    raise exception using errcode = '22023', message = 'RESCHEDULE_DURATION_MISMATCH';
  end if;
  if not exists (
    select 1
     from public.clinic_memberships cm
     where cm.clinic_id = p_clinic_id
       and cm.user_id = p_professional_id
       and lower(coalesce(cm.status, 'active')) = 'active'
  ) then
    raise exception using errcode = '23503', message = 'RESCHEDULE_PROFESSIONAL_INVALID';
  end if;
  if lower(coalesce(p_location_type, 'clinica')) = 'clinica' and (
    nullif(trim(coalesce(p_room_id, '')), '') is null or not exists (
      select 1
        from public.clinic_rooms room
       where room.id::text = p_room_id
         and room.clinic_id = p_clinic_id
         and coalesce(room.organization_id, room.clinic_id) = p_organization_id
         and coalesce(room.is_active, true)
    )
  ) then
    raise exception using errcode = '23503', message = 'RESCHEDULE_ROOM_INVALID';
  end if;

  -- Revalidate the persisted financial context inside the same transaction.
  -- The frontend preview is advisory; this locked check is authoritative.
  select bc.* into v_billing_context
    from public.appointment_billing_contexts bc
   where bc.organization_id = p_organization_id
     and bc.appointment_id = p_appointment_id
   order by bc.updated_at desc, bc.id desc
   limit 1
   for update;

  if found then
    v_financial_type := upper(coalesce(nullif(trim(v_billing_context.payer_type), ''), case when v_billing_context.payer_id is not null then 'INSURANCE' else '' end));
    if v_financial_type = 'INSURANCE' then
      begin
        v_authorization_id := nullif(coalesce(
          v_billing_context.metadata ->> 'patient_tiss_authorization_id',
          v_billing_context.metadata ->> 'patientTissAuthorizationId',
          v_billing_context.metadata ->> 'authorization_id',
          v_billing_context.metadata ->> 'authorizationId',
          ''
        ), '')::uuid;
      exception when invalid_text_representation then
        raise exception using errcode = '22023', message = 'FINANCIAL_REVIEW_REQUIRED';
      end;

      if v_authorization_id is null then
        raise exception using errcode = '22023', message = 'FINANCIAL_REVIEW_REQUIRED';
      end if;

      select authorization_row.* into v_authorization
        from public.patient_payer_authorizations authorization_row
       where authorization_row.id = v_authorization_id
         and authorization_row.organization_id = p_organization_id
         and authorization_row.patient_id = p_patient_id
         and (v_billing_context.payer_id is null or authorization_row.payer_id = v_billing_context.payer_id)
       for update;
      if not found then
        raise exception using errcode = '22023', message = 'FINANCIAL_AUTHORIZATION_NOT_FOUND';
      end if;
      if coalesce(v_authorization.active, true) = false
        or lower(coalesce(v_authorization.status, 'active')) in ('cancelled', 'canceled', 'expired', 'inactive', 'revoked') then
        raise exception using errcode = '22023', message = 'FINANCIAL_AUTHORIZATION_INACTIVE';
      end if;
      v_requested_timezone := nullif(coalesce(
        v_billing_context.metadata ->> 'clinic_timezone',
        v_billing_context.metadata ->> 'clinicTimezone',
        ''
      ), '');
      if v_requested_timezone is not null then
        select name into v_timezone
          from pg_timezone_names
         where name = v_requested_timezone
         limit 1;
        v_timezone := coalesce(v_timezone, 'America/Sao_Paulo');
      end if;
      v_appointment_date := timezone(v_timezone, p_scheduled_start)::date;

      if v_authorization.valid_from is not null and v_appointment_date < v_authorization.valid_from then
        raise exception using errcode = '22023', message = 'FINANCIAL_AUTHORIZATION_NOT_STARTED';
      end if;
      if v_authorization.valid_until is not null and v_appointment_date > v_authorization.valid_until then
        raise exception using errcode = '22023', message = 'FINANCIAL_AUTHORIZATION_EXPIRED';
      end if;
      if v_billing_context.service_catalog_id is not null
        and v_authorization.service_catalog_id is not null
        and v_billing_context.service_catalog_id <> v_authorization.service_catalog_id then
        raise exception using errcode = '22023', message = 'FINANCIAL_PROCEDURE_MISMATCH';
      end if;
      v_context_procedure_code := upper(nullif(trim(v_billing_context.procedure_code), ''));
      v_authorization_procedure_code := upper(coalesce(
        nullif(trim(v_authorization.procedure_tuss_code), ''),
        nullif(trim(v_authorization.procedure_code_snapshot), ''),
        nullif(trim(v_authorization.procedure_code), '')
      ));
      if v_billing_context.service_catalog_id is null
        and v_context_procedure_code is not null
        and v_authorization_procedure_code is not null
        and v_context_procedure_code <> v_authorization_procedure_code then
        raise exception using errcode = '22023', message = 'FINANCIAL_PROCEDURE_MISMATCH';
      end if;
      if p_professional_id <> v_appointment.therapist_id
        and not (coalesce(v_billing_context.metadata -> 'allowed_professional_ids', '[]'::jsonb) ? p_professional_id::text) then
        raise exception using errcode = '22023', message = 'FINANCIAL_PROFESSIONAL_REVIEW_REQUIRED';
      end if;

      -- Reuse the same commitment semantics as the canonical TISS reservation
      -- RPC: one appointment is counted once even when it also has a pre-guide.
      with commitment_candidates as (
        select context_row.appointment_id,
               true as is_future,
               false as is_historical_official
          from public.appointment_billing_contexts context_row
          join public.appointments appointment_row
            on appointment_row.id = context_row.appointment_id
           and (appointment_row.organization_id = p_organization_id or appointment_row.clinic_id = p_organization_id)
         where context_row.organization_id = p_organization_id
           and context_row.patient_id = p_patient_id
           and context_row.appointment_id <> p_appointment_id
           and coalesce(
             context_row.metadata ->> 'patient_tiss_authorization_id',
             context_row.metadata ->> 'patientTissAuthorizationId',
             context_row.metadata #>> '{tiss_authorization,authorizationId}',
             context_row.metadata #>> '{tissAuthorization,authorizationId}'
           ) = v_authorization_id::text
           and lower(coalesce(appointment_row.status, 'pending')) not in ('cancelled', 'canceled', 'deleted', 'refused')
           and coalesce(appointment_row.is_active, true)
           and appointment_row.deleted_at is null
           and coalesce(appointment_row.scheduled_start_at, appointment_row.scheduled_at) >= now()
        union all
        select pre_guide.appointment_id,
               coalesce(pre_guide.scheduled_start >= now(), false) as is_future,
               pre_guide.official_document_id is not null
                 and coalesce(pre_guide.scheduled_start < now(), true) as is_historical_official
          from public.appointment_tiss_pre_guides pre_guide
         where pre_guide.organization_id = p_organization_id
           and pre_guide.patient_id = p_patient_id
           and pre_guide.appointment_id <> p_appointment_id
           and coalesce(
             pre_guide.snapshot_data #>> '{authorization,authorizationId}',
             pre_guide.snapshot_data #>> '{authorization,id}'
           ) = v_authorization_id::text
           and lower(coalesce(pre_guide.status, 'pending_data')) not in ('cancelled', 'canceled', 'deleted', 'refused')
           and (pre_guide.official_document_id is not null or pre_guide.scheduled_start >= now())
      ), commitments as (
        select appointment_id,
               bool_or(is_future) as is_future,
               bool_or(is_historical_official) as is_historical_official
          from commitment_candidates
         group by appointment_id
      )
      select count(*) filter (where is_future)::integer,
             count(*) filter (where not is_future and is_historical_official)::integer
        into v_future_commitments, v_historical_official_commitments
        from commitments;

      v_authorized_quantity := greatest(0, coalesce(v_authorization.authorized_quantity, 0));
      v_consumed_quantity := greatest(0, coalesce(v_authorization.used_quantity, 0));
      v_reserved_quantity := greatest(0, v_future_commitments)
        + greatest(0, v_historical_official_commitments - v_consumed_quantity);

      if v_authorized_quantity > 0
        and v_consumed_quantity + v_reserved_quantity >= v_authorized_quantity then
        raise exception using errcode = '22023', message = 'FINANCIAL_AUTHORIZATION_NO_BALANCE';
      end if;
    end if;
  end if;

  -- Serialize approvals that compete for the same operational resources. The
  -- checks below then run against a stable view for this approval transaction.
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':patient:' || p_patient_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':professional:' || p_professional_id::text, 0));
  if lower(coalesce(p_location_type, 'clinica')) = 'clinica' then
    perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':room:' || p_room_id, 0));
  end if;

  if exists (
    select 1
     from public.appointments other
     where other.id <> p_appointment_id
       and other.clinic_id = p_clinic_id
       and coalesce(other.organization_id, other.clinic_id) = p_organization_id
       and other.patient_id = p_patient_id
       and other.deleted_at is null
       and coalesce(other.is_active, true)
       and lower(coalesce(other.status, 'scheduled')) not in ('cancelled', 'canceled', 'completed', 'no_show', 'missed', 'deleted')
       and coalesce(other.scheduled_start_at, other.scheduled_at) < p_scheduled_end
       and coalesce(
         other.scheduled_end_at,
         coalesce(other.scheduled_start_at, other.scheduled_at) + make_interval(mins => greatest(coalesce(other.scheduled_duration_minutes, other.duration_minutes, 50), 1))
       ) > p_scheduled_start
  ) then
    raise exception using errcode = '23P01', message = 'RESCHEDULE_PATIENT_CONFLICT';
  end if;

  if exists (
    select 1
     from public.appointments other
     where other.id <> p_appointment_id
       and other.clinic_id = p_clinic_id
       and coalesce(other.organization_id, other.clinic_id) = p_organization_id
       and (
         other.therapist_id = p_professional_id or exists (
           select 1 from public.appointment_professionals ap
            where ap.appointment_id = other.id and ap.professional_id = p_professional_id
         )
       )
       and other.deleted_at is null
       and coalesce(other.is_active, true)
       and lower(coalesce(other.status, 'scheduled')) not in ('cancelled', 'canceled', 'completed', 'no_show', 'missed', 'deleted')
       and coalesce(other.scheduled_start_at, other.scheduled_at) < p_scheduled_end + v_buffer
       and coalesce(
         other.scheduled_end_at,
         coalesce(other.scheduled_start_at, other.scheduled_at) + make_interval(mins => greatest(coalesce(other.scheduled_duration_minutes, other.duration_minutes, 50), 1))
       ) + v_buffer > p_scheduled_start
  ) then
    raise exception using errcode = '23P01', message = 'RESCHEDULE_PROFESSIONAL_CONFLICT';
  end if;

  if lower(coalesce(p_location_type, 'clinica')) = 'clinica' and exists (
    select 1
     from public.appointments other
     where other.id <> p_appointment_id
       and other.clinic_id = p_clinic_id
       and coalesce(other.organization_id, other.clinic_id) = p_organization_id
       and other.room_id = p_room_id
       and other.deleted_at is null
       and coalesce(other.is_active, true)
       and lower(coalesce(other.status, 'scheduled')) not in ('cancelled', 'canceled', 'completed', 'no_show', 'missed', 'deleted')
       and coalesce(other.scheduled_start_at, other.scheduled_at) < p_scheduled_end
       and coalesce(
         other.scheduled_end_at,
         coalesce(other.scheduled_start_at, other.scheduled_at) + make_interval(mins => greatest(coalesce(other.scheduled_duration_minutes, other.duration_minutes, 50), 1))
       ) > p_scheduled_start
  ) then
    raise exception using errcode = '23P01', message = 'RESCHEDULE_ROOM_CONFLICT';
  end if;

  v_old_start := coalesce(v_appointment.scheduled_start_at, v_appointment.scheduled_at);
  v_old_status := v_appointment.status;
  v_old_end := coalesce(
    v_appointment.scheduled_end_at,
    v_old_start + make_interval(mins => greatest(coalesce(v_appointment.scheduled_duration_minutes, v_appointment.duration_minutes, 50), 1))
  );

  update public.appointments
     set status = 'scheduled',
         scheduled_at = p_scheduled_start,
         scheduled_start_at = p_scheduled_start,
         scheduled_end_at = p_scheduled_end,
         scheduled_duration_minutes = p_duration_minutes,
         duration_minutes = p_duration_minutes,
         therapist_id = p_professional_id,
         room_id = case when lower(coalesce(p_location_type, 'clinica')) = 'clinica' then nullif(trim(coalesce(p_room_id, '')), '') else null end,
         room_name = case when lower(coalesce(p_location_type, 'clinica')) = 'clinica' then nullif(trim(coalesce(p_room_name, '')), '') else null end,
         location_type = lower(coalesce(nullif(trim(p_location_type), ''), 'clinica')),
         source_payload = coalesce(source_payload, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
           'professionalId', p_professional_id,
           'professionalName', nullif(trim(coalesce(p_professional_name, '')), ''),
           'therapistId', p_professional_id,
           'therapistName', nullif(trim(coalesce(p_professional_name, '')), ''),
           'roomId', case when lower(coalesce(p_location_type, 'clinica')) = 'clinica' then nullif(trim(coalesce(p_room_id, '')), '') else null end,
           'roomName', case when lower(coalesce(p_location_type, 'clinica')) = 'clinica' then nullif(trim(coalesce(p_room_name, '')), '') else null end,
           'roomDisplayName', nullif(coalesce(p_metadata ->> 'approvedRoomDisplayName', ''), ''),
           'roomSpecialtyName', nullif(coalesce(p_metadata ->> 'approvedRoomSpecialtyName', ''), ''),
           'scheduledStartAt', p_scheduled_start,
           'scheduledEndAt', p_scheduled_end,
           'durationMinutes', p_duration_minutes
         )),
         patient_response = null,
         patient_responded_at = null,
         patient_confirmation_status = null,
         patient_confirmation_at = null,
         patient_confirmation_by = null,
         patient_confirmation_source = null,
         reschedule_requested_at = null,
         reschedule_requested_by = null,
         notification_24h_sent_at = null,
         notification_12h_sent_at = null,
         notification_sent = false,
         notification_sent_at = null,
         notification_12h_sent = false,
         updated_at = v_now
   where id = p_appointment_id
   returning * into v_appointment;

  -- Do not depend on the historical partial unique index. The appointment row
  -- lock serializes this update and preserves auxiliary team members.
  select ap.id into v_team_member_id
    from public.appointment_professionals ap
   where ap.appointment_id = p_appointment_id
     and ap.professional_id = p_professional_id
   order by case when lower(coalesce(ap.role, '')) = 'responsavel' then 0 else 1 end, ap.created_at, ap.id
   limit 1
   for update;

  if v_team_member_id is not null then
    update public.appointment_professionals
       set organization_id = p_organization_id,
           clinic_id = p_clinic_id,
           professional_name = nullif(trim(coalesce(p_professional_name, '')), ''),
           role = 'responsavel'
     where id = v_team_member_id;
  else
    insert into public.appointment_professionals (
      organization_id, clinic_id, appointment_id, professional_id, professional_name, role
    ) values (
      p_organization_id, p_clinic_id, p_appointment_id, p_professional_id,
      nullif(trim(coalesce(p_professional_name, '')), ''), 'responsavel'
    );
  end if;

  update public.appointment_professionals
     set role = 'equipe'
   where appointment_id = p_appointment_id
     and professional_id <> p_professional_id
     and lower(coalesce(role, '')) = 'responsavel';

  if v_is_recovery then
    v_updated_request := v_request;
  else
    update public.appointment_action_requests
       set status = 'APPROVED',
           resolved_by = p_actor_id,
           resolved_at = v_now,
           resolution_note = nullif(trim(coalesce(p_resolution_note, '')), ''),
           metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
           updated_at = v_now
     where id = p_request_id and status = 'PENDING'
     returning * into v_updated_request;
    if not found then
      raise exception using errcode = '40001', message = 'RESCHEDULE_REQUEST_ALREADY_RESOLVED';
    end if;
  end if;

  select audit_row.*
    into v_audit
    from public.appointment_status_audit_logs audit_row
   where audit_row.organization_id = p_organization_id
     and audit_row.appointment_id = p_appointment_id
     and audit_row.action = 'RESCHEDULE_APPROVED'
     and audit_row.metadata ->> 'actionRequestId' = p_request_id::text
   order by audit_row.performed_at desc
   limit 1;

  if v_audit.id is null then
    insert into public.appointment_status_audit_logs (
      id, organization_id, appointment_id, patient_id, action,
      previous_status, new_status, performed_by, performed_by_role, performed_at, metadata
    ) values (
      gen_random_uuid(), p_organization_id, p_appointment_id, p_patient_id, 'RESCHEDULE_APPROVED',
      v_old_status, 'SCHEDULED', p_actor_id, p_actor_role, v_now,
      jsonb_build_object(
        'actionRequestId', p_request_id,
        'selectedOptionIndex', greatest(coalesce(p_selected_option_index, 0), 0),
        'previousScheduledStart', v_old_start,
        'previousScheduledEnd', v_old_end,
        'approvedScheduledStart', p_scheduled_start,
        'approvedScheduledEnd', p_scheduled_end,
        'approvedProfessionalId', p_professional_id,
        'approvedProfessionalName', nullif(trim(coalesce(p_professional_name, '')), ''),
        'approvedRoomId', p_room_id,
        'approvedRoomName', nullif(trim(coalesce(p_room_name, '')), ''),
        'approvedRoomDisplayName', nullif(coalesce(p_metadata ->> 'approvedRoomDisplayName', ''), ''),
        'approvedRoomSpecialtyName', nullif(coalesce(p_metadata ->> 'approvedRoomSpecialtyName', ''), ''),
        'confirmationReset', true,
        'resolutionNote', nullif(trim(coalesce(p_resolution_note, '')), '')
      )
    ) returning * into v_audit;
  end if;

  return jsonb_build_object(
    'idempotent', v_is_recovery,
    'repaired', v_is_recovery,
    'appointment', to_jsonb(v_appointment),
    'request', to_jsonb(v_updated_request),
    'audit', to_jsonb(v_audit)
  );
end;
$$;

revoke all on function public.approve_appointment_reschedule(
  uuid, uuid, uuid, uuid, uuid, integer, timestamptz, timestamptz, integer,
  uuid, text, text, text, text, integer, text, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.approve_appointment_reschedule(
  uuid, uuid, uuid, uuid, uuid, integer, timestamptz, timestamptz, integer,
  uuid, text, text, text, text, integer, text, text, text, jsonb
) to service_role;

comment on function public.approve_appointment_reschedule(
  uuid, uuid, uuid, uuid, uuid, integer, timestamptz, timestamptz, integer,
  uuid, text, text, text, text, integer, text, text, text, jsonb
) is 'Atomically moves the original appointment, resolves the reschedule request and writes its audit entry.';


-- Coordinates reschedule/cancellation decisions around the same appointment.

create or replace function public.approve_appointment_reschedule_v2(
  p_organization_id uuid,
  p_clinic_id uuid,
  p_request_id uuid,
  p_appointment_id uuid,
  p_patient_id uuid,
  p_selected_option_index integer,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz,
  p_duration_minutes integer,
  p_professional_id uuid,
  p_professional_name text,
  p_room_id text,
  p_room_name text,
  p_location_type text,
  p_session_buffer_minutes integer,
  p_actor_id text,
  p_actor_role text,
  p_resolution_note text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.appointment_action_requests%rowtype;
  v_appointment public.appointments%rowtype;
  v_result jsonb;
  v_was_pending boolean := false;
  v_idempotency_key text := nullif(coalesce(p_metadata ->> 'approvalIdempotencyKey', ''), '');
begin
  if lower(coalesce(p_actor_role, '')) = 'schema_probe'
     and lower(coalesce(p_metadata ->> 'schema_probe', 'false')) = 'true' then
    return jsonb_build_object(
      'compatible', true,
      'schema_version', '20260721123000'
    );
  end if;

  if lower(coalesce(p_actor_role, '')) not in ('owner', 'admin', 'coordinator') then
    raise exception using errcode = '42501', message = 'RESCHEDULE_APPROVAL_FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.users u
     where u.id::text = p_actor_id
       and u.clinic_id = p_clinic_id
       and lower(coalesce(u.role, '')) in ('owner', 'admin', 'coordinator')
  ) and not exists (
    select 1 from public.clinic_memberships cm
     where cm.user_id::text = p_actor_id
       and cm.clinic_id = p_clinic_id
       and lower(coalesce(cm.role, '')) in ('owner', 'admin', 'coordinator')
       and lower(coalesce(cm.status, 'active')) = 'active'
  ) then
    raise exception using errcode = '42501', message = 'RESCHEDULE_APPROVAL_FORBIDDEN';
  end if;

  select a.* into v_appointment
    from public.appointments a
   where a.id = p_appointment_id
     and a.patient_id = p_patient_id
     and a.clinic_id = p_clinic_id
     and coalesce(a.organization_id, a.clinic_id) = p_organization_id
     and a.deleted_at is null
     and coalesce(a.is_active, true)
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'RESCHEDULE_APPOINTMENT_NOT_FOUND';
  end if;

  perform 1
    from public.appointment_action_requests r
   where r.organization_id = p_organization_id
     and r.appointment_id = p_appointment_id
   order by r.id
   for update;

  select r.* into v_request
    from public.appointment_action_requests r
   where r.id = p_request_id
     and r.organization_id = p_organization_id
     and r.appointment_id = p_appointment_id
     and r.patient_id = p_patient_id
     and r.request_type = 'RESCHEDULE';
  if not found then
    raise exception using errcode = 'P0002', message = 'RESCHEDULE_REQUEST_NOT_FOUND';
  end if;

  if v_request.status = 'PENDING' and exists (
    select 1 from public.appointment_action_requests r
     where r.organization_id = p_organization_id
       and r.appointment_id = p_appointment_id
       and r.status = 'PENDING'
       and r.id <> p_request_id
       and (r.created_at > v_request.created_at or (r.created_at = v_request.created_at and r.id::text > v_request.id::text))
  ) then
    raise exception using errcode = '40001', message = 'ACTION_REQUEST_SUPERSEDED';
  end if;

  if v_request.status = 'APPROVED' then
    if v_idempotency_key is not null
      and nullif(coalesce(v_request.metadata ->> 'approvalIdempotencyKey', ''), '') is not null
      and v_request.metadata ->> 'approvalIdempotencyKey' <> v_idempotency_key then
      raise exception using errcode = '40001', message = 'RESCHEDULE_REQUEST_ALREADY_RESOLVED';
    end if;
    if nullif(coalesce(v_request.metadata ->> 'approvedOptionIndex', ''), '') is not null
      and (v_request.metadata ->> 'approvedOptionIndex')::integer <> p_selected_option_index then
      raise exception using errcode = '40001', message = 'RESCHEDULE_REQUEST_ALREADY_RESOLVED';
    end if;
    if nullif(coalesce(v_request.metadata ->> 'approvedStart', ''), '') is not null
      and (v_request.metadata ->> 'approvedStart')::timestamptz is distinct from p_scheduled_start then
      raise exception using errcode = '40001', message = 'RESCHEDULE_REQUEST_ALREADY_RESOLVED';
    end if;
    if nullif(coalesce(v_request.metadata ->> 'approvedEnd', ''), '') is not null
      and (v_request.metadata ->> 'approvedEnd')::timestamptz is distinct from p_scheduled_end then
      raise exception using errcode = '40001', message = 'RESCHEDULE_REQUEST_ALREADY_RESOLVED';
    end if;
    if nullif(coalesce(v_request.metadata ->> 'approvedProfessionalId', ''), '') is not null
      and v_request.metadata ->> 'approvedProfessionalId' <> p_professional_id::text then
      raise exception using errcode = '40001', message = 'RESCHEDULE_REQUEST_ALREADY_RESOLVED';
    end if;
    if coalesce(v_request.metadata ->> 'approvedRoomId', '') <> coalesce(p_room_id, '') then
      raise exception using errcode = '40001', message = 'RESCHEDULE_REQUEST_ALREADY_RESOLVED';
    end if;
  elsif v_request.status <> 'PENDING' then
    raise exception using errcode = '40001', message = 'RESCHEDULE_REQUEST_ALREADY_RESOLVED';
  else
    v_was_pending := true;
  end if;

  if v_was_pending and exists (
    select 1 from public.appointment_action_requests r
     where r.organization_id = p_organization_id
       and r.appointment_id = p_appointment_id
       and r.request_type = 'CANCEL'
       and r.status = 'PENDING'
  ) then
    update public.appointments
       set patient_response = 'reschedule_requested',
           patient_confirmation_status = 'RESCHEDULE_REQUESTED',
           patient_confirmation_source = 'patient_portal',
           updated_at = clock_timestamp()
     where id = p_appointment_id;
  end if;

  select public.approve_appointment_reschedule(
    p_organization_id, p_clinic_id, p_request_id, p_appointment_id, p_patient_id,
    p_selected_option_index, p_scheduled_start, p_scheduled_end, p_duration_minutes,
    p_professional_id, p_professional_name, p_room_id, p_room_name, p_location_type,
    p_session_buffer_minutes, p_actor_id, p_actor_role, p_resolution_note, p_metadata
  ) into v_result;

  if v_was_pending then
    with invalidated as (
      update public.appointment_action_requests r
         set status = 'CANCELLED',
             resolved_by = p_actor_id,
             resolved_at = clock_timestamp(),
             resolution_note = case
               when r.request_type = 'CANCEL' then 'Incompatível com a remarcação aprovada pela clínica.'
               else 'Substituída pela remarcação aprovada pela clínica.'
             end,
             metadata = coalesce(r.metadata, '{}'::jsonb) || jsonb_build_object(
               'resolvedByActionRequestId', p_request_id,
               'resolutionReason', 'reschedule_approved'
             ),
             updated_at = clock_timestamp()
       where r.organization_id = p_organization_id
         and r.appointment_id = p_appointment_id
         and r.id <> p_request_id
         and r.request_type in ('CANCEL', 'RESCHEDULE')
         and r.status = 'PENDING'
       returning r.id, r.request_type, r.created_at
    )
    insert into public.appointment_status_audit_logs (
      id, organization_id, appointment_id, patient_id, action,
      previous_status, new_status, performed_by, performed_by_role, performed_at, metadata
    )
    select gen_random_uuid(), p_organization_id, p_appointment_id, p_patient_id,
           case when invalidated.request_type = 'CANCEL' then 'CANCEL_REJECTED' else 'RESCHEDULE_REJECTED' end,
           v_appointment.status, 'SCHEDULED', p_actor_id, p_actor_role,
           clock_timestamp(), jsonb_build_object(
             'actionRequestId', invalidated.id,
             'resolvedByActionRequestId', p_request_id,
             'automaticResolution', true,
             'resolutionReason', 'reschedule_approved',
             'responsibleActionCreatedAt', invalidated.created_at
           )
      from invalidated
     where not exists (
       select 1 from public.appointment_status_audit_logs audit
        where audit.organization_id = p_organization_id
          and audit.appointment_id = p_appointment_id
          and audit.action = case when invalidated.request_type = 'CANCEL' then 'CANCEL_REJECTED' else 'RESCHEDULE_REJECTED' end
          and audit.metadata ->> 'actionRequestId' = invalidated.id::text
     );
  end if;

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'schema_version', '20260721123000',
    'action_requests', (
      select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id desc), '[]'::jsonb)
        from public.appointment_action_requests r
       where r.organization_id = p_organization_id
         and r.appointment_id = p_appointment_id
    ),
    'audit_entries', (
      select coalesce(jsonb_agg(to_jsonb(audit) order by audit.performed_at desc, audit.id desc), '[]'::jsonb)
        from (
          select a.*
            from public.appointment_status_audit_logs a
           where a.organization_id = p_organization_id
             and a.appointment_id = p_appointment_id
           order by a.performed_at desc, a.id desc
           limit 20
        ) audit
    )
  );
end;
$$;

revoke all on function public.approve_appointment_reschedule_v2(
  uuid, uuid, uuid, uuid, uuid, integer, timestamptz, timestamptz, integer,
  uuid, text, text, text, text, integer, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.approve_appointment_reschedule_v2(
  uuid, uuid, uuid, uuid, uuid, integer, timestamptz, timestamptz, integer,
  uuid, text, text, text, text, integer, text, text, text, jsonb
) to service_role;

comment on function public.approve_appointment_reschedule_v2(
  uuid, uuid, uuid, uuid, uuid, integer, timestamptz, timestamptz, integer,
  uuid, text, text, text, text, integer, text, text, text, jsonb
) is 'Atomically approves a reschedule using canonical schedule fields, locked financial validation and safe team mirroring.';

-- Rollback strategy: reapply the immediately previous appointment action
-- resolution migration if an operational rollback is required. No data rows,
-- appointments, billing contexts or team assignments are deleted here.
notify pgrst, 'reload schema';

-- Dedicated, data-free schema probe used by the Railway backend. This probe is
-- intentionally created after the appointment columns and RPCs above so that
-- returning the version means the complete reschedule contract was applied.
create or replace function public.get_reschedule_schema_version()
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select '20260721123000'::text;
$$;

revoke all on function public.get_reschedule_schema_version() from public, anon, authenticated;
grant execute on function public.get_reschedule_schema_version() to service_role;

comment on function public.get_reschedule_schema_version() is
  'Server-only, data-free probe for the Verto reschedule schema contract 20260721123000.';

-- One read-only catalog audit replaces repeated trial SELECTs during deploy.
create or replace function public.get_verto_critical_schema_status()
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_reschedule_signature text :=
    'public.approve_appointment_reschedule_v2(uuid,uuid,uuid,uuid,uuid,integer,timestamp with time zone,timestamp with time zone,integer,uuid,text,text,text,text,integer,text,text,text,jsonb)';
  v_reschedule_regprocedure regprocedure;
  v_service_role_execute boolean := false;
  v_anon_execute boolean := false;
  v_authenticated_execute boolean := false;
begin
  v_reschedule_regprocedure := to_regprocedure(v_reschedule_signature);
  if v_reschedule_regprocedure is not null then
    v_service_role_execute := has_function_privilege('service_role', v_reschedule_regprocedure, 'EXECUTE');
    v_anon_execute := has_function_privilege('anon', v_reschedule_regprocedure, 'EXECUTE');
    v_authenticated_execute := has_function_privilege('authenticated', v_reschedule_regprocedure, 'EXECUTE');
  end if;

  return jsonb_build_object(
    'reschedule', jsonb_build_object(
      'version', public.get_reschedule_schema_version(),
      'approve_rpc', v_reschedule_regprocedure is not null,
      'service_role_execute', v_service_role_execute,
      'anon_execute', v_anon_execute,
      'authenticated_execute', v_authenticated_execute,
      'appointment_columns', (
        select jsonb_object_agg(required.column_name, required.present order by required.column_name)
        from (
          select name as column_name,
                 exists (
                   select 1
                     from information_schema.columns c
                    where c.table_schema = 'public'
                      and c.table_name = 'appointments'
                      and c.column_name = name
                 ) as present
            from unnest(array[
              'id',
              'scheduled_at',
              'scheduled_start_at',
              'scheduled_end_at',
              'scheduled_duration_minutes',
              'therapist_id',
              'therapist_name',
              'room_id',
              'room_name',
              'patient_confirmation_status',
              'patient_confirmation_at',
              'patient_confirmation_by',
              'patient_confirmation_source',
              'source_payload',
              'notification_sent',
              'notification_sent_at',
              'notification_12h_sent',
              'notification_12h_sent_at'
            ]::text[]) as name
        ) required
      )
    ),
    'tasks', jsonb_build_object(
      'columns', (
        select jsonb_object_agg(required.column_name, required.present order by required.column_name)
        from (
          select name as column_name,
                 exists (
                   select 1
                     from information_schema.columns c
                    where c.table_schema = 'public'
                      and c.table_name = 'tasks'
                      and c.column_name = name
                 ) as present
            from unnest(array['max_score', 'is_active', 'deleted_at']::text[]) as name
        ) required
      )
    ),
    'invitations', jsonb_build_object(
      'columns', (
        select jsonb_object_agg(required.column_name, required.present order by required.column_name)
        from (
          select name as column_name,
                 exists (
                   select 1
                     from information_schema.columns c
                    where c.table_schema = 'public'
                      and c.table_name = 'invitations'
                      and c.column_name = name
                 ) as present
            from unnest(array[
              'clinic_name',
              'invited_by',
              'updated_at',
              'accepted_at',
              'canceled_at',
              'canceled_by'
            ]::text[]) as name
        ) required
      )
    )
  );
end;
$$;

revoke all on function public.get_verto_critical_schema_status() from public, anon, authenticated;
grant execute on function public.get_verto_critical_schema_status() to service_role;

comment on function public.get_verto_critical_schema_status() is
  'Server-only schema capability audit. Returns catalog booleans and never reads clinical rows.';

-- Force PostgREST to discover the repaired functions and grants only after the
-- whole transaction succeeds.
notify pgrst, 'reload schema';

-- Operational rollback: reapply the preceding known-good RPC migration and
-- drop only the two diagnostic functions if they must be removed. No clinical
-- or scheduling rows are modified by that rollback.
