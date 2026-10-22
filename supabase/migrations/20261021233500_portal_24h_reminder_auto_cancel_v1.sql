-- P1-27: Only an authenticated portal action linked to a *sent* 24-hour
-- reminder for the current appointment schedule may cancel automatically.
-- Other requests, including 12-hour reminders, retain clinic approval.
-- Invoked server-side with validated portal scope; never grant to browsers.
begin;

create or replace function public.portal_cancel_from_sent_24h_reminder_v1(
  p_organization_id uuid,
  p_clinic_id uuid,
  p_patient_id uuid,
  p_appointment_id uuid,
  p_actor_id uuid,
  p_actor_email text,
  p_notification_id uuid,
  p_deployment_env text,
  p_reason text default null,
  p_note text default null
) returns jsonb
language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_notification public.portal_notifications%rowtype;
  v_job public.notification_jobs%rowtype;
  v_request public.appointment_action_requests%rowtype;
  v_previous_status text;
  v_now timestamptz := clock_timestamp();
  v_request_id uuid;
begin
  if p_organization_id is null or p_clinic_id is null
    or p_patient_id is null or p_appointment_id is null or p_actor_id is null
    or p_notification_id is null or nullif(btrim(p_deployment_env),'') is null then
    return jsonb_build_object('canceled',false,'code','REMINDER_SCOPE_INVALID');
  end if;

  -- Serialize with clinic cancellation, rescheduling and other portal actions.
  select a.* into v_appointment
  from public.appointments a
  where a.id=p_appointment_id and a.clinic_id=p_clinic_id
    and coalesce(a.organization_id,a.clinic_id)=p_organization_id
    and a.patient_id=p_patient_id and coalesce(a.is_active,true)
    and a.deleted_at is null
  for update;
  if not found then return jsonb_build_object('canceled',false,'code','APPOINTMENT_NOT_FOUND'); end if;

  select pn.* into v_notification from public.portal_notifications pn
  where pn.id=p_notification_id and pn.deployment_env=p_deployment_env
    and pn.patient_id=p_patient_id and pn.appointment_id=p_appointment_id
    and pn.clinic_id=p_clinic_id
    and coalesce(pn.organization_id,pn.clinic_id)=p_organization_id
    and pn.type in ('appointment_reminder','appointment_reminder_24h')
    and pn.metadata->>'reminderKind'='24h'
    and pn.sent_at is not null and pn.sent_at<=v_now
    and (
      pn.recipient_user_id=p_actor_id
      or (pn.recipient_user_id is null and
          nullif(btrim(coalesce(p_actor_email,'')),'') is not null and
          lower(btrim(pn.recipient_email))=lower(btrim(p_actor_email)))
    )
  limit 1;
  if not found then
    return jsonb_build_object('canceled',false,'code','REMINDER_NOT_ELIGIBLE');
  end if;

  -- Repeating the exact auto-cancel is safe even if cancellation triggers
  -- have since invalidated or cleared the original delivery job.
  if lower(coalesce(v_appointment.status,'')) in ('cancelled','canceled') then
    select ar.id into v_request_id from public.appointment_action_requests ar
    where ar.organization_id=p_organization_id and ar.appointment_id=p_appointment_id
      and ar.patient_id=p_patient_id and ar.request_type='CANCEL' and ar.status='APPROVED'
      and ar.metadata->>'autoCancelNotificationId'=p_notification_id::text
    order by ar.resolved_at desc limit 1;
    if v_request_id is not null then
      return jsonb_build_object('canceled',true,'idempotent',true,'requestId',v_request_id);
    end if;
    return jsonb_build_object('canceled',false,'code','APPOINTMENT_ALREADY_CANCELLED');
  end if;

  -- A visible portal notification alone does NOT prove delivery. It must map
  -- 1:1 to a finalized SENT queue job from this environment and appointment.
  select j.* into v_job from public.notification_jobs j
  where j.source_type='APPOINTMENT' and j.source_id=p_appointment_id
    and j.patient_id=p_patient_id and j.clinic_id=p_clinic_id
    and coalesce(j.organization_id,j.clinic_id)=p_organization_id
    and j.deployment_env=p_deployment_env
    and j.notification_kind='APPOINTMENT_REMINDER_24H'
    and j.status='SENT' and j.sent_at is not null and j.sent_at<=v_now
    and j.payload->>'scheduledAt' is not null
    and j.payload->>'scheduledAt'=v_notification.metadata->>'scheduledAt'
    and v_notification.idempotency_key=p_deployment_env||':notification-job:'||j.id::text
  limit 1;

  if not found then return jsonb_build_object('canceled',false,'code','REMINDER_DELIVERY_NOT_PROVEN'); end if;

  if v_appointment.scheduled_at is null or v_appointment.scheduled_at<=v_now
    or coalesce(v_job.payload->>'scheduledAt','') !~
      '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}'
    or (v_job.payload->>'scheduledAt')::timestamptz
      is distinct from v_appointment.scheduled_at then
    return jsonb_build_object('canceled',false,'code','REMINDER_SCHEDULE_CHANGED');
  end if;

  -- The group module has its own participant/financial lifecycle. A single
  -- appointment cancellation may not safely dissolve its group reservation.
  -- Route those cases through the clinic approval workflow instead.
  if to_regclass('public.group_session_participants') is not null then
    if exists (
      select 1 from public.group_session_participants gp
      where gp.organization_id=p_organization_id
        and gp.appointment_id=p_appointment_id
    ) then
      return jsonb_build_object('canceled',false,'code','GROUP_SESSION_REQUIRES_CLINIC_APPROVAL');
    end if;
  end if;

  if v_appointment.scheduled_start_at is not null and
     v_appointment.scheduled_start_at is distinct from v_appointment.scheduled_at then
    return jsonb_build_object('canceled',false,'code','REMINDER_SCHEDULE_CHANGED');
  end if;

  perform 1 from public.appointment_action_requests ar
  where ar.organization_id=p_organization_id and ar.appointment_id=p_appointment_id
  order by ar.id for update;

  if lower(coalesce(v_appointment.status,'')) in
    ('completed','concluded','no_show','missed','deleted','rescheduled') then
    return jsonb_build_object('canceled',false,'code','APPOINTMENT_TERMINAL');
  end if;

  select ar.* into v_request from public.appointment_action_requests ar
  where ar.organization_id=p_organization_id and ar.appointment_id=p_appointment_id
    and ar.patient_id=p_patient_id and ar.request_type='CANCEL' and ar.status='PENDING'
  order by ar.created_at desc,ar.id desc limit 1;

  if v_request.id is null then
    insert into public.appointment_action_requests (
      id,organization_id,appointment_id,patient_id,requested_by,
      request_type,status,reason,note,metadata,resolved_by,resolved_at,
      resolution_note,created_at,updated_at
    ) values (
      gen_random_uuid(),p_organization_id,p_appointment_id,p_patient_id,p_actor_id::text,
      'CANCEL','APPROVED',nullif(left(btrim(coalesce(p_reason,'')),600),''),
      nullif(left(btrim(coalesce(p_note,'')),1000),''),
      jsonb_build_object('source','portal_reminder_24h','autoCancelNotificationId',p_notification_id,
        'autoCancelJobId',v_job.id,'scheduledAt',v_appointment.scheduled_at),
      p_actor_id::text,v_now,'Cancelamento automático solicitado pelo responsável após lembrete de 24h.',v_now,v_now
    ) returning id into v_request_id;
  else
    update public.appointment_action_requests
    set status='APPROVED',resolved_by=p_actor_id::text,resolved_at=v_now,
      resolution_note='Cancelamento automático solicitado pelo responsável após lembrete de 24h.',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'source','portal_reminder_24h','autoCancelNotificationId',p_notification_id,
        'autoCancelJobId',v_job.id,'scheduledAt',v_appointment.scheduled_at),
      updated_at=v_now
    where id=v_request.id and status='PENDING'
    returning id into v_request_id;
    if v_request_id is null then raise exception 'AUTO_CANCEL_CONCURRENT_CHANGE'; end if;
  end if;

  v_previous_status:=v_appointment.status;
  update public.appointments a
    set status='cancelled', patient_response='cancelled',
      patient_confirmation_status='CANCEL_REQUESTED',
      patient_confirmation_source='portal_reminder_24h_auto_cancel',
      patient_responded_at=coalesce(patient_responded_at,v_now),
      patient_confirmation_at=coalesce(patient_confirmation_at,v_now),
      patient_confirmation_by=p_actor_id::text,
      cancel_requested_at=coalesce(cancel_requested_at,v_now),
      cancel_requested_by=p_actor_id::text,
      notification_24h_sent_at=null, notification_12h_sent_at=null,
      notification_sent=false, notification_sent_at=null,
      notification_12h_sent=false,updated_at=v_now
  where a.id=p_appointment_id;

  update public.appointment_action_requests ar
    set status='CANCELLED',resolved_by=p_actor_id::text,resolved_at=v_now,
      resolution_note='Sessão cancelada pelo responsável após lembrete de 24h.',
      metadata=coalesce(ar.metadata,'{}'::jsonb)||jsonb_build_object(
        'resolutionReason','portal_reminder_24h_auto_cancel','resolvedByActionRequestId',v_request_id),
      updated_at=v_now
  where ar.organization_id=p_organization_id and ar.appointment_id=p_appointment_id
    and ar.status='PENDING' and ar.request_type='RESCHEDULE';

  insert into public.appointment_status_audit_logs (
    id,organization_id,appointment_id,patient_id,action,
    previous_status,new_status,performed_by,performed_by_role,performed_at,metadata
  ) values (
    gen_random_uuid(),p_organization_id,p_appointment_id,p_patient_id,
    'CANCEL_APPROVED',v_previous_status,'CANCELLED',p_actor_id::text,'responsible',v_now,
    jsonb_build_object('actionRequestId',v_request_id,'autoCancellation',true,
      'source','portal_reminder_24h','notificationId',p_notification_id,'jobId',v_job.id)
  );

  return jsonb_build_object('canceled',true,'idempotent',false,'requestId',v_request_id);
end;
$$;
revoke all on function public.portal_cancel_from_sent_24h_reminder_v1(
  uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.portal_cancel_from_sent_24h_reminder_v1(
  uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,text) to service_role;
commit;
