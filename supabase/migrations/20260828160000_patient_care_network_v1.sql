-- Patient care network v1.
-- Informational directory only. This table does not grant clinical-data access.
-- Patient/responsible authorization and external sharing are separate future flows.

begin;

create table if not exists public.patient_care_network_contacts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  clinic_name text null,
  professional_name text not null,
  specialty text null,
  phone text not null,
  email text null,
  source text not null default 'PATIENT_PORTAL',
  created_by_user_id uuid null,
  updated_by_user_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  constraint patient_care_network_professional_name_length_chk
    check (char_length(btrim(professional_name)) between 1 and 180),
  constraint patient_care_network_phone_length_chk
    check (char_length(btrim(phone)) between 1 and 60),
  constraint patient_care_network_clinic_name_length_chk
    check (clinic_name is null or char_length(btrim(clinic_name)) <= 180),
  constraint patient_care_network_specialty_length_chk
    check (specialty is null or char_length(btrim(specialty)) <= 120),
  constraint patient_care_network_email_length_chk
    check (email is null or char_length(btrim(email)) <= 254),
  constraint patient_care_network_source_chk
    check (source in ('PATIENT_PORTAL', 'CLINIC'))
);

create index if not exists idx_patient_care_network_active_patient
  on public.patient_care_network_contacts (clinic_id, patient_id, created_at)
  where archived_at is null;

create index if not exists idx_patient_care_network_active_email
  on public.patient_care_network_contacts (clinic_id, patient_id, lower(email))
  where archived_at is null and email is not null;

alter table public.patient_care_network_contacts enable row level security;

revoke all on table public.patient_care_network_contacts from public, anon, authenticated;
grant select, insert, update, delete on table public.patient_care_network_contacts to service_role;

comment on table public.patient_care_network_contacts is
  'Informational patient-reported care network. Presence in this table never implies consent or permission to access clinical data.';
comment on column public.patient_care_network_contacts.email is
  'Optional contact e-mail. Future external sharing must create an explicit, separately audited grant; this column is not an authorization source.';

notify pgrst, 'reload schema';

commit;
