-- Production promotion: portal cancellation and commercial integrity. Original reviewed SQLs are retained under

-- supabase/operations/promotion_staging_sources and must not be applied separately.

begin;

set local lock_timeout = '5s';

set local statement_timeout = '180s';

do $$ begin
  if to_regprocedure('public.create_sales_kanban_opportunities_v3(jsonb,uuid,text,jsonb,jsonb)') is not null
    or to_regprocedure('public.cancel_appointment_from_24h_reminder_v1(uuid,uuid,uuid,uuid,uuid,text,text,text,text)') is not null then
    raise exception 'PROMOTION_PORTAL_COMMERCIAL_SCHEMA_ALREADY_PRESENT';
  end if;
end $$;

-- Source: 20261022091000_portal_24h_reminder_atomic_cancellation_v1.sql; sha256 a760a56d45f6bdc99432d291ce09ed2a6b19f4342f266b86909ee7b4e53f928e

-- P1-27: a patient's cancellation FROM a delivered 24h reminder is
-- immediately effective. A 12h reminder and all unproven requests retain
-- the clinic-approval flow. Stage migration only; service-role API only.

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
     or v_appointment.scheduled_at <= v_now + interval '12 hours' then
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
      -- Bind the notification to the authenticated recipient, not only to
      -- the patient shared with other authorized family members.
      and n.recipient_user_id::text=p_actor_id
      and n.clinic_id=p_clinic_id
      and coalesce(n.organization_id,n.clinic_id)=p_organization_id
      and n.type='appointment_reminder'
      and n.metadata->>'reminderKind'='24h'
      and nullif(n.metadata->>'scheduledAt','')::timestamptz=v_appointment.scheduled_at
      and n.sent_at<=v_now
      -- A 12h reminder already delivered for this exact schedule means
      -- cancellation now requires the clinic, even if a 24h card is opened.
      and not exists (
        select 1 from public.notification_jobs j12
        where j12.deployment_env=p_deployment_env
          and j12.notification_kind='APPOINTMENT_REMINDER_12H'
          and j12.source_type='APPOINTMENT' and j12.source_id=p_appointment_id
          and j12.patient_id=p_patient_id and j12.clinic_id=p_clinic_id
          and j12.status='SENT'
          and nullif(j12.payload->>'scheduledAt','')::timestamptz=v_appointment.scheduled_at
      )
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

-- Source: 20261105101500_sales_kanban_creation_details_atomic_v3.sql; sha256 0968ea60262231a135d9ef05b886590ea829215687990e6f3c231a0df041af69

-- Smoke 02: manual CRM opportunity identification is persisted in the same
-- atomic, idempotent transaction as the existing phone/channel batch.
-- The legacy v1/v2 RPCs, their callers and prior creation batches stay intact.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.sales_kanban_creation_channel_batches
  add column if not exists details_hash text;

