-- Extends the TISS-ready layer with payer/operator requirements and patient authorization data.
-- This migration does not generate TISS XML, batches, remittances, returns, denials, or external billing integrations.

alter table public.payer_tiss_profiles
  add column if not exists beneficiary_identification_type text,
  add column if not exists requires_beneficiary_card_validity boolean not null default false,
  add column if not exists requires_authorization_password boolean not null default false,
  add column if not exists requires_guide_number boolean not null default false,
  add column if not exists requires_cid boolean not null default false,
  add column if not exists requires_responsible_signature boolean not null default false,
  add column if not exists contracted_executant text,
  add column if not exists contracted_provider_code text,
  add column if not exists operator_provider_code text,
  add column if not exists default_attendance_type text,
  add column if not exists default_attendance_regime text,
  add column if not exists default_attendance_character text,
  add column if not exists specific_rules text;

create index if not exists idx_payer_tiss_profiles_requirements
  on public.payer_tiss_profiles (organization_id, payer_id, active, requires_authorization, requires_guide_number);

alter table public.patients
  add column if not exists insurance_card_valid_until date,
  add column if not exists insurance_plan_category text,
  add column if not exists insurance_holder_name text,
  add column if not exists insurance_holder_cpf text,
  add column if not exists insurance_holder_relationship text,
  add column if not exists eligibility_notes text;

create table if not exists public.patient_payer_authorizations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  payer_id uuid not null references public.clinic_payers(id) on delete cascade,
  authorization_code text,
  guide_number text,
  issued_at date,
  valid_from date,
  valid_until date,
  authorized_quantity numeric(12, 4),
  authorized_unit text,
  procedure_tuss_code text,
  procedure_code text,
  status text not null default 'active',
  notes text,
  active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_payer_authorizations_tenant_check check (organization_id = clinic_id),
  constraint patient_payer_authorizations_status_check check (status in ('active', 'expired', 'exhausted', 'cancelled'))
);

alter table public.patient_payer_authorizations
  add column if not exists organization_id uuid references public.clinics(id) on delete cascade,
  add column if not exists clinic_id uuid references public.clinics(id) on delete cascade,
  add column if not exists patient_id uuid references public.patients(id) on delete cascade,
  add column if not exists payer_id uuid references public.clinic_payers(id) on delete cascade,
  add column if not exists authorization_code text,
  add column if not exists guide_number text,
  add column if not exists issued_at date,
  add column if not exists valid_from date,
  add column if not exists valid_until date,
  add column if not exists authorized_quantity numeric(12, 4),
  add column if not exists authorized_unit text,
  add column if not exists procedure_tuss_code text,
  add column if not exists procedure_code text,
  add column if not exists status text not null default 'active',
  add column if not exists notes text,
  add column if not exists active boolean not null default true,
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_patient_payer_authorizations_patient_payer
  on public.patient_payer_authorizations (organization_id, patient_id, payer_id, status, active);
create index if not exists idx_patient_payer_authorizations_validity
  on public.patient_payer_authorizations (organization_id, payer_id, valid_from, valid_until);
create index if not exists idx_patient_payer_authorizations_tuss
  on public.patient_payer_authorizations (organization_id, payer_id, procedure_tuss_code);

alter table public.patient_payer_authorizations enable row level security;

drop policy if exists patient_payer_authorizations_admin_rw on public.patient_payer_authorizations;
create policy patient_payer_authorizations_admin_rw on public.patient_payer_authorizations
for all to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      -- Legacy clinics created the clinic row with id = owner user id before clinic_id was consistently populated.
      and (u.clinic_id = patient_payer_authorizations.clinic_id or u.id = patient_payer_authorizations.clinic_id)
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      -- Legacy clinics created the clinic row with id = owner user id before clinic_id was consistently populated.
      and (u.clinic_id = patient_payer_authorizations.clinic_id or u.id = patient_payer_authorizations.clinic_id)
  )
);

drop policy if exists patient_payer_authorizations_professional_read on public.patient_payer_authorizations;
create policy patient_payer_authorizations_professional_read on public.patient_payer_authorizations
for select to authenticated
using (
  exists (
    select 1
    from public.users u
    join public.patients p on p.id = patient_payer_authorizations.patient_id
     and p.clinic_id = patient_payer_authorizations.clinic_id
    where u.id = auth.uid()
      and u.role in ('therapist', 'professional')
      and u.clinic_id = patient_payer_authorizations.clinic_id
      and (
        p.therapist_id = auth.uid()
        or exists (
          select 1 from public.appointments a
          where a.patient_id = p.id
            and a.organization_id = patient_payer_authorizations.organization_id
            and a.organization_id = patient_payer_authorizations.clinic_id
            and a.therapist_id = auth.uid()
        )
        or exists (
          select 1
          from public.appointments a
          join public.appointment_professionals ap
            on ap.appointment_id = a.id
           and ap.organization_id = a.organization_id
          where a.patient_id = p.id
            and a.organization_id = patient_payer_authorizations.organization_id
            and a.organization_id = patient_payer_authorizations.clinic_id
            and ap.organization_id = patient_payer_authorizations.organization_id
            and ap.organization_id = patient_payer_authorizations.clinic_id
            and ap.professional_id = auth.uid()
        )
      )
  )
);

revoke all on table public.patient_payer_authorizations from anon;
grant select, insert, update, delete on table public.patient_payer_authorizations to authenticated;

notify pgrst, 'reload schema';
