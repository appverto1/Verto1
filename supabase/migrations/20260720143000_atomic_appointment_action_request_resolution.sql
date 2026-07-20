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
    'schema_version', '20260720143000',
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

create or replace function public.approve_appointment_cancellation(
  p_organization_id uuid,
  p_clinic_id uuid,
  p_request_id uuid,
  p_appointment_id uuid,
  p_patient_id uuid,
  p_actor_id text,
  p_actor_role text,
  p_resolution_note text,
  p_idempotency_key text
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
  v_previous_status text;
begin
  if lower(coalesce(p_actor_role, '')) not in ('owner', 'admin', 'coordinator') then
    raise exception using errcode = '42501', message = 'CANCELLATION_APPROVAL_FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.users u
     where u.id::text = p_actor_id and u.clinic_id = p_clinic_id
       and lower(coalesce(u.role, '')) in ('owner', 'admin', 'coordinator')
  ) and not exists (
    select 1 from public.clinic_memberships cm
     where cm.user_id::text = p_actor_id and cm.clinic_id = p_clinic_id
       and lower(coalesce(cm.role, '')) in ('owner', 'admin', 'coordinator')
       and lower(coalesce(cm.status, 'active')) = 'active'
  ) then
    raise exception using errcode = '42501', message = 'CANCELLATION_APPROVAL_FORBIDDEN';
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
    raise exception using errcode = 'P0002', message = 'CANCELLATION_APPOINTMENT_NOT_FOUND';
  end if;
  v_previous_status := v_appointment.status;

  perform 1 from public.appointment_action_requests r
   where r.organization_id = p_organization_id and r.appointment_id = p_appointment_id
   order by r.id for update;

  select r.* into v_request from public.appointment_action_requests r
   where r.id = p_request_id
     and r.organization_id = p_organization_id
     and r.appointment_id = p_appointment_id
     and r.patient_id = p_patient_id
     and r.request_type = 'CANCEL';
  if not found then
    raise exception using errcode = 'P0002', message = 'CANCELLATION_REQUEST_NOT_FOUND';
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

  if v_request.status = 'APPROVED' and lower(coalesce(v_appointment.status, '')) in ('cancelled', 'canceled') then
    return jsonb_build_object(
      'idempotent', true,
      'schema_version', '20260720143000',
      'appointment', to_jsonb(v_appointment),
      'request', to_jsonb(v_request),
      'action_requests', (
        select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id desc), '[]'::jsonb)
          from public.appointment_action_requests r
         where r.organization_id = p_organization_id
           and r.appointment_id = p_appointment_id
      ),
      'audit_entries', (
        select coalesce(jsonb_agg(to_jsonb(audit) order by audit.performed_at desc, audit.id desc), '[]'::jsonb)
          from (
            select a.* from public.appointment_status_audit_logs a
             where a.organization_id = p_organization_id and a.appointment_id = p_appointment_id
             order by a.performed_at desc, a.id desc limit 20
          ) audit
      )
    );
  end if;
  if v_request.status <> 'PENDING' then
    raise exception using errcode = '40001', message = 'CANCELLATION_REQUEST_ALREADY_RESOLVED';
  end if;

  update public.appointments
     set status = 'cancelled',
         patient_response = 'cancelled',
         patient_confirmation_status = 'CANCEL_REQUESTED',
         patient_confirmation_source = 'patient_request_approved_by_clinic',
         patient_responded_at = coalesce(patient_responded_at, v_now),
         patient_confirmation_at = coalesce(patient_confirmation_at, v_now),
         notification_24h_sent_at = null,
         notification_12h_sent_at = null,
         notification_sent = false,
         notification_sent_at = null,
         notification_12h_sent = false,
         updated_at = v_now
   where id = p_appointment_id
   returning * into v_appointment;

  update public.appointment_action_requests
     set status = 'APPROVED',
         resolved_by = p_actor_id,
         resolved_at = v_now,
         resolution_note = nullif(trim(coalesce(p_resolution_note, '')), ''),
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'approvalIdempotencyKey', nullif(trim(coalesce(p_idempotency_key, '')), ''),
           'approvedAt', v_now,
           'approvedBy', p_actor_id
         ),
         updated_at = v_now
   where id = p_request_id and status = 'PENDING'
   returning * into v_updated_request;
  if not found then
    raise exception using errcode = '40001', message = 'CANCELLATION_REQUEST_ALREADY_RESOLVED';
  end if;

  with invalidated as (
    update public.appointment_action_requests r
       set status = 'CANCELLED', resolved_by = p_actor_id, resolved_at = v_now,
           resolution_note = 'Incompatível com o cancelamento aprovado pela clínica.',
           metadata = coalesce(r.metadata, '{}'::jsonb) || jsonb_build_object(
             'resolvedByActionRequestId', p_request_id,
             'resolutionReason', 'cancellation_approved'
           ),
           updated_at = v_now
     where r.organization_id = p_organization_id
       and r.appointment_id = p_appointment_id
       and r.request_type = 'RESCHEDULE'
       and r.status = 'PENDING'
     returning r.id, r.created_at
  )
  insert into public.appointment_status_audit_logs (
    id, organization_id, appointment_id, patient_id, action,
    previous_status, new_status, performed_by, performed_by_role, performed_at, metadata
  )
  select gen_random_uuid(), p_organization_id, p_appointment_id, p_patient_id,
         'RESCHEDULE_REJECTED', v_previous_status, 'CANCELLED', p_actor_id, p_actor_role,
         v_now, jsonb_build_object(
           'actionRequestId', invalidated.id,
           'resolvedByActionRequestId', p_request_id,
           'automaticResolution', true,
           'resolutionReason', 'cancellation_approved',
           'responsibleActionCreatedAt', invalidated.created_at
         )
    from invalidated
   where not exists (
     select 1 from public.appointment_status_audit_logs audit
      where audit.organization_id = p_organization_id
        and audit.appointment_id = p_appointment_id
        and audit.action = 'RESCHEDULE_REJECTED'
        and audit.metadata ->> 'actionRequestId' = invalidated.id::text
   );

  select audit.* into v_audit
    from public.appointment_status_audit_logs audit
   where audit.organization_id = p_organization_id
     and audit.appointment_id = p_appointment_id
     and audit.action = 'CANCEL_APPROVED'
     and audit.metadata ->> 'actionRequestId' = p_request_id::text
   order by audit.performed_at desc limit 1;
  if v_audit.id is null then
    insert into public.appointment_status_audit_logs (
      id, organization_id, appointment_id, patient_id, action,
      previous_status, new_status, performed_by, performed_by_role, performed_at, metadata
    ) values (
      gen_random_uuid(), p_organization_id, p_appointment_id, p_patient_id,
      'CANCEL_APPROVED', v_previous_status, 'CANCELLED', p_actor_id, p_actor_role, v_now,
      jsonb_build_object('actionRequestId', p_request_id, 'resolutionNote', nullif(trim(coalesce(p_resolution_note, '')), ''))
    ) returning * into v_audit;
  end if;

  return jsonb_build_object(
    'idempotent', false,
    'schema_version', '20260720143000',
    'appointment', to_jsonb(v_appointment),
    'request', to_jsonb(v_updated_request),
    'audit', to_jsonb(v_audit),
    'action_requests', (
      select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id desc), '[]'::jsonb)
        from public.appointment_action_requests r
       where r.organization_id = p_organization_id
         and r.appointment_id = p_appointment_id
    ),
    'audit_entries', (
      select coalesce(jsonb_agg(to_jsonb(audit) order by audit.performed_at desc, audit.id desc), '[]'::jsonb)
        from (
          select a.* from public.appointment_status_audit_logs a
           where a.organization_id = p_organization_id and a.appointment_id = p_appointment_id
           order by a.performed_at desc, a.id desc limit 20
        ) audit
    )
  );