create or replace function public.create_sales_kanban_opportunities_v3(
  p_phones jsonb,
  p_actor_id uuid,
  p_action_key text,
  p_channels jsonb,
  p_details jsonb
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_batch public.sales_kanban_creation_channel_batches%rowtype;
  v_entry jsonb;
  v_details jsonb := '[]'::jsonb;
  v_created jsonb;
  v_result jsonb;
  v_name text;
  v_clinic text;
  v_email text;
  v_seen_emails text[] := array[]::text[];
  v_request_hash text;
  v_details_hash text;
begin
  -- Never treat the frontend actor ID as authority. The server's MFA guard
  -- remains mandatory, and the database re-checks an active platform admin.
  if p_actor_id is null or not exists (
    select 1 from public.platform_admins where user_id = p_actor_id and active = true
  ) then
    raise exception 'PLATFORM_ADMIN_REQUIRED';
  end if;
  if p_action_key is null or char_length(p_action_key) not between 12 and 120 then
    raise exception 'INVALID_CREATION_KEY';
  end if;
  if jsonb_typeof(p_phones) is distinct from 'array'
     or jsonb_array_length(p_phones) not between 1 and 100
     or jsonb_typeof(p_channels) is distinct from 'array'
     or jsonb_array_length(p_channels) <> jsonb_array_length(p_phones)
     or jsonb_typeof(p_details) is distinct from 'array'
     or jsonb_array_length(p_details) <> jsonb_array_length(p_phones) then
    raise exception 'INVALID_CREATION_DETAILS';
  end if;

  -- Validate all rows before any insertion. Reject unknown fields, oversized
  -- strings, malformed addresses, and duplicate contact e-mails in the batch.
  for v_entry in select value from jsonb_array_elements(p_details) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(v_entry) k
                  where k not in ('name','clinicName','email'))
       or exists (select 1 from jsonb_each(v_entry) e
                  where jsonb_typeof(e.value) not in ('string','null')) then
      raise exception 'INVALID_CREATION_DETAILS';
    end if;
    v_name := btrim(coalesce(v_entry->>'name',''));
    v_clinic := btrim(coalesce(v_entry->>'clinicName',''));
    v_email := lower(btrim(coalesce(v_entry->>'email','')));
    if (v_name <> '' and char_length(v_name) < 2)
       or char_length(v_name) > 180
       or char_length(v_clinic) > 180
       or char_length(v_email) > 254
       or (v_email <> '' and (char_length(v_email) < 3
                             or v_email !~ '^[^ @]+@[^ @]+[.][^ @]+$'))
       or v_name ~ '[[:cntrl:]]'
       or v_clinic ~ '[[:cntrl:]]'
       or v_email ~ '[[:cntrl:]]' then
      raise exception 'INVALID_CREATION_DETAILS';
    end if;
    if v_email <> '' then
      if v_email = any(v_seen_emails) then
        raise exception 'DUPLICATE_EMAIL_IN_BATCH';
      end if;
      v_seen_emails := array_append(v_seen_emails, v_email);
    end if;
    v_details := v_details || jsonb_build_array(jsonb_build_object(
      'name', nullif(v_name,''),
      'clinicName', nullif(v_clinic,''),
      'email', nullif(v_email,'')
    ));
  end loop;

  -- Reuse the same per-action advisory lock and batch row as v2.
  -- A retry must match phones, channels, actor AND initial contact details.
  v_request_hash := md5(p_phones::text || '|' || p_channels::text || '|' || p_actor_id::text);
  v_details_hash := md5(v_details::text);
  perform pg_advisory_xact_lock(hashtextextended(
    'sales-kanban-acquisition-create:' || p_action_key, 0
  ));
  select * into v_batch
    from public.sales_kanban_creation_channel_batches
    where idempotency_key = p_action_key for update;
  if found then
    if v_batch.actor_user_id is distinct from p_actor_id
       or v_batch.request_hash <> v_request_hash
       or v_batch.details_hash is distinct from v_details_hash then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return v_batch.response;
  end if;

  -- Existing v2 authority enforces phone uniqueness, channel catalog
  -- availability, the legacy creation audit and durable batch replay.
  v_created := public.create_sales_kanban_opportunities_v2(
    p_phones, p_actor_id, p_action_key, p_channels
  );

  -- ONE bounded update for up to 100 contacts, not per-contact HTTP requests.
  -- Any unique e-mail violation rolls back the entire creation transaction.
  with provided as (
    select (created.value->>'id')::uuid as lead_id,
      detail.value->>'name' as contact_name,
      detail.value->>'clinicName' as clinic_name,
      detail.value->>'email' as contact_email
    from jsonb_array_elements(v_created) with ordinality as created(value, position)
    join jsonb_array_elements(v_details) with ordinality as detail(value, position)
      on detail.position = created.position
  )
  update public.sales_leads l set
    name = coalesce(provided.contact_name, l.name),
    clinic_name = coalesce(provided.clinic_name, l.clinic_name),
    email = coalesce(provided.contact_email, l.email),
    normalized_email = coalesce(provided.contact_email, l.normalized_email),
    updated_at = clock_timestamp()
  from provided
  where l.id = provided.lead_id
    and (provided.contact_name is not null
         or provided.clinic_name is not null
         or provided.contact_email is not null);

  select coalesce(jsonb_agg(
    created.value || jsonb_build_object(
      'name', l.name,
      'clinicName', l.clinic_name,
      'email', l.email,
      'updatedAt', l.updated_at
    ) order by created.position
  ), '[]'::jsonb)
  into v_result
  from jsonb_array_elements(v_created) with ordinality as created(value, position)
  join public.sales_leads l on l.id = (created.value->>'id')::uuid;

  if jsonb_array_length(v_result) <> jsonb_array_length(v_created) then
    raise exception 'CREATION_DETAILS_INCOMPLETE';
  end if;

  update public.sales_kanban_creation_channel_batches set
    details_hash = v_details_hash,
    response = v_result
  where idempotency_key = p_action_key and actor_user_id = p_actor_id;

  return v_result;
end $$;

