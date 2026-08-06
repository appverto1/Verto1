-- Canonical patient-to-clinic-payer link for insurance/TISS flows.
-- Additive only: existing name-based records remain untouched and are resolved
-- explicitly by the application when a unique active payer exists.

begin;

alter table public.patients
  add column if not exists insurance_payer_id uuid
    references public.clinic_payers(id) on delete set null;

create index if not exists idx_patients_clinic_insurance_payer
  on public.patients (clinic_id, insurance_payer_id)
  where insurance_payer_id is not null;

create or replace function public.assert_patient_insurance_payer_scope_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.insurance_payer_id is null then
    return new;
  end if;

  if new.clinic_id is null or not exists (
    select 1
    from public.clinic_payers payer
    where payer.id = new.insurance_payer_id
      and payer.organization_id = new.clinic_id
      and upper(coalesce(payer.payer_type, '')) = 'INSURANCE'
  ) then
    raise exception using
      errcode = '23514',
      message = 'PATIENT_INSURANCE_PAYER_SCOPE_MISMATCH';
  end if;

  return new;
end;
$$;

drop trigger if exists assert_patient_insurance_payer_scope
  on public.patients;

create trigger assert_patient_insurance_payer_scope
before insert or update of insurance_payer_id, clinic_id
on public.patients
for each row
execute function public.assert_patient_insurance_payer_scope_v1();

revoke all on function public.assert_patient_insurance_payer_scope_v1()
  from public, anon, authenticated;
grant execute on function public.assert_patient_insurance_payer_scope_v1()
  to service_role;

comment on column public.patients.insurance_payer_id is
  'Canonical clinic-scoped payer selected for the patient insurance/TISS identity. Names remain snapshots only.';

commit;
