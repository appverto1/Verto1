-- Soft delete support for ABA behavior events.

alter table public.aba_behavior_events
  add column if not exists is_active boolean not null default true,
  add column if not exists deleted_at timestamptz,
  add column if not exists updated_at timestamptz;

create index if not exists idx_aba_behavior_events_active_patient
  on public.aba_behavior_events (patient_id, occurred_at desc)
  where is_active = true and deleted_at is null;
