-- P1-27: Automatic cancellation ONLY following durable portal delivery of
-- the current schedule's 24-hour reminder, before the 12-hour window.
-- 12-hour reminders and unproven notifications retain clinic approval.
begin;

create or replace function public.cancel_portal_appointment_from_sent_24h_v1(
  p_organization_id uuid,
  p_appointment_id uuid,
  p_patient_id uuid,
  p_actor_id uuid,
  p_deployment_env text,
  p_reason text default null
)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_appt public.appointments%rowtype;
  v_job public.notification_jobs%rowtype;
  v_request public.appointment_action_requests%rowtype;
  v_previous text;
  v_now timestamptz := clock_timestamp();
  v_note text := left(nullif(btrim(coalesce(p_reason,'')),''),600);
begin
  if p_organization_id is null or p_appointment_id is null
    or p_patient_id is null or p_actor_id is null
    or p_deployment_env not in ('staging','production') then
    return jsonb_build_object('automatic',false,'reason','INVALID_SCOPE');
  end if;

  -- Lock the appointment first, consistently with clinician approval RPCs.
  select a.* into v_appt
    from public.appointments a
    where a.id=p_appointment_id and a.patient_id=p_patient_id
      and a.clinic_id=p_organization_id
      and coalesce(a.organization_id,a.clinic_id)=p_organization_id
      and a.deleted_at is null and coalesce(a.is_active,true)
    for update;
  if not found then
    return jsonb_build_object('automatic',false,'reason','APPOINTMENT_NOT_FOUND');
  end if;

  -- Idempotent replay only for our OWN documented automatic cancellation,
  -- never for a different cancellation performed by clinic staff.
  if lower(coalesce(v_appt.status,'')) in ('cancelled','canceled') then
    if exists (
      select 1 from public.appointment_action_requests r
      where r.organization_id=p_organization_id and r.appointment_id=p_appointment_id
        and r.patient_id=p_patient_id and r.request_type='CANCEL'
        and r.status='APPROVED'
        and r.metadata->>'resolutionReason'='sent_24h_reminder'
        and r.requested_by=p_actor_id::text
    ) then
      return jsonb_build_object('automatic',true,'idempotent',true,'appointment',to_jsonb(v_appt));
    end if;
    return jsonb_build_object('automatic',false,'reason','ALREADY_CANCELLED');
  end if;

  -- A 24-hour label from the client or the mere existence of a QUEUED job
  -- is never sufficient. Require SENT queue and a persisted portal delivery
  -- for the same patient, tenant, schedule, environment and recipient.
  if lower(coalesce(v_appt.status,'')) not in ('scheduled','confirmed')
     or v_appt.scheduled_at is null
     or v_now >= v_appt.scheduled_at - interval '12 hours'
     or v_now >= v_appt.scheduled_at then
    return jsonb_build_object('automatic',false,'reason','CUTOFF_OR_STATUS');
  end if;

  select j.* into v_job
    from public.notification_jobs j
    join public.portal_notifications n
      on n.deployment_env=p_deployment_env
      and n.idempotency_key=p_deployment_env||':notification-job:'||j.id::text
      and n.appointment_id=p_appointment_id
      and n.patient_id=p_patient_id
      and n.clinic_id=p_organization_id
      and n.type='appointment_reminder'
      and n.metadata->>'reminderKind'='24h'
      and n.sent_at is not null
      and (n.recipient_user_id=p_actor_id or (
        n.recipient_email is not null and lower(n.recipient_email)=
          (select lower(u.email) from public.users u where u.id=p_actor_id)
      ))
    where j.source_type='APPOINTMENT'
      and j.source_id=p_appointment_id
      and j.patient_id=p_patient_id
      and j.clinic_id=p_organization_id
      and j.deployment_env=p_deployment_env
      and j.notification_kind='APPOINTMENT_REMINDER_24H'
      and j.status='SENT' and j.sent_at is not null
      and j.sent_at<=v_now
      and (j.payload->>'scheduledAt')::timestamptz=v_appt.scheduled_at
      and (n.metadata->>'scheduledAt')::timestamptz=v_appt.scheduled_at
    order by j.sent_at desc limit 1;
  if not found then
    return jsonb_build_object('automatic',false,'reason','24H_DELIVERY_NOT_PROVEN');
  end if;

  -- A 12-hour reminder already sent explicitly eliminates auto-cancellation.
  if exists (
    select 1 from public.notification_jobs j
    where j.source_type='APPOINTMENT' and j.source_id=p_appointment_id
      and j.patient_id=p_patient_id and j.clinic_id=p_organization_id
      and j.deployment_env=p_deployment_env
      and j.notification_kind='APPOINTMENT_REMINDER_12H'
      and j.status='SENT' and j.sent_at is not null
      and (j.payload->>'scheduledAt')::timestamptz=v_appt.scheduled_at
  ) then return jsonb_build_object('automatic',false,'reason','12H_WINDOW'); end if;

  -- Approval and rescheduling resolve under the same appointment row lock.
  perform 1 from public.appointment_action_requests r
    where r.organization_id=p_organization_id
      and r.appointment_id=p_appointment_id order by r.id for update;

  select r.* into v_request from public.appointment_action_requests r
    where r.organization_id=p_organization_id and r.appointment_id=p_appointment_id
      and r.patient_id=p_patient_id and r.request_type='CANCEL'
      and r.status='PENDING'
    order by r.created_at desc,r.id desc limit 1;
  if v_request.id is null then
    insert into public.appointment_action_requests(
      organization_id,appointment_id,patient_id,requested_by,request_type,
      status,reason,note,resolved_by,resolved_at,resolution_note,metadata)
    values(p_organization_id,p_appointment_id,p_patient_id,p_actor_id::text,
      'CANCEL','APPROVED',v_note,'Solicitado após lembrete de 24 horas',
      p_actor_id::text,v_now,'Cancelamento automático pelo lembrete válido de 24 horas',
      jsonb_build_object('resolutionReason','sent_24h_reminder',
        'reminderJobId',v_job.id,'scheduledAt',v_appt.scheduled_at,'approvedAt',v_now))
    returning * into v_request;
  else
    update public.appointment_action_requests
      set status='APPROVED',resolved_by=p_actor_id::text,resolved_at=v_now,
        resolution_note='Cancelamento automático pelo lembrete válido de 24 horas',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'resolutionReason','sent_24h_reminder','reminderJobId',v_job.id,
          'scheduledAt',v_appt.scheduled_at,'approvedAt',v_now),updated_at=v_now
      where id=v_request.id and status='PENDING' returning * into v_request;
  end if;

  v_previous:=v_appt.status;
  update public.appointments
    set status='cancelled',patient_response='cancelled',
      patient_confirmation_status='CANCEL_REQUESTED',
      patient_confirmation_source='patient_24h_reminder_automatic',
      patient_responded_at=v_now,patient_confirmation_at=v_now,
      notification_24h_sent_at=null,notification_12h_sent_at=null,
      notification_sent=false,notification_sent_at=null,notification_12h_sent=false,
      updated_at=v_now
    where id=p_appointment_id returning * into v_appt;

  with invalidated as (
    update public.appointment_action_requests
      set status='CANCELLED',resolved_by=p_actor_id::text,resolved_at=v_now,
        resolution_note='Cancelamento automático pelo lembrete de 24 horas',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'resolutionReason','automatic_24h_cancel','resolvedByActionRequestId',v_request.id),
        updated_at=v_now
      where organization_id=p_organization_id and appointment_id=p_appointment_id
        and id<>v_request.id and status='PENDING' returning id,request_type
  )
  insert into public.appointment_status_audit_logs (
    organization_id,appointment_id,patient_id,action,previous_status,new_status,
    performed_by,performed_by_role,performed_at,metadata
  )
  select p_organization_id,p_appointment_id,p_patient_id,
    case when request_type='RESCHEDULE' then 'RESCHEDULE_REJECTED' else 'CANCEL_REJECTED' end,
    v_previous,'CANCELLED',p_actor_id::text,'responsible',v_now,
    jsonb_build_object('actionRequestId',id,'resolutionReason','automatic_24h_cancel',
      'resolvedByActionRequestId',v_request.id)
  from invalidated;

  insert into public.appointment_status_audit_logs (
    organization_id,appointment_id,patient_id,action,previous_status,new_status,
    performed_by,performed_by_role,performed_at,metadata
  ) values (
    p_organization_id,p_appointment_id,p_patient_id,'CANCEL_APPROVED',
    v_previous,'CANCELLED',p_actor_id::text,'responsible',v_now,
    jsonb_build_object('actionRequestId',v_request.id,
      'resolutionReason','sent_24h_reminder','reminderJobId',v_job.id,
      'automaticResolution',true)
  );

  return jsonb_build_object('automatic',true,'idempotent',false,
    'appointment',to_jsonb(v_appt),'request',to_jsonb(v_request));
end;
$$;
revoke all on function public.cancel_portal_appointment_from_sent_24h_v1(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.cancel_portal_appointment_from_sent_24h_v1(uuid,uuid,uuid,uuid,text,text) to service_role;
commit;
