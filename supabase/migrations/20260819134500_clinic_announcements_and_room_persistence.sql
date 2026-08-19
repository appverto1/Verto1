begin;
create table if not exists public.clinic_announcements (
  id uuid primary key default gen_random_uuid(), organization_id uuid,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  category text not null default 'NOTICE' check (category in ('NOTICE','HOLIDAY','EVENT')),
  title text not null, message text not null, event_date date,
  audience_mode text not null default 'ALL' check (audience_mode in ('ALL','SELECTED')),
  recipient_count integer not null default 0 check (recipient_count >= 0),
  push_sent_count integer not null default 0 check (push_sent_count >= 0),
  push_failed_count integer not null default 0 check (push_failed_count >= 0),
  status text not null default 'SENT' check (status in ('SENT','PARTIAL','FAILED')),
  idempotency_key text not null, created_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (clinic_id, idempotency_key)
);
create index if not exists idx_clinic_announcements_scope_created on public.clinic_announcements (clinic_id, created_at desc);
create table if not exists public.clinic_announcement_recipients (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.clinic_announcements(id) on delete cascade,
  organization_id uuid, clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  recipient_user_id uuid, recipient_email text,
  portal_notification_id uuid references public.portal_notifications(id) on delete set null,
  push_status text not null default 'PENDING' check (push_status in ('PENDING','SENT','NO_SUBSCRIPTION','FAILED')),
  push_sent_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (announcement_id, patient_id)
);
create index if not exists idx_clinic_announcement_recipients_announcement on public.clinic_announcement_recipients (announcement_id, patient_id);
create index if not exists idx_clinic_announcement_recipients_patient on public.clinic_announcement_recipients (clinic_id, patient_id, created_at desc);
alter table public.clinic_announcements enable row level security;
alter table public.clinic_announcement_recipients enable row level security;
revoke all on table public.clinic_announcements from anon, authenticated;
revoke all on table public.clinic_announcement_recipients from anon, authenticated;
grant all on table public.clinic_announcements to service_role;
grant all on table public.clinic_announcement_recipients to service_role;
create index if not exists idx_portal_notifications_clinic_type_created on public.portal_notifications (clinic_id, type, created_at desc);

create or replace function public.create_clinic_announcement_delivery_v1(
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
returns table(announcement_id uuid, recipient_count integer, created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_announcement_id uuid;
  v_recipient_count integer := coalesce(jsonb_array_length(coalesce(p_recipients, '[]'::jsonb)), 0);
begin
  if p_clinic_id is null or v_recipient_count <= 0 then
    raise exception 'INVALID_ANNOUNCEMENT_DELIVERY';
  end if;

  insert into public.clinic_announcements (
    id, organization_id, clinic_id, category, title, message, event_date,
    audience_mode, recipient_count, push_sent_count, push_failed_count,
    status, idempotency_key, created_by, created_at, updated_at
  ) values (
    p_announcement_id, p_organization_id, p_clinic_id, p_category, p_title, p_message, p_event_date,
    p_audience_mode, v_recipient_count, 0, 0, 'SENT', p_idempotency_key, p_created_by, now(), now()
  )
  on conflict (clinic_id, idempotency_key) do nothing
  returning id into v_announcement_id;

  if v_announcement_id is null then
    select ca.id, ca.recipient_count into v_announcement_id, v_recipient_count
      from public.clinic_announcements ca
     where ca.clinic_id = p_clinic_id and ca.idempotency_key = p_idempotency_key
     limit 1;
    return query select v_announcement_id, v_recipient_count, false;
    return;
  end if;

  with recipient_input as (
    select
      (item->>'patient_id')::uuid as patient_id,
      nullif(item->>'recipient_user_id','')::uuid as recipient_user_id,
      nullif(item->>'recipient_email','') as recipient_email
    from jsonb_array_elements(p_recipients) item
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
      jsonb_build_object('announcementId', v_announcement_id, 'category', p_category, 'eventDate', p_event_date, 'title', p_title, 'clinicId', p_clinic_id, 'patientId', r.patient_id),
      now(), now()
    from recipient_input r
    on conflict (idempotency_key) do update set updated_at = excluded.updated_at
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
  on conflict (announcement_id, patient_id) do nothing;

  return query select v_announcement_id, v_recipient_count, true;
end;
$$;

revoke all on function public.create_clinic_announcement_delivery_v1(uuid,uuid,uuid,text,text,text,date,text,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.create_clinic_announcement_delivery_v1(uuid,uuid,uuid,text,text,text,date,text,text,uuid,jsonb) to service_role;

commit;
