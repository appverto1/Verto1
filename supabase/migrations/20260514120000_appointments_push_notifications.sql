-- Agenda + push notifications for patient appointment confirmations.
-- Run this in Supabase SQL Editor or via Supabase migrations.

create extension if not exists pgcrypto;

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  therapist_id uuid not null references public.users(id) on delete cascade,
  scheduled_at timestamp with time zone not null,
  duration_minutes integer default 50,
  status text not null default 'scheduled',
  notes text,
  notification_24h_sent_at timestamp with time zone,
  notification_12h_sent_at timestamp with time zone,
  patient_response text,
  patient_responded_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table public.appointments
  add column if not exists clinic_id uuid references public.clinics(id) on delete cascade,
  add column if not exists patient_id uuid references public.patients(id) on delete cascade,
  add column if not exists therapist_id uuid references public.users(id) on delete cascade,
  add column if not exists scheduled_at timestamp with time zone,
  add column if not exists duration_minutes integer default 50,
  add column if not exists status text not null default 'scheduled',
  add column if not exists notes text,
  add column if not exists notification_24h_sent_at timestamp with time zone,
  add column if not exists notification_12h_sent_at timestamp with time zone,
  add column if not exists patient_response text,
  add column if not exists patient_responded_at timestamp with time zone,
  add column if not exists created_at timestamp with time zone default now(),
  add column if not exists updated_at timestamp with time zone default now(),
  -- Compatibility with the previous Verto implementation.
  add column if not exists notification_sent boolean not null default false,
  add column if not exists notification_sent_at timestamp with time zone,
  add column if not exists notification_12h_sent boolean not null default false,
  add column if not exists notification_12h_sent_at timestamp with time zone,
  add column if not exists patient_confirmation_status text,
  add column if not exists patient_confirmation_at timestamp with time zone,
  add column if not exists patient_confirmation_by text,
  add column if not exists patient_confirmation_source text,
  add column if not exists patient_email text,
  add column if not exists patient_name text,
  add column if not exists therapist_name text,
  add column if not exists source_payload jsonb,
  add column if not exists deleted_at timestamp with time zone,
  add column if not exists is_active boolean default true;

alter table public.appointments
  drop constraint if exists appointments_status_check;

alter table public.appointments
  drop constraint if exists appointments_patient_response_check;

update public.appointments
set status = 'scheduled'
where status is null or status = 'pending';

update public.appointments
set notification_24h_sent_at = coalesce(notification_24h_sent_at, notification_sent_at)
where notification_sent = true and notification_24h_sent_at is null;

do $$
begin
  alter table public.appointments
    add constraint appointments_status_check
    check (status in ('scheduled','pending','confirmed','cancelled','canceled','completed','rescheduled','reschedule'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.appointments
    add constraint appointments_patient_response_check
    check (patient_response is null or patient_response in ('confirmed','reschedule','cancelled','canceled'));
exception
  when duplicate_object then null;
end $$;

create table if not exists public.push_subscriptions (
  id uuid default gen_random_uuid(),
  patient_id uuid references public.patients(id) on delete cascade,
  endpoint text not null,
  p256dh text,
  auth text,
  subscription jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  user_id uuid,
  user_email text,
  clinic_id text,
  role text
);

alter table public.push_subscriptions
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists patient_id uuid references public.patients(id) on delete cascade,
  add column if not exists endpoint text,
  add column if not exists p256dh text,
  add column if not exists auth text,
  add column if not exists subscription jsonb,
  add column if not exists created_at timestamp with time zone default now(),
  add column if not exists updated_at timestamp with time zone default now(),
  add column if not exists user_id uuid,
  add column if not exists user_email text,
  add column if not exists clinic_id text,
  add column if not exists role text;

update public.push_subscriptions
set
  p256dh = coalesce(p256dh, subscription #>> '{keys,p256dh}'),
  auth = coalesce(auth, subscription #>> '{keys,auth}'),
  updated_at = now()
where subscription is not null
  and (p256dh is null or auth is null);

update public.push_subscriptions ps
set patient_id = p.id
from public.patients p
where ps.patient_id is null
  and ps.user_email is not null
  and lower(p.email) = lower(ps.user_email)
  and (ps.clinic_id is null or ps.clinic_id = '' or p.clinic_id::text = ps.clinic_id)
  and coalesce(p.is_active, true) = true
  and p.deleted_at is null;

update public.push_subscriptions
set subscription = jsonb_build_object(
    'endpoint', endpoint,
    'keys', jsonb_build_object('p256dh', p256dh, 'auth', auth)
  )
where subscription is null
  and endpoint is not null
  and p256dh is not null
  and auth is not null;

create unique index if not exists idx_push_subscriptions_patient_endpoint
  on public.push_subscriptions(patient_id, endpoint)
  where patient_id is not null and endpoint is not null;

create unique index if not exists idx_push_subscriptions_endpoint
  on public.push_subscriptions(endpoint)
  where endpoint is not null;

create index if not exists idx_appointments_scheduled_at
  on public.appointments(scheduled_at);

create index if not exists idx_appointments_patient_id
  on public.appointments(patient_id);

create index if not exists idx_appointments_notification_24h
  on public.appointments(status, notification_24h_sent_at, scheduled_at)
  where scheduled_at is not null and notification_24h_sent_at is null;

create index if not exists idx_appointments_notification_12h
  on public.appointments(status, notification_12h_sent_at, scheduled_at)
  where scheduled_at is not null and notification_12h_sent_at is null;

create index if not exists idx_push_subscriptions_patient_id
  on public.push_subscriptions(patient_id);

create index if not exists idx_push_subscriptions_user_email
  on public.push_subscriptions(lower(user_email));
