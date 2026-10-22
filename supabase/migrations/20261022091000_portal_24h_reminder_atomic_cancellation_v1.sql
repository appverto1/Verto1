-- P1-27: a patient's cancellation FROM a delivered 24h reminder is
-- immediately effective. A 12h reminder and all unproven requests retain
-- the clinic-approval flow. Stage migration only; service-role API only.
begin;

create or replace function public.cancel_appointment_from_24h_reminder_v1(
  p_organization_id uuid,
  p_clinic_id uuid,
  p_patient_id uuid,
  p_appointment_id uuid,
  p_notification_id uuid,
  p_actor_id text,
  p_deployment_env text,
  p_reason text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_request public.appointment_action_requests%rowtype;
  v_previous_status text;
  v_now timestamptz:=clock_timestamp();
  v_invalidated_id uuid;
  v_invalidated_at timestamptz;
begin
  if p_organization_id is null or p_clinic_id is null
    or p_patient_id is null or p_appointment_id is null
    or p_notification_id is null or nullif(btrim(coalesce(p_actor_id,'')),'') is null
    or nullif(btrim(coalesce(p_deployment_env,'')),'') is null
  then return jsonb_build_object('autoCancelled',false,'reason','INVALID_SCOPE'); end if;

  -- Same row lock as the clinic reschedule/cancellation approval transaction.
  -- Any concurrently rescheduled appointment must be re-validated under lock.
  select a.* into v_appointment
    from public.appointments a
    where a.id=p_appointment_id and a.patient_id=p_patient_id
      and a.clinic_id=p_clinic_id
      and coalesce(a.organization_id,a.clinic_id)=p_organization_id
      and a.deleted_at is null and coalesce(a.is_active,true)
    for update;
  if not found then return jsonb_build_object('autoCancelled',false,'reason','APPOINTMENT_UNAVAILABLE'); end if;

  -- Idempotent retry is valid ONLY for this exact notification and appointment.
  if lower(coalesce(v_appointment.status,'')) in ('cancelled','canceled') then
    select r.* into v_request from public.appointment_action_requests r
    where r.organization_id=p_organization_id
      and r.appointment_id=p_appointment_id and r.patient_id=p_patient_id
      and r.request_type='CANCEL' and r.status='APPROVED'
      and r.metadata->>'autoCancelNotificationId'=p_notification_id::text
    order by r.resolved_at desc limit 1;
    if found then
      return jsonb_build_object('autoCancelled',true,'idempotent',true,
        'appointment',to_jsonb(v_appointment),'actionRequest',to_jsonb(v_request));
    end if;
    return jsonb_build_object('autoCancelled',false,'reason','APPOINTMENT_ALREADY_CANCELLED');
  end if;

  if lower(coalesce(v_appointment.status,'')) in
     ('completed','concluido','concluida','no_show','no-show','deleted','archived')
     or v_appointment.scheduled_at <= v_now then
    return jsonb_build_object('autoCancelled',false,'reason','APPOINTMENT_NOT_CANCELABLE');
  end if;

  -- Never trust a client-supplied reminder kind, timestamp or notification ID.
  -- Prove an actual portal notification matches a SENT 24h job and the CURRENT
  -- appointment schedule. A 12h reminder never qualifies.
  perform 1
    from public.portal_notifications n
    join public.notification_jobs j
      on n.idempotency_key=p_deployment_env || ':notification-job:' || j.id::text
     and j.deployment_env=p_deployment_env
     and j.notification_kind='APPOINTMENT_REMINDER_24H'
     and j.source_type='APPOINTMENT' and j.source_id=p_appointment_id
     and j.patient_id=p_patient_id and j.clinic_id=p_clinic_id
     and coalesce(j.organization_id,j.clinic_id)=p_organization_id
     and j.status='SENT' and j.sent_at is not null and j.sent_at<=v_now
     and nullif(j.payload->>'scheduledAt','')::timestamptz=v_appointment.scheduled_at
    where n.id=p_notification_id and n.deployment_env=p_deployment_env
      and n.patient_id=p_patient_id and n.appointment_id=p_appointment_id
      and n.clinic_id=p_clinic_id
      and coalesce(n.organization_id,n.clinic_id)=p_organization_id
      and n.type='appointment_reminder'
      and n.metadata->>'reminderKind'='24h'
      and nullif(n.metadata->>'scheduledAt','')::timestamptz=v_appointment.scheduled_at
      and n.sent_at<=v_now
    for share of n,j;
  if not found then
    return jsonb_build_object('autoCancelled',false,'reason','24H_REMINDER_NOT_PROVEN');
  end if;

  v_previous_status:=v_appointment.status;
  perform 1 from public.appointment_action_requests r
    where r.organization_id=p_organization_id and r.appointment_id=p_appointment_id
    order by r.id for update;

  select r.* into v_request from public.appointment_action_requests r
    where r.organization_id=p_organization_id
      and r.appointment_id=p_appointment_id and r.patient_id=p_patient_id
      and r.request_type='CANCEL' and r.status='PENDING'
    order by r.created_at desc,r.id desc limit 1;
  if found then
    update public.appointment_action_requests r set
      status='APPROVED',resolved_by=p_actor_id,resolved_at=v_now,
      resolution_note='Cancelamento automático originado no lembrete válido de 24 horas.',
      metadata=coalesce(r.metadata,'{}'::jsonb)||jsonb_build_object(
        'autoCancelNotificationId',p_notification_id,'autoCancelReminderKind','24h',
        'automaticResolution',true,'approvedAt',v_now),
      updated_at=v_now
    where r.id=v_request.id and r.status='PENDING'
    returning * into v_request;
    if not found then raise exception '24H_CANCELLATION_REQUEST_RACE'; end if;
  else
    insert into public.appointment_action_requests (
      id,organization_id,appointment_id,patient_id,requested_by,request_type,status,
      reason,note,resolved_by,resolved_at,resolution_note,metadata,created_at,updated_at
    ) values (
      gen_random_uuid(),p_organization_id,p_appointment_id,p_patient_id,p_actor_id,
      'CANCEL','APPROVED',nullif(left(btrim(coalesce(p_reason,'')),600),''),
      nullif(left(btrim(coalesce(p_note,'')),1000),''),
      p_actor_id,v_now,'Cancelamento automático originado no lembrete válido de 24 horas.',
      jsonb_build_object('autoCancelNotificationId',p_notification_id,
        'autoCancelReminderKind','24h','automaticResolution',true,'approvedAt',v_now),
      v_now,v_now
    ) returning * into v_request;
  end if;

  -- Invalidate a pending reschedule atomically, as the clinic approval route does.
  for v_invalidated_id,v_invalidated_at in
    select r.id,r.created_at from public.appointment_action_requests r
    where r.organization_id=p_organization_id and r.appointment_id=p_appointment_id
      and r.request_type='RESCHEDULE' and r.status='PENDING'
    for update
  loop
    update public.appointment_action_requests r set
      status='CANCELLED',resolved_by=p_actor_id,resolved_at=v_now,
      resolution_note='Substituída por cancelamento válido de lembrete 24h.',
      metadata=coalesce(r.metadata,'{}'::jsonb)||jsonb_build_object(
        'resolvedByActionRequestId',v_request.id,'resolutionReason','24h_reminder_auto_cancel'),
      updated_at=v_now
    where r.id=v_invalidated_id and r.status='PENDING';

    insert into public.appointment_status_audit_logs(
      id,organization_id,appointment_id,patient_id,action,previous_status,new_status,
      performed_by,performed_by_role,performed_at,metadata
    ) values (
      gen_random_uuid(),p_organization_id,p_appointment_id,p_patient_id,
      'RESCHEDULE_REJECTED',v_previous_status,'CANCELLED',p_actor_id,'patient',v_now,
      jsonb_build_object('actionRequestId',v_invalidated_id,
        'resolvedByActionRequestId',v_request.id,'automaticResolution',true,
        'resolutionReason','24h_reminder_auto_cancel','responsibleActionCreatedAt',v_invalidated_at)
    );
  end loop;

  update public.appointments a set
    status='cancelled',
    cancel_requested_at=v_now,cancel_requested_by=p_actor_id,
    patient_response='cancelled',
    patient_responded_at=v_now,
    patient_confirmation_status='CANCEL_REQUESTED',
    patient_confirmation_source='patient_24h_reminder_auto_cancel',
    patient_confirmation_at=v_now,patient_confirmation_by=p_actor_id,
    notification_24h_sent_at=null,notification_12h_sent_at=null,
    notification_sent=false,notification_sent_at=null,notification_12h_sent=false,
    updated_at=v_now
  where a.id=p_appointment_id and a.clinic_id=p_clinic_id
    and a.patient_id=p_patient_id and a.scheduled_at=v_appointment.scheduled_at
    and a.status=v_previous_status
  returning * into v_appointment;
  if not found then raise exception '24H_CANCELLATION_APPOINTMENT_RACE'; end if;

  insert into public.appointment_status_audit_logs (
    id,organization_id,appointment_id,patient_id,action,previous_status,new_status,
    performed_by,performed_by_role,performed_at,metadata
  ) values (
    gen_random_uuid(),p_organization_id,p_appointment_id,p_patient_id,
    'CANCEL_APPROVED',v_previous_status,'CANCELLED',p_actor_id,'patient',v_now,
    jsonb_build_object('actionRequestId',v_request.id,'portalNotificationId',p_notification_id,
      'reminderKind','24h','automaticResolution',true,'source','patient_portal')
  );

  return jsonb_build_object('autoCancelled',true,'idempotent',false,
    'appointment',to_jsonb(v_appointment),'actionRequest',to_jsonb(v_request));
end;
$$;

revoke all on function public.cancel_appointment_from_24h_reminder_v1(
 uuid,uuid,uuid,uuid,uuid,text,text,text,text)
 from public,anon,authenticated;
grant execute on function public.cancel_appointment_from_24h_reminder_v1(
 uuid,uuid,uuid,uuid,uuid,text,text,text,text)
 to service_role;

commit;
