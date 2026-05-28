-- Human room specialties used as secondary agenda metadata.

create extension if not exists pgcrypto;

create table if not exists public.clinic_rooms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  clinic_id uuid references public.clinics(id) on delete cascade,
  name text not null,
  description text,
  capacity integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clinic_rooms
  add column if not exists specialties text;
