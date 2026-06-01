alter table public.patients
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid,
  add column if not exists reactivated_at timestamptz,
  add column if not exists reactivated_by uuid;

create index if not exists idx_patients_clinic_active_archive
  on public.patients (clinic_id, is_active, deleted_at, archived_at);

