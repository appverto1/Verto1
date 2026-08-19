begin;

alter table public.clinic_announcements
  add column if not exists scheduled_for timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists delivery_started_at timestamptz,
  add column if not exists delivery_worker_id text,
  add column if not exists delivery_attempt_count integer not null default 0;

alter table public.clinic_announcements
  drop constraint if exists clinic_announcements_status_check;

alter table public.clinic_announcements
  add constraint clinic_announcements_status_check
  check (status in ('SCHEDULED','SENDING','SENT','PARTIAL','FAILED','CANCELED'));

create index if not exists idx_clinic_announcements_due
  on public.clinic_announcements (scheduled_for, id)
  where status = 'SCHEDULED';

create or replace function public.create_clinic_announcement_delivery_v3(
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
  p_recipients jsonb,
  p_scheduled_for timestamptz default null
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
  v_status text;
  v_scheduled_for timestamptz;
  v_local_hour integer;
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

  v_scheduled_for := case
    when p_scheduled_for is not null and p_scheduled_for > now() + interval '15 seconds'
      then date_trunc('minute', p_scheduled_for)
    else null
  end;

  if v_scheduled_for is not null then
    v_local_hour := extract(hour from (v_scheduled_for at time zone 'America/Sao_Paulo'))::integer;
    if v_local_hour >= 22 or v_local_hour < 6 then
      raise exception 'ANNOUNCEMENT_QUIET_HOURS';
    end if;
  end if;

  v_status := case when v_scheduled_for is null then 'SENDING' else 'SCHEDULED' end;

  insert into public.clinic_announcements (
    id, organization_id, clinic_id, category, title, message, event_date,
    audience_mode, recipient_count, push_sent_count, push_failed_count,
    status, idempotency_key, created_by, scheduled_for, delivery_started_at,
    delivery_attempt_count, created_at, updated_at
  ) values (
    p_announcement_id, p_organization_id, p_clinic_id, p_category, p_title, p_message, p_event_date,
    p_audience_mode, v_input_count, 0, 0,
    v_status, p_idempotency_key, p_created_by, v_scheduled_for,
    case when v_status = 'SENDING' then now() else null end,
    case when v_status = 'SENDING' then 1 else 0 end,
    now(), now()
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

  insert into public.clinic_announcement_recipients (
    announcement_id, organization_id, clinic_id, patient_id, recipient_user_id,
    recipient_email, portal_notification_id, push_status, created_at, updated_at
  )
  select
    v_announcement_id,
    p_organization_id,
    p_clinic_id,
    r.patient_id,
    r.recipient_user_id,
    nullif(trim(r.recipient_email), ''),
    null,
    'PENDING',
    now(),
    now()
  from jsonb_to_recordset(p_recipients) as r(
    patient_id uuid,
    recipient_user_id uuid,
    recipient_email text
  )
  join public.patients p on p.id = r.patient_id
 where p.clinic_id = p_clinic_id
   and coalesce(p.is_active, true) = true
   and p.deleted_at is null
  on conflict (announcement_id, patient_id) do update
    set recipient_user_id = excluded.recipient_user_id,
        recipient_email = excluded.recipient_email,
        updated_at = excluded.updated_at;

  return jsonb_build_object(
    'announcement_id', v_announcement_id,
    'recipient_count', v_input_count,
    'created', true,
    'status', v_status,
    'scheduled_for', v_scheduled_for
  );
end;
$$;

create or replace function public.claim_due_clinic_announcements_v1(
  p_worker_id text,
  p_limit integer default 20
)
returns table(announcement_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Reabre somente envios que ficaram presos por queda de processo/deploy.
  update public.clinic_announcements
     set status = 'SCHEDULED',
         scheduled_for = coalesce(scheduled_for, date_trunc('minute', now())),
         delivery_started_at = null,
         delivery_worker_id = null,
         updated_at = now()
   where status = 'SENDING'
     and sent_at is null
     and delivery_started_at is not null
     and delivery_started_at < now() - interval '5 minutes'
     and coalesce(scheduled_for, created_at) <= now();

  return query
  with candidates as (
    select ca.id
      from public.clinic_announcements ca
     where ca.status = 'SCHEDULED'
       and ca.scheduled_for is not null
       and ca.scheduled_for <= now()
     order by ca.scheduled_for asc, ca.id asc
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 20), 100))
  )
  update public.clinic_announcements ca
     set status = 'SENDING',
         delivery_started_at = now(),
         delivery_worker_id = left(coalesce(p_worker_id, 'worker'), 200),
         delivery_attempt_count = coalesce(ca.delivery_attempt_count, 0) + 1,
         updated_at = now()
    from candidates c
   where ca.id = c.id
  returning ca.id;
end;
$$;

create or replace function public.materialize_clinic_announcement_portal_notifications_v1(
  p_announcement_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  with announcement as (
    select ca.*
      from public.clinic_announcements ca
     where ca.id = p_announcement_id
       and ca.status in ('SENDING','SENT','PARTIAL')
     limit 1
  ), notification_rows as (
    insert into public.portal_notifications (
      id, organization_id, clinic_id, recipient_user_id, recipient_email,
      patient_id, appointment_id, type, title, message, sent_at, scheduled_for,
      idempotency_key, metadata, created_at, updated_at
    )
    select
      gen_random_uuid(),
      a.organization_id,
      a.clinic_id,
      r.recipient_user_id,
      r.recipient_email,
      r.patient_id,
      null,
      'clinic_announcement',
      a.title,
      left(a.title || ': ' || a.message, 1000),
      now(),
      a.scheduled_for,
      'clinic-announcement:' || a.id::text || ':' || r.patient_id::text,
      jsonb_build_object(
        'announcementId', a.id,
        'category', a.category,
        'eventDate', a.event_date,
        'title', a.title,
        'clinicId', a.clinic_id,
        'patientId', r.patient_id,
        'scheduledFor', a.scheduled_for
      ),
      now(),
      now()
    from announcement a
    join public.clinic_announcement_recipients r on r.announcement_id = a.id
    on conflict (idempotency_key) do update
      set updated_at = excluded.updated_at
    returning id, patient_id
  )
  update public.clinic_announcement_recipients r
     set portal_notification_id = n.id,
         updated_at = now()
    from notification_rows n
   where r.announcement_id = p_announcement_id
     and r.patient_id = n.patient_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.create_clinic_announcement_delivery_v3(uuid,uuid,uuid,text,text,text,date,text,text,uuid,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.create_clinic_announcement_delivery_v3(uuid,uuid,uuid,text,text,text,date,text,text,uuid,jsonb,timestamptz) to service_role;

revoke all on function public.claim_due_clinic_announcements_v1(text,integer) from public, anon, authenticated;
grant execute on function public.claim_due_clinic_announcements_v1(text,integer) to service_role;

revoke all on function public.materialize_clinic_announcement_portal_notifications_v1(uuid) from public, anon, authenticated;
grant execute on function public.materialize_clinic_announcement_portal_notifications_v1(uuid) to service_role;

commit;