revoke all on function public.create_sales_kanban_opportunities_v3(
  jsonb, uuid, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.create_sales_kanban_opportunities_v3(
  jsonb, uuid, text, jsonb, jsonb
) to service_role;

notify pgrst, 'reload schema';

-- Source: 20261108195000_sales_website_existing_customer_guard.sql; sha256 da98d7625fcec1ddf3b20ed6397efabce3029f2e5a72d36557a634a4be79a82d

-- Public lead signup must not reclassify or overwrite converted customers.
-- Existing sales leads, paid offers, clinics and events are preserved.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.upsert_public_sales_lead(p_name text, p_email text, p_normalized_email text, p_phone text, p_normalized_phone text, p_professional_registry text, p_clinic_name text, p_city text, p_state text, p_estimated_active_patients integer, p_estimated_professionals integer, p_operation_type text, p_acquisition_channel text, p_job_title text, p_preferred_contact_period text, p_notes text, p_consent_version text, p_consent_origin text, p_consent_purpose text, p_source text, p_idempotency_key text)
 RETURNS TABLE(lead_id uuid, event_created boolean, lead_created boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lead_id uuid;
  v_email_lead_id uuid;
  v_phone_lead_id uuid;
  v_created boolean := false;
  v_event_created boolean := false;
  v_event_type public.sales_lead_event_type;
  v_rows integer := 0;
  v_name text := nullif(btrim(p_name), '');
  v_email text := nullif(lower(btrim(p_email)), '');
  v_normalized_email text := nullif(lower(btrim(p_normalized_email)), '');
  v_phone text := nullif(btrim(p_phone), '');
  v_normalized_phone text := regexp_replace(coalesce(p_normalized_phone, ''), '[^0-9]', '', 'g');
  v_operation_type text;
  v_acquisition_channel text := coalesce(nullif(btrim(p_acquisition_channel), ''), 'public_landing');
begin
  v_normalized_email := coalesce(v_normalized_email, v_email);
  v_email := coalesce(v_email, v_normalized_email);
  v_operation_type := case
    when p_operation_type in ('independent_professional', 'clinic', 'multidisciplinary_team')
      then p_operation_type
    when nullif(btrim(p_clinic_name), '') is not null then 'clinic'
    else 'independent_professional'
  end;

  if v_name is null or char_length(v_name) not between 2 and 180 then
    raise exception 'SALES_LEAD_NAME_INVALID' using errcode = '22023';
  end if;
  if v_normalized_phone !~ '^55[0-9]{10,11}$' then
    raise exception 'SALES_LEAD_PHONE_INVALID' using errcode = '22023';
  end if;
  if v_email is not null
     and (char_length(v_email) not between 3 and 254 or position('@' in v_email) < 2) then
    raise exception 'SALES_LEAD_EMAIL_INVALID' using errcode = '22023';
  end if;
  if p_estimated_active_patients is not null
     and p_estimated_active_patients not between 0 and 100000 then
    raise exception 'SALES_LEAD_PATIENT_ESTIMATE_INVALID' using errcode = '22023';
  end if;
  if p_estimated_professionals is not null
     and p_estimated_professionals not between 0 and 10000 then
    raise exception 'SALES_LEAD_PROFESSIONAL_ESTIMATE_INVALID' using errcode = '22023';
  end if;
  if nullif(btrim(p_consent_version), '') is null
     or nullif(btrim(p_consent_origin), '') is null
     or p_consent_purpose is distinct from 'sales_contact' then
    raise exception 'SALES_LEAD_CONTACT_REQUEST_INVALID' using errcode = '22023';
  end if;
  if char_length(coalesce(p_idempotency_key, '')) not between 12 and 240 then
    raise exception 'SALES_LEAD_IDEMPOTENCY_KEY_INVALID' using errcode = '22023';
  end if;

  if v_normalized_email is not null then
    select id into v_email_lead_id
    from public.sales_leads
    where deleted_at is null
      and normalized_email = v_normalized_email
    order by updated_at desc
    limit 1
    for update;
  end if;

  select id into v_phone_lead_id
  from public.sales_leads
  where deleted_at is null
    and normalized_phone = v_normalized_phone
  order by updated_at desc
  limit 1
  for update;

  if v_email_lead_id is not null
     and v_phone_lead_id is not null
     and v_email_lead_id <> v_phone_lead_id then
    raise exception 'SALES_LEAD_IDENTITY_CONFLICT';
  end if;

  v_lead_id := coalesce(v_email_lead_id, v_phone_lead_id);

  if v_lead_id is null then
    begin
      insert into public.sales_leads (
        name, email, normalized_email, phone, normalized_phone,
        professional_registry, clinic_name, city, state,
        estimated_active_patients, estimated_professionals, operation_type,
        acquisition_channel, job_title, preferred_contact_period, notes,
        status, contact_consent_at, contact_consent_version,
        contact_consent_origin, contact_consent_purpose, created_at, updated_at
      ) values (
        v_name, v_email, v_normalized_email, coalesce(v_phone, '+' || v_normalized_phone), v_normalized_phone,
        nullif(btrim(p_professional_registry), ''), nullif(btrim(p_clinic_name), ''),
        nullif(btrim(p_city), ''), nullif(btrim(p_state), ''),
        p_estimated_active_patients, p_estimated_professionals, v_operation_type,
        v_acquisition_channel, nullif(btrim(p_job_title), ''),
        nullif(btrim(p_preferred_contact_period), ''), nullif(btrim(p_notes), ''),
        'new', now(), p_consent_version, p_consent_origin, p_consent_purpose,
        now(), now()
      )
      returning id into v_lead_id;
      v_created := true;
    exception when unique_violation then
      if v_normalized_email is not null then
        select id into v_email_lead_id
        from public.sales_leads
        where deleted_at is null
          and normalized_email = v_normalized_email
        order by updated_at desc
        limit 1
        for update;
      end if;

      select id into v_phone_lead_id
      from public.sales_leads
      where deleted_at is null
        and normalized_phone = v_normalized_phone
      order by updated_at desc
      limit 1
      for update;

      if v_email_lead_id is not null
         and v_phone_lead_id is not null
         and v_email_lead_id <> v_phone_lead_id then
        raise exception 'SALES_LEAD_IDENTITY_CONFLICT';
      end if;
      v_lead_id := coalesce(v_email_lead_id, v_phone_lead_id);
    end;
  end if;

  if v_lead_id is null then
    raise exception 'SALES_LEAD_UPSERT_FAILED';
  end if;

  -- The canonical public upsert must never mutate a paid customer if their
  -- WhatsApp or email is reused on the website. Existing identity lookups
  -- hold the lead FOR UPDATE, including the uniqueness-conflict retry.
  if not v_created and exists (
    select 1 from public.sales_leads existing
    where existing.id = v_lead_id
      and (
        existing.status = 'converted'
        or existing.converted_user_id is not null
        or existing.converted_clinic_id is not null
        or exists (
          select 1 from public.sales_offers paid
          where paid.lead_id = existing.id
            and paid.status = 'paid'
            and paid.payment_confirmed_at is not null
        )
      )
  ) then
    raise exception 'SALES_LEAD_ALREADY_CUSTOMER' using errcode = 'P0001';
  end if;

  if not v_created then
    update public.sales_leads
    set name = v_name,
        email = coalesce(v_email, email),
        normalized_email = coalesce(v_normalized_email, normalized_email),
        phone = coalesce(v_phone, phone),
        normalized_phone = v_normalized_phone,
        professional_registry = coalesce(nullif(btrim(p_professional_registry), ''), professional_registry),
        clinic_name = coalesce(nullif(btrim(p_clinic_name), ''), clinic_name),
        city = coalesce(nullif(btrim(p_city), ''), city),
        state = coalesce(nullif(btrim(p_state), ''), state),
        estimated_active_patients = coalesce(p_estimated_active_patients, estimated_active_patients),
        estimated_professionals = coalesce(p_estimated_professionals, estimated_professionals),
        operation_type = case
          when nullif(btrim(p_clinic_name), '') is null
               and nullif(btrim(p_professional_registry), '') is null
            then operation_type
          else v_operation_type
        end,
        acquisition_channel = coalesce(nullif(btrim(p_acquisition_channel), ''), acquisition_channel),
        job_title = coalesce(nullif(btrim(p_job_title), ''), job_title),
        preferred_contact_period = coalesce(nullif(btrim(p_preferred_contact_period), ''), preferred_contact_period),
        notes = coalesce(nullif(btrim(p_notes), ''), notes),
        contact_consent_at = now(),
        contact_consent_version = p_consent_version,
        contact_consent_origin = p_consent_origin,
        contact_consent_purpose = p_consent_purpose,
        updated_at = now()
    where id = v_lead_id;
  end if;

  v_event_type := case
    when p_source = 'google_interest' then 'google_interest_started'::public.sales_lead_event_type
    when v_created then 'lead_created'::public.sales_lead_event_type
    else 'lead_updated'::public.sales_lead_event_type
  end;

  insert into public.sales_lead_events (
    lead_id, event_type, metadata, idempotency_key
  ) values (
    v_lead_id,
    v_event_type,
    jsonb_build_object(
      'source', left(coalesce(p_source, 'public_landing'), 80),
      'capture', 'minimal_interest',
      'consent_version', p_consent_version,
      'consent_purpose', p_consent_purpose
    ),
    p_idempotency_key
  )
  on conflict (idempotency_key) do nothing;
  get diagnostics v_rows = row_count;
  v_event_created := v_rows > 0;

  return query select v_lead_id, v_event_created, v_created;
end
$function$;

revoke all on function public.upsert_public_sales_lead(
  text,text,text,text,text,text,text,text,text,
  integer,integer,text,text,text,text,text,text,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.upsert_public_sales_lead(
  text,text,text,text,text,text,text,text,text,
  integer,integer,text,text,text,text,text,text,text,text,text,text
) to postgres,service_role;

notify pgrst, 'reload schema';

commit;
