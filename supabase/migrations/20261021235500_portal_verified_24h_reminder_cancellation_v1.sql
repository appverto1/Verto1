-- P1-27: a CANCEL action opened from a genuinely delivered 24-hour portal
-- reminder may cancel the exact session without waiting for clinic approval.
-- There is NO time-based bulk deletion or unconditional "24h ago" approval.
-- Mutations and audit are atomic, service-role only, and preserve the existing
-- manual 12h/general cancellation-request flow.
begin;

create or replace function public.cancel_appointment_from_verified_24h_reminder_v1(
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
)
returns jsonb
language plpgsql security invoker
set search_path=public,pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_request public.appointment_action_requests%rowtype;
  v_notice public.portal_notifications%rowtype;
  v_job public.notification_jobs%rowtype;
  v_now timestamptz := clock_timestamp();
  v_old_status text;
  v_actor text := p_actor_id::text;
  v_reason text := nullif(left(btrim(coalesce(p_reason,'')),600),'');
  v_note text := nullif(left(btrim(coalesce(p_note,'')),1000),'');
  v_cycle_start timestamptz;
begin
  if p_organization_id is null or p_clinic_id is null or p_patient_id is null
     or p_appointment_id is null or p_actor_id is null or p_notification_id is null
     or nullif(btrim(coalesce(p_deployment_env,'')),'') is null then
    return jsonb_build_object('applied',false,'reason','INVALID_SCOPE');
  end if;

  -- Use the same appointment-first lock order as clinic approval/reschedule.
  select a.* into v_appointment
    from public.appointments a
    where a.id=p_appointment_id and a.patient_id=p_patient_id
      and a.clinic_id=p_clinic_id
      and coalesce(a.organization_id,a.clinic_id)=p_organization_id
      and a.deleted_at is null and coalesce(a.is_active,true)
    for update;
  if not found then return jsonb_build_object('applied',false,'reason','APPOINTMENT_UNAVAILABLE'); end if;
  v_old_status:=v_appointment.status;

  -- Never allow a second automatic cancel using an old reminder to reverse
  -- a more recent clinic decision.
  if lower(coalesce(v_appointment.status,'')) in ('cancelled','canceled') then
    if exists (
      select 1 from public.appointment_status_audit_logs log
      where log.organization_id=p_organization_id and log.appointment_id=p_appointment_id
        and log.action='CANCEL_APPROVED'
        and log.metadata->>'notificationId'=p_notification_id::text
        and log.metadata->>'source'='verified_24h_portal_reminder'
    ) then
      return jsonb_build_object('applied',true,'idempotent',true,'appointment',to_jsonb(v_appointment));
    end if;
    return jsonb_build_object('applied',false,'reason','ALREADY_CANCELLED');
  end if;
  if lower(coalesce(v_appointment.status,'')) in ('completed','no_show','missed','deleted')
     or v_appointment.scheduled_at is null
     or v_now >= v_appointment.scheduled_at - interval '12 hours' then
    return jsonb_build_object('applied',false,'reason','REQUIRES_CLINIC_APPROVAL');
  end if;

  -- The notification ID alone is not authority. Prove its persisted origin:
  -- same authenticated recipient, same tenant/patient/appointment/environment,
  -- same schedule cycle, and a SENT queue job specifically for the 24h step.
  select n.* into v_notice from public.portal_notifications n
    where n.id=p_notification_id and n.deployment_env=p_deployment_env
      and n.organization_id=p_organization_id and n.clinic_id=p_clinic_id
      and n.patient_id=p_patient_id and n.appointment_id=p_appointment_id
      and n.type in ('appointment_reminder','appointment_reminder_24h')
      and n.metadata->>'reminderKind'='24h'
      and n.metadata->>'deploymentEnv'=p_deployment_env
      and (n.recipient_user_id=p_actor_id or (
        nullif(btrim(coalesce(p_actor_email,'')),'') is not null
        and lower(n.recipient_email)=lower(btrim(p_actor_email))
      ))
      and n.sent_at<=v_now
    limit 1;
  if not found then return jsonb_build_object('applied',false,'reason','REMINDER_NOT_AUTHENTICATED'); end if;

  if coalesce(v_notice.metadata->>'scheduledAt','') !~
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    return jsonb_build_object('applied',false,'reason','REMINDER_INVALID_CYCLE');
  end if;
  v_cycle_start:=(v_notice.metadata->>'scheduledAt')::timestamptz;
  if v_cycle_start is distinct from v_appointment.scheduled_at then
    return jsonb_build_object('applied',false,'reason','REMINDER_STALE_CYCLE');
  end if;

  select j.* into v_job from public.notification_jobs j
    where j.source_type='APPOINTMENT' and j.source_id=p_appointment_id
      and j.patient_id=p_patient_id and j.clinic_id=p_clinic_id
      and j.notification_kind='APPOINTMENT_REMINDER_24H'
      and j.status='SENT' and j.sent_at is not null
      and j.sent_at<=v_now and j.scheduled_for<=v_now
      and v_notice.idempotency_key=p_deployment_env||':notification-job:'||j.id::text
      and j.payload->>'scheduledAt'=v_notice.metadata->>'scheduledAt'
    limit 1;
  if not found then return jsonb_build_object('applied',false,'reason','REMINDER_NOT_SENT'); end if;

  -- A grouped booking involves additional participants and its own financial
  -- policy. It stays on the manual workflow until separately homologated.
  if to_regclass('public.group_session_participants') is not null and exists (
    select 1 from public.group_session_participants gp
    where gp.appointment_id=p_appointment_id
  ) then return jsonb_build_object('applied',false,'reason','GROUP_SESSION_MANUAL'); end if;

  perform 1 from public.appointment_action_requests r
    where r.organization_id=p_organization_id and r.appointment_id=p_appointment_id
    order by r.id for update;

  select r.* into v_request from public.appointment_action_requests r
    where r.organization_id=p_organization_id and r.appointment_id=p_appointment_id
      and r.patient_id=p_patient_id and r.request_type='CANCEL' and r.status='PENDING'
    limit 1;

  if v_request.id is not null then
    update public.appointment_action_requests
      set status='APPROVED', resolved_by=v_actor, resolved_at=v_now,
        resolution_note='Cancelamento automático autorizado pelo lembrete de 24h.',
        metadata=coalesce(metadata,'{}'::jsonb)||
          jsonb_build_object('source','verified_24h_portal_reminder',
            'notificationId',p_notification_id,'scheduleCycle',v_appointment.scheduled_at),
        updated_at=v_now
      where id=v_request.id and status='PENDING'
      returning * into v_request;
    if not found then raise exception 'REMINDER_CANCELLATION_REQUEST_CONFLICT'; end if;
  else
    insert into public.appointment_action_requests(
      organization_id,appointment_id,patient_id,requested_by,request_type,status,
      reason,note,resolved_by,resolved_at,resolution_note,metadata,created_at,updated_at
    ) values (
      p_organization_id,p_appointment_id,p_patient_id,v_actor,'CANCEL','APPROVED',
      v_reason,v_note,v_actor,v_now,
      'Cancelamento automático autorizado pelo lembrete de 24h.',
      jsonb_build_object('source','verified_24h_portal_reminder',
        'notificationId',p_notification_id,'scheduleCycle',v_appointment.scheduled_at),
      v_now,v_now
    ) returning * into v_request;
  end if;

  update public.appointment_action_requests
    set status='CANCELLED',resolved_by=v_actor,resolved_at=v_now,
      resolution_note='Substituída por cancelamento autorizado pelo lembrete de 24h.',
      metadata=coalesce(metadata,'{}'::jsonb)||
        jsonb_build_object('resolvedByActionRequestId',v_request.id,
                          'resolutionReason','automatic_reminder_24h_cancellation'),
      updated_at=v_now
    where organization_id=p_organization_id and appointment_id=p_appointment_id
      and status='PENDING' and id<>v_request.id;

  update public.appointments
    set status='cancelled',patient_response='cancelled',
      patient_confirmation_status='CANCEL_REQUESTED',
      patient_confirmation_source='verified_24h_portal_reminder',
      patient_responded_at=v_now, patient_confirmation_at=v_now,
      patient_confirmation_by=v_actor,
      cancel_requested_at=v_now,cancel_requested_by=v_actor,
      notification_24h_sent_at=null,notification_12h_sent_at=null,
      notification_sent=false,notification_sent_at=null,
      notification_12h_sent=false,updated_at=v_now
    where id=p_appointment_id
    returning * into v_appointment;

  insert into public.appointment_status_audit_logs(
    organization_id,appointment_id,patient_id,action,previous_status,new_status,
    performed_by,performed_by_role,performed_at,metadata
  ) values (
    p_organization_id,p_appointment_id,p_patient_id,'CANCEL_APPROVED',
    v_old_status,'CANCELLED',v_actor,'patient',v_now,
    jsonb_build_object('source','verified_24h_portal_reminder',
      'notificationId',p_notification_id,'notificationJobId',v_job.id,
      'scheduleCycle',v_cycle_start,'actionRequestId',v_request.id)
  );
  return jsonb_build_object(
    'applied',true,'idempotent',false,'appointment',to_jsonb(v_appointment),
    'request',to_jsonb(v_request)
  );
end;
$$;

revoke all on function public.cancel_appointment_from_verified_24h_reminder_v1(
  uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.cancel_appointment_from_verified_24h_reminder_v1(
  uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,text) to service_role;
commit;
