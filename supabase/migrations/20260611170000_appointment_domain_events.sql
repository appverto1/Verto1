create extension if not exists pgcrypto;

create table if not exists public.appointment_domain_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  professional_id uuid references public.users(id) on delete set null,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  event_type text not null,
  idempotency_key text not null,
  created_by uuid references public.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

create unique index if not exists appointment_domain_events_idempotency_key_uidx
  on public.appointment_domain_events (idempotency_key);

create index if not exists appointment_domain_events_clinic_created_idx
  on public.appointment_domain_events (clinic_id, created_at desc);

create index if not exists appointment_domain_events_appointment_created_idx
  on public.appointment_domain_events (appointment_id, created_at desc);

alter table public.appointment_domain_events enable row level security;

drop policy if exists appointment_domain_events_clinic_select on public.appointment_domain_events;
create policy appointment_domain_events_clinic_select
on public.appointment_domain_events
for select
using (
  exists (
    select 1
    from public.clinic_memberships cm
    where cm.clinic_id = appointment_domain_events.clinic_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  )
  or exists (
    select 1
    from public.patients p
    where p.id = appointment_domain_events.patient_id
      and p.user_id = auth.uid()
  )
);