end;
$$;

create or replace function public.reject_appointment_action_request(
  p_organization_id uuid,
  p_clinic_id uuid,
  p_request_id uuid,
  p_appointment_id uuid,
  p_patient_id uuid,
  p_actor_id text,
  p_actor_role text,
  p_resolution_note text,
  p_idempotency_key text
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
  v_remaining_type text;
  v_now timestamptz := clock_timestamp();
  v_audit_action text;
begin
  if lower(coalesce(p_actor_role, '')) not in ('owner', 'admin', 'coordinator') then
    raise exception using errcode = '42501', message = 'ACTION_REQUEST_REJECTION_FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.users u
     where u.id::text = p_actor_id and u.clinic_id = p_clinic_id
       and lower(coalesce(u.role, '')) in ('owner', 'admin', 'coordinator')
  ) and not exists (
    select 1 from public.clinic_memberships cm
     where cm.user_id::text = p_actor_id and cm.clinic_id = p_clinic_id
       and lower(coalesce(cm.role, '')) in ('owner', 'admin', 'coordinator')
       and lower(coalesce(cm.status, 'active')) = 'active'
  ) then
    raise exception using errcode = '42501', message = 'ACTION_REQUEST_REJECTION_FORBIDDEN';
  end if;

  select a.* into v_appointment from public.appointments a
   where a.id = p_appointment_id and a.patient_id = p_patient_id and a.clinic_id = p_clinic_id
     and coalesce(a.organization_id, a.clinic_id) = p_organization_id
     and a.deleted_at is null and coalesce(a.is_active, true)
   for update;
  if not found then raise exception using errcode = 'P0002', message = 'ACTION_REQUEST_APPOINTMENT_NOT_FOUND'; end if;

  perform 1 from public.appointment_action_requests r
   where r.organization_id = p_organization_id and r.appointment_id = p_appointment_id
   order by r.id for update;
  select r.* into v_request from public.appointment_action_requests r
   where r.id = p_request_id and r.organization_id = p_organization_id
     and r.appointment_id = p_appointment_id and r.patient_id = p_patient_id;
  if not found then raise exception using errcode = 'P0002', message = 'ACTION_REQUEST_NOT_FOUND'; end if;

  if v_request.status = 'REJECTED' then
    return jsonb_build_object(
      'idempotent', true, 'schema_version', '20260720143000',
      'appointment', to_jsonb(v_appointment), 'request', to_jsonb(v_request),
      'action_requests', (
        select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id desc), '[]'::jsonb)
          from public.appointment_action_requests r
         where r.organization_id = p_organization_id and r.appointment_id = p_appointment_id
      ),
      'audit_entries', (
        select coalesce(jsonb_agg(to_jsonb(audit) order by audit.performed_at desc, audit.id desc), '[]'::jsonb)
          from (
            select a.* from public.appointment_status_audit_logs a
             where a.organization_id = p_organization_id and a.appointment_id = p_appointment_id
             order by a.performed_at desc, a.id desc limit 20
          ) audit
      )
    );
  end if;
  if v_request.status <> 'PENDING' then
    raise exception using errcode = '40001', message = 'ACTION_REQUEST_ALREADY_RESOLVED';
  end if;

  update public.appointment_action_requests
     set status = 'REJECTED', resolved_by = p_actor_id, resolved_at = v_now,
         resolution_note = nullif(trim(coalesce(p_resolution_note, '')), ''),
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'rejectionIdempotencyKey', nullif(trim(coalesce(p_idempotency_key, '')), ''),
           'rejectedAt', v_now, 'rejectedBy', p_actor_id
         ),
         updated_at = v_now
   where id = p_request_id and status = 'PENDING'
   returning * into v_updated_request;
  if not found then raise exception using errcode = '40001', message = 'ACTION_REQUEST_ALREADY_RESOLVED'; end if;

  select r.request_type into v_remaining_type
    from public.appointment_action_requests r
   where r.organization_id = p_organization_id and r.appointment_id = p_appointment_id and r.status = 'PENDING'
   order by r.created_at desc, r.id desc limit 1;

  update public.appointments
     set patient_response = case when v_remaining_type = 'CANCEL' then 'cancel_requested' when v_remaining_type = 'RESCHEDULE' then 'reschedule_requested' else null end,
         patient_confirmation_status = case when v_remaining_type = 'CANCEL' then 'CANCEL_REQUESTED' when v_remaining_type = 'RESCHEDULE' then 'RESCHEDULE_REQUESTED' else null end,
         patient_confirmation_source = case when v_remaining_type is not null then 'patient_portal' else null end,
         updated_at = v_now
   where id = p_appointment_id
   returning * into v_appointment;

  v_audit_action := case when v_request.request_type = 'CANCEL' then 'CANCEL_REJECTED' else 'RESCHEDULE_REJECTED' end;
  insert into public.appointment_status_audit_logs (
    id, organization_id, appointment_id, patient_id, action,
    previous_status, new_status, performed_by, performed_by_role, performed_at, metadata
  ) values (
    gen_random_uuid(), p_organization_id, p_appointment_id, p_patient_id,
    v_audit_action, v_request.status, v_appointment.status, p_actor_id, p_actor_role, v_now,
    jsonb_build_object('actionRequestId', p_request_id, 'resolutionNote', nullif(trim(coalesce(p_resolution_note, '')), ''))
  ) returning * into v_audit;

  return jsonb_build_object(
    'idempotent', false, 'schema_version', '20260720143000',
    'appointment', to_jsonb(v_appointment), 'request', to_jsonb(v_updated_request), 'audit', to_jsonb(v_audit),
    'action_requests', (
      select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id desc), '[]'::jsonb)
        from public.appointment_action_requests r
       where r.organization_id = p_organization_id and r.appointment_id = p_appointment_id
    ),
    'audit_entries', (
      select coalesce(jsonb_agg(to_jsonb(audit) order by audit.performed_at desc, audit.id desc), '[]'::jsonb)
        from (
          select a.* from public.appointment_status_audit_logs a
           where a.organization_id = p_organization_id and a.appointment_id = p_appointment_id
           order by a.performed_at desc, a.id desc limit 20
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

revoke all on function public.approve_appointment_cancellation(uuid, uuid, uuid, uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.approve_appointment_cancellation(uuid, uuid, uuid, uuid, uuid, text, text, text, text)
  to service_role;

revoke all on function public.reject_appointment_action_request(uuid, uuid, uuid, uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.reject_appointment_action_request(uuid, uuid, uuid, uuid, uuid, text, text, text, text)
  to service_role;

comment on function public.approve_appointment_reschedule_v2(
  uuid, uuid, uuid, uuid, uuid, integer, timestamptz, timestamptz, integer,
  uuid, text, text, text, text, integer, text, text, text, jsonb
) is 'Atomically approves a reschedule and invalidates an incompatible pending cancellation.';
