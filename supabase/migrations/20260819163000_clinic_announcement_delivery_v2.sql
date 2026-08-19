begin;

create or replace function public.create_clinic_announcement_delivery_v2(
  p_announcement_id uuid,
  p_organization_id uuid,
  p_clinic_id uuid,
  p_category text,
  p_title text,
  p_message text,
  p_event_date date,
  p_audience_mode text,
  p_idempotency_key text,
  p_created_by uuid,
  p_recipients jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_announcement_id uuid;
  v_input_count integer := 0;
  v_valid_count integer := 0;
  v_existing_count integer := 0;
begin
  if p_clinic_id is null then
    raise exception 'INVALID_ANNOUNCEMENT_CLINIC';
  end if;
  if jsonb_typeof(coalesce(p_recipients, '[]'::jsonb)) <> 'array' then
    raise exception 'INVALID_ANNOUNCEMENT_RECIPIENTS';
  end if;

  v_input_count := jsonb_array_length(coalesce(p_recipients, '[]'::jsonb));
  if v_input_count <= 0 or v_input_count > 500 then
    raise exception 'INVALID_ANNOUNCEMENT_RECIPIENT_COUNT';
  end if;

  -- Defense in depth: every recipient must still be an active patient from the
  -- same clinic even though the Node route already scopes the list.
  select count(*)
    into v_valid_count
    from jsonb_to_recordset(p_recipients) as r(
      patient_id uuid,
      recipient_user_id uuid,
      recipient_email text
    )
    join public.patients p on p.id = r.patient_id
   where p.clinic_id = p_clinic_id
     and coalesce(p.is_active, true) = true
     and p.deleted_at is null;

  if v_valid_count <> v_input_count then
    raise exception 'ANNOUNCEMENT_RECIPIENT_SCOPE_MISMATCH';
  end if;

  insert into public.clinic_announcements (
    id, organization_id, clinic_id, category, title, message, event_date,
    audience_mode, recipient_count, push_sent_count, push_failed_count,
    status, idempotency_key, created_by, created_at, updated_at
  ) values (
    p_announcement_id, p_organization_id, p_clinic_id, p_category, p_title, p_message, p_event_date,
    p_audience_mode, v_input_count, 0, 0,
    'SENT', p_idempotency_key, p_created_by, now(), now()
  )
  on conflict (clinic_id, idempotency_key) do nothing
  returning id into v_announcement_id;

  if v_announcement_id is null then
    select ca.id, ca.recipient_count
      into v_announcement_id, v_existing_count
      from public.clinic_announcements ca
     where ca.clinic_id = p_clinic_id
       and ca.idempotency_key = p_idempotency_key
     limit 1;

    return jsonb_build_object(
      'announcement_id', v_announcement_id,
      'recipient_count', v_existing_count,
      'created', false
    );
  end if;

  with recipient_input as (
    select
      r.patient_id,
      r.recipient_user_id,
      nullif(trim(r.recipient_email), '') as recipient_email
    from jsonb_to_recordset(p_recipients) as r(
      patient_id uuid,
      recipient_user_id uuid,
      recipient_email text
    )
    join public.patients p on p.id = r.patient_id
   where p.clinic_id = p_clinic_id
     and coalesce(p.is_active, true) = true
     and p.deleted_at is null
  ), notification_rows as (
    insert into public.portal_notifications (
      id, organization_id, clinic_id, recipient_user_id, recipient_email,
      patient_id, appointment_id, type, title, message, sent_at, scheduled_for,
      idempotency_key, metadata, created_at, updated_at
    )
    select
      gen_random_uuid(), p_organization_id, p_clinic_id, r.recipient_user_id, r.recipient_email,
      r.patient_id, null, 'clinic_announcement', p_title, left(p_title || ': ' || p_message, 1000),
      now(), null, 'clinic-announcement:' || v_announcement_id::text || ':' || r.patient_id::text,
      jsonb_build_object(
        'announcementId', v_announcement_id,
        'category', p_category,
        'eventDate', p_event_date,
        'title', p_title,
        'clinicId', p_clinic_id,
        'patientId', r.patient_id
      ),
      now(), now()
    from recipient_input r
    on conflict (idempotency_key) do update
      set updated_at = excluded.updated_at
    returning id, patient_id
  )
  insert into public.clinic_announcement_recipients (
    announcement_id, organization_id, clinic_id, patient_id, recipient_user_id,
    recipient_email, portal_notification_id, push_status, created_at, updated_at
  )
  select
    v_announcement_id, p_organization_id, p_clinic_id, r.patient_id, r.recipient_user_id,
    r.recipient_email, n.id, 'PENDING', now(), now()
  from recipient_input r
  join notification_rows n on n.patient_id = r.patient_id
  on conflict (announcement_id, patient_id) do update
    set recipient_user_id = excluded.recipient_user_id,
        recipient_email = excluded.recipient_email,
        portal_notification_id = excluded.portal_notification_id,
        updated_at = excluded.updated_at;

  return jsonb_build_object(
    'announcement_id', v_announcement_id,
    'recipient_count', v_input_count,
    'created', true
  );
end;
$$;

revoke all on function public.create_clinic_announcement_delivery_v2(uuid,uuid,uuid,text,text,text,date,text,text,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.create_clinic_announcement_delivery_v2(uuid,uuid,uuid,text,text,text,date,text,text,uuid,jsonb)
  to service_role;

commit;
