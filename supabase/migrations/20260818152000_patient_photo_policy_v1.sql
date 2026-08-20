begin;

alter table if exists public.clinics
  add column if not exists patient_photo_policy text not null default 'PORTAL';

alter table if exists public.clinics
  drop constraint if exists clinics_patient_photo_policy_check;

alter table if exists public.clinics
  add constraint clinics_patient_photo_policy_check
  check (patient_photo_policy in ('PORTAL', 'CLINIC'));

alter table if exists public.patients
  add column if not exists portal_profile_picture text,
  add column if not exists portal_profile_picture_path text;

comment on column public.clinics.patient_photo_policy is
  'PORTAL uses the patient/responsible portal avatar in clinical views; CLINIC keeps the clinical avatar managed by authorized clinic staff.';

comment on column public.patients.portal_profile_picture is
  'Patient/responsible portal avatar, kept separate from the clinic-managed clinical avatar.';

comment on column public.patients.portal_profile_picture_path is
  'Private storage path for the portal avatar in patient-photos.';

commit;
