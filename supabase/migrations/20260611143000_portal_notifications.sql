create extension if not exists pgcrypto;

create table if not exists public.portal_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  clinic_id uuid,
  recipient_user_id uuid,
  recipient_email text,
  patient_id uuid not null references public.patients(id) on delete cascade,
  appointment_id uuid,
  type text not null,
  title text not null,
  message text not null,
  read_at timestamptz,
  acknowledged_at timestamptz,
  sent_at timestamptz not null default now(),
  scheduled_for timestamptz,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists portal_notifications_idempotency_key_uidx
  on public.portal_notifications (idempotency_key);

create index if not exists portal_notifications_recipient_read_created_idx
  on public.portal_notifications (recipient_user_id, read_at, created_at desc);

create index if not exists portal_notifications_recipient_email_read_created_idx
  on public.portal_notifications (recipient_email, read_at, created_at desc);

create index if not exists portal_notifications_patient_created_idx
  on public.portal_notifications (patient_id, created_at desc);

create index if not exists portal_notifications_appointment_type_recipient_idx
  on public.portal_notifications (appointment_id, type, recipient_user_id);

do $$
begin
  if to_regclass('public.appointments') is not null then
    execute 'create index if not exists appointments_patient_scheduled_status_idx on public.appointments (patient_id, scheduled_at, status)';
    execute 'create index if not exists appointments_clinic_scheduled_status_idx on public.appointments (clinic_id, scheduled_at, status)';
  end if;
  if to_regclass('public.history') is not null then
    execute 'create index if not exists history_patient_created_idx on public.history (patient_id, created_at desc)';
  end if;
  if to_regclass('public.patient_files') is not null then
    execute 'create index if not exists patient_files_patient_created_idx on public.patient_files (patient_id, created_at desc)';
  end if;
end $$;

alter table public.portal_notifications enable row level security;

drop policy if exists portal_notifications_recipient_select on public.portal_notifications;
create policy portal_notifications_recipient_select
on public.portal_notifications
for select
using (recipient_user_id = auth.uid());

drop policy if exists portal_notifications_recipient_update on public.portal_notifications;
create policy portal_notifications_recipient_update
on public.portal_notifications
for update
using (recipient_user_id = auth.uid())
with check (recipient_user_id = auth.uid());

revoke insert, delete, update on table public.portal_notifications from anon, authenticated;
grant select on table public.portal_notifications to authenticated;
grant update (read_at, acknowledged_at, updated_at) on table public.portal_notifications to authenticated;
