-- P1-27. Patient-initiated cancellation from the exact delivered 24h reminder.
-- Strictly server-side; absence of reliable 24h provenance keeps clinic approval.
-- Atomic appointment / request / audit; no schema changes or data backfills.
begin;

create or replace function public.cancel_appointment_from_24h_reminder_v1(
  p_organization_id uuid,
  p_appointment_id uuid,
  p_patient_id uuid,
  p_actor_id uuid,
  p_notification_id uuid,
  p_deployment_env text,
  p_reason text default null,
  p_note text default null
) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  a public.appointments%rowtype;
  n public.portal_notifications%rowtype;
  j public.notification_jobs%rowtype;
  v_request_id uuid;
  v_now timestamptz := clock_timestamp();
  v_actor_email text;
  v_request public.appointment_action_requests%rowtype;
  v_status text;
begin
  if p_organization_id is null or p_appointment_id is null or p_patient_id is null
     or p_actor_id is null or p_notification_id is null
     or p_deployment_env is null or length(p_deployment_env) not between 1 and 60 then
    return jsonb_build_object('autoCanceled', false, 'reason', 'SCOPE_INVALID');
  end if;

  -- Consistent lock order with clinic-side cancellation/rescheduling: the
  -- appointment is locked before its action requests.
  select * into a from public.appointments
   where id=p_appointment_id and clinic_id=p_organization_id
     and coalesce(organization_id,clinic_id)=p_organization_id
     and patient_id=p_patient_id and is_active is distinct from false
     and deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('autoCanceled', false, 'reason', 'APPOINTMENT_UNAVAILABLE');
  end if;

  select * into n from public.portal_notifications
   where id=p_notification_id and deployment_env=p_deployment_env
     and appointment_id=p_appointment_id and patient_id=p_patient_id
     and (clinic_id=p_organization_id or organization_id=p_organization_id)
     and type in ('appointment_reminder', 'appointment_reminder_24h')
   for share;
  if not found then
    return jsonb_build_object('autoCanceled', false, 'reason', 'NOTIFICATION_UNAVAILABLE');
  end if;

  -- The portal login is an additional authorization boundary; do not accept
  -- a supplied email, user ID or notification ownership claim from the client.
  select lower(email) into v_actor_email from public.users where id=p_actor_id;
  if not ((n.recipient_user_id is not null and n.recipient_user_id=p_actor_id)
      or (n.recipient_email is not null and v_actor_email is not null
          and lower(n.recipient_email)=v_actor_email)) then
    return jsonb_build_object('autoCanceled', false, 'reason', 'RECIPIENT_MISMATCH');
  end if;

  -- Both stored records must identify the same actual *24h* notification,
  -- same deployment environment, patient, clinic and scheduled occurrence.
  -- The client-supplied notification ID is a locator, never authorization.
  if n.metadata->>'reminderKind' <> '24h'
     or n.sent_at is null or n.sent_at > v_now
     or n.metadata->>'deploymentEnv' is distinct from p_deployment_env
     or nullif(n.metadata->>'scheduledAt','') is null
     or n.metadata->>'scheduledAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
     or (n.metadata->>'scheduledAt')::timestamptz is distinct from a.scheduled_at then
    return jsonb_build_object('autoCanceled', false, 'reason', 'NOT_A_CURRENT_24H_REMINDER');
  end if;

  select * into j from public.notification_jobs
   where idempotency_key=n.idempotency_key
     and deployment_env=p_deployment_env
     and organization_id=p_organization_id and clinic_id=p_organization_id
     and patient_id=p_patient_id and source_type='APPOINTMENT'
     and source_id=p_appointment_id
     and notification_kind='APPOINTMENT_REMINDER_24H'
     and status='SENT' and sent_at is not null and sent_at <= v_now
     and scheduled_for <= v_now and created_at < scheduled_for
     and payload->>'scheduledAt' is not null
     and (payload->>'scheduledAt')::timestamptz=a.scheduled_at
     and n.idempotency_key=p_deployment_env||':notification-job:'||id::text
   for share;
  if not found then
    return jsonb_build_object('autoCanceled', false, 'reason', 'DELIVERY_UNVERIFIED');
  end if;

  -- A previous 24h notification must NOT act as a loophole after the 12h
  -- cutoff. Inside that window all new cancellation requests go to clinic.
  v_status := lower(coalesce(a.status,''));
  if v_status='cancelled' then
    if exists (
      select 1 from public.appointment_action_requests r
      where r.organization_id=p_organization_id and r.appointment_id=p_appointment_id
        and r.status='APPROVED' and r.request_type='CANCEL'
        and r.metadata->>'auto24hNotificationId'=p_notification_id::text
    ) then
      return jsonb_build_object('autoCanceled', true, 'idempotent', true, 'appointment', to_jsonb(a));
    end if;
    return jsonb_build_object('autoCanceled', false, 'reason', 'ALREADY_CANCELLED_BY_OTHER_ACTION');
  end if;

  if v_status not in ('scheduled','confirmed','pending_confirmation')
     or v_now >= a.scheduled_at - interval '12 hours'
     or v_now >= a.scheduled_at then
    return jsonb_build_object('autoCanceled', false, 'reason', 'CANCELLATION_REQUIRES_CLINIC');
  end if;

  perform 1 from public.appointment_action_requests r
   where r.organization_id=p_organization_id and r.appointment_id=p_appointment_id
   order by r.id for update;
  if exists (
    select 1 from public.appointment_action_requests r
    where r.organization_id=p_organization_id and r.appointment_id=p_appointment_id
      and r.status='PENDING'
  ) then
    return jsonb_build_object('autoCanceled', false, 'reason', 'PENDING_REQUEST_EXISTS');
  end if;

  v_request_id := gen_random_uuid();
  insert into public.appointment_action_requests
    (id,organization_id,appointment_id,patient_id,requested_by,request_type,
     status,reason,note,resolved_by,resolved_at,resolution_note,metadata,created_at,updated_at)
  values
    (v_request_id,p_organization_id,p_appointment_id,p_patient_id,p_actor_id::text,
     'CANCEL','APPROVED',nullif(left(btrim(coalesce(p_reason,'')),600),''),
     nullif(left(btrim(coalesce(p_note,'')),1000),''),
     p_actor_id::text,v_now,'Cancelamento automático a partir do lembrete válido de 24h.',
     jsonb_build_object('automaticResolution',true,'source','portal_reminder_24h',
       'auto24hNotificationId',p_notification_id::text,
       'deliveryJobId',j.id::text,'originalScheduledAt',a.scheduled_at),
     v_now,v_now);

  update public.appointments
    set status='cancelled',patient_response='cancelled',
        patient_responded_at=v_now,patient_confirmation_status='CANCELLED',
        patient_confirmation_at=v_now,patient_confirmation_by=p_actor_id::text,
        patient_confirmation_source='portal_reminder_24h_auto',
        cancel_requested_at=v_now,cancel_requested_by=p_actor_id::text,
        notification_24h_sent_at=null,notification_12h_sent_at=null,
        notification_sent=false,notification_sent_at=null,
        notification_12h_sent=false,updated_at=v_now
    where id=p_appointment_id
    returning * into a;

  insert into public.appointment_status_audit_logs
    (id,organization_id,appointment_id,patient_id,action,previous_status,
     new_status,performed_by,performed_by_role,performed_at,metadata)
  values(gen_random_uuid(),p_organization_id,p_appointment_id,p_patient_id,
    'CANCEL_APPROVED',upper(v_status),'CANCELLED',p_actor_id::text,'patient',v_now,
    jsonb_build_object('actionRequestId',v_request_id,'automaticResolution',true,
      'source','portal_reminder_24h','notificationId',p_notification_id,
      'deliveryJobId',j.id,'originalScheduledAt',a.scheduled_at));

  return jsonb_build_object('autoCanceled',true,'idempotent',false,
    'actionRequestId',v_request_id,'appointment',to_jsonb(a));
end;
$$;
revoke all on function public.cancel_appointment_from_24h_reminder_v1(uuid,uuid,uuid,uuid,uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.cancel_appointment_from_24h_reminder_v1(uuid,uuid,uuid,uuid,uuid,text,text,text)
  to service_role;
commit;
