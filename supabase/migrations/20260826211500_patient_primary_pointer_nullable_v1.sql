begin;

do $migration_guard$
begin
  if to_regclass('public.patients') is null then
    raise exception 'PATIENTS_SCHEMA_PENDING'
      using detail = 'public.patients is required before relaxing the legacy therapist pointer';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'patients'
      and column_name = 'therapist_id'
  ) then
    raise exception 'PATIENT_THERAPIST_POINTER_SCHEMA_PENDING'
      using detail = 'public.patients.therapist_id is required before applying this compatibility migration';
  end if;
end;
$migration_guard$;

-- patient_professional_links is the canonical case-team relation. The legacy
-- patients.therapist_id pointer must be nullable so a coordinator/director can
-- end the current primary relationship without preserving a stale authorization
-- pointer or inventing a replacement professional.
alter table public.patients
  alter column therapist_id drop not null;

comment on column public.patients.therapist_id is
  'Legacy denormalized primary-professional pointer. Nullable by design; canonical case-team authority lives in patient_professional_links.';

notify pgrst, 'reload schema';

commit;
