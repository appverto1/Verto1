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
    if lower(coalesce(v_appointment.patient_confirmation_status, v_appointment.patient_response, ''))
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
         therapist_name = nullif(trim(coalesce(p_professional_name, '')), ''),
         room_id = case when lower(coalesce(p_location_type, 'clinica')) = 'clinica' then nullif(trim(coalesce(p_room_id, '')), '') else null end,
         room_name = case when lower(coalesce(p_location_type, 'clinica')) = 'clinica' then nullif(trim(coalesce(p_room_name, '')), '') else null end,
         location_type = lower(coalesce(nullif(trim(p_location_type), ''), 'clinica')),
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

  delete from public.appointment_professionals
   where appointment_id = p_appointment_id
     and lower(coalesce(role, '')) = 'responsavel';

  insert into public.appointment_professionals (
    organization_id, clinic_id, appointment_id, professional_id, professional_name, role
  ) values (
    p_organization_id, p_clinic_id, p_appointment_id, p_professional_id,
    nullif(trim(coalesce(p_professional_name, '')), ''), 'responsavel'
  )
  on conflict (appointment_id, professional_id) where professional_id is not null
  do update set
    organization_id = excluded.organization_id,
    clinic_id = excluded.clinic_id,
    professional_name = excluded.professional_name,
    role = excluded.role;

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
        'approvedRoomId', p_room_id,
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
