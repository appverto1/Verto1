-- Clinic rooms, scheduling conflict fields and time-report summaries.

create extension if not exists pgcrypto;

create table if not exists public.clinic_rooms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  clinic_id uuid references public.clinics(id) on delete cascade,
  name text not null,
  specialties text,
  description text,
  capacity integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clinic_rooms
  add column if not exists specialties text;

create unique index if not exists idx_clinic_rooms_unique_active_name
  on public.clinic_rooms (coalesce(organization_id, clinic_id), lower(name))
  where is_active = true;

create index if not exists idx_clinic_rooms_scope_active
  on public.clinic_rooms (organization_id, clinic_id, is_active, name);

alter table public.appointments
  add column if not exists organization_id uuid,
  add column if not exists approach text,
  add column if not exists room_id text,
  add column if not exists room_name text,
  add column if not exists location_type text not null default 'clinica',
  add column if not exists location_notes text,
  add column if not exists call_link text,
  add column if not exists service_type text,
  add column if not exists scheduled_start_at timestamptz,
  add column if not exists scheduled_end_at timestamptz,
  add column if not exists scheduled_duration_minutes integer,
  add column if not exists actual_start_at timestamptz,
  add column if not exists actual_end_at timestamptz,
  add column if not exists actual_duration_minutes integer,
  add column if not exists recurrence_total integer,
  add column if not exists recurrence_frequency text,
  add column if not exists deleted_at timestamptz,
  add column if not exists is_active boolean default true;

update public.appointments
set
  scheduled_start_at = coalesce(scheduled_start_at, scheduled_at),
  scheduled_duration_minutes = coalesce(scheduled_duration_minutes, duration_minutes),
  scheduled_end_at = coalesce(
    scheduled_end_at,
    scheduled_at + make_interval(mins => greatest(coalesce(duration_minutes, 50), 1))
  ),
  service_type = coalesce(service_type, approach),
  organization_id = coalesce(organization_id, clinic_id)
where scheduled_at is not null;

alter table public.appointments
  drop constraint if exists appointments_status_check;

alter table public.appointments
  add constraint appointments_status_check
  check (status in (
    'scheduled',
    'pending',
    'confirmed',
    'in_progress',
    'cancelled',
    'canceled',
    'completed',
    'no_show',
    'missed',
    'deleted',
    'rescheduled',
    'reschedule'
  ));

create table if not exists public.appointment_professionals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  clinic_id uuid references public.clinics(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete cascade,
  professional_id uuid,
  professional_name text,
  role text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_appointment_professionals_unique
  on public.appointment_professionals (appointment_id, professional_id)
  where professional_id is not null;

create index if not exists idx_appointments_schedule_window
  on public.appointments (organization_id, scheduled_at, scheduled_end_at);

create index if not exists idx_appointments_patient_schedule_window
  on public.appointments (organization_id, patient_id, scheduled_at, scheduled_end_at);

create index if not exists idx_appointments_room_schedule_window
  on public.appointments (organization_id, room_id, scheduled_at, scheduled_end_at);

create index if not exists idx_appointment_professionals_lookup
  on public.appointment_professionals (organization_id, professional_id, appointment_id);

create index if not exists idx_appointments_status_schedule
  on public.appointments (organization_id, status, scheduled_at);

alter table public.aba_sessions
  add column if not exists appointment_id uuid references public.appointments(id) on delete set null,
  add column if not exists scheduled_start_at timestamptz,
  add column if not exists scheduled_end_at timestamptz,
  add column if not exists scheduled_duration_minutes integer,
  add column if not exists actual_start_at timestamptz,
  add column if not exists actual_end_at timestamptz,
  add column if not exists actual_duration_minutes integer,
  add column if not exists room_id text,
  add column if not exists room_name text,
  add column if not exists location_type text;

create index if not exists idx_aba_sessions_appointment
  on public.aba_sessions (appointment_id);

create table if not exists public.patient_monthly_service_summaries (
  organization_id uuid not null,
  patient_id uuid not null,
  year_month text not null,
  service_type text not null,
  completed_sessions_count integer not null default 0,
  scheduled_sessions_count integer not null default 0,
  no_show_count integer not null default 0,
  cancelled_count integer not null default 0,
  scheduled_minutes integer not null default 0,
  actual_minutes integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, patient_id, year_month, service_type)
);

create table if not exists public.professional_daily_work_summaries (
  organization_id uuid not null,
  professional_id uuid not null,
  work_date date not null,
  completed_sessions_count integer not null default 0,
  scheduled_sessions_count integer not null default 0,
  no_show_count integer not null default 0,
  cancelled_count integer not null default 0,
  scheduled_minutes integer not null default 0,
  actual_minutes integer not null default 0,
  service_type_breakdown jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (organization_id, professional_id, work_date)
);

create table if not exists public.professional_monthly_work_summaries (
  organization_id uuid not null,
  professional_id uuid not null,
  year_month text not null,
  completed_sessions_count integer not null default 0,
  scheduled_sessions_count integer not null default 0,
  no_show_count integer not null default 0,
  cancelled_count integer not null default 0,
  scheduled_minutes integer not null default 0,
  actual_minutes integer not null default 0,
  service_type_breakdown jsonb not null default '{}'::jsonb,
  worked_days_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, professional_id, year_month)
);
