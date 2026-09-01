begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Staging/production-safe contract repair for the existing patient-photo feature.
-- Idempotent: it only ensures columns/default/constraint expected by the already
-- deployed code. It does not rewrite photo URLs or infer/backfill identities.
alter table if exists public.clinics
  add column if not exists patient_photo_policy text;

alter table if exists public.clinics
  alter column patient_photo_policy set default 'PORTAL';

update public.clinics
   set patient_photo_policy = 'PORTAL'
 where patient_photo_policy is null;

alter table if exists public.clinics
  alter column patient_photo_policy set not null;

alter table if exists public.patients
  add column if not exists portal_profile_picture text,
  add column if not exists portal_profile_picture_path text;

do $patient_photo_policy_contract$
begin
  if to_regclass('public.clinics') is null then
    return;
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.clinics'::regclass
       and conname = 'clinics_patient_photo_policy_check'
  ) then
    alter table public.clinics
      add constraint clinics_patient_photo_policy_check
      check (patient_photo_policy in ('PORTAL', 'CLINIC')) not valid;
  end if;

  if not exists (
    select 1
      from public.clinics
     where patient_photo_policy not in ('PORTAL', 'CLINIC')
  ) then
    alter table public.clinics
      validate constraint clinics_patient_photo_policy_check;
  end if;
end;
$patient_photo_policy_contract$;

comment on column public.clinics.patient_photo_policy is
  'PORTAL uses the patient/responsible portal avatar in clinical views; CLINIC keeps the clinical avatar managed by authorized clinic staff.';

comment on column public.patients.portal_profile_picture is
  'Patient portal avatar kept separate from the clinic-managed clinical avatar.';

comment on column public.patients.portal_profile_picture_path is
  'Private storage path for the patient portal avatar in patient-photos.';

notify pgrst, 'reload schema';

commit;

-- Read-only verification after apply:
-- select column_name, is_nullable, column_default
--   from information_schema.columns
--  where table_schema = 'public'
--    and ((table_name = 'clinics' and column_name = 'patient_photo_policy')
--      or (table_name = 'patients' and column_name in ('portal_profile_picture','portal_profile_picture_path')))
--  order by table_name, column_name;
