-- Persist professional payment specialty for DRE by specialty.

alter table public.professional_payments
  add column if not exists specialty text;

create index if not exists idx_professional_payments_specialty
  on public.professional_payments (clinic_id, specialty);
