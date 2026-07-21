-- Completes additive appointment columns already consumed by reminders and
-- atomic reschedule/cancellation functions. Existing rows are not rewritten.

alter table if exists public.appointments
  add column if not exists therapist_name text,
  add column if not exists patient_confirmation_status text,
  add column if not exists patient_confirmation_at timestamptz,
  add column if not exists patient_confirmation_by text,
  add column if not exists patient_confirmation_source text,
  add column if not exists patient_email text,
  add column if not exists source_payload jsonb,
  add column if not exists notification_sent boolean not null default false,
  add column if not exists notification_sent_at timestamptz,
  add column if not exists notification_12h_sent boolean not null default false,
  add column if not exists notification_12h_sent_at timestamptz;

comment on column public.appointments.patient_confirmation_status is
  'Canonical patient/responsible response state used by portal actions and appointment reminders.';
comment on column public.appointments.patient_confirmation_source is
  'Origin of the canonical confirmation or action-request state.';

create index if not exists appointments_confirmation_status_scheduled_idx
  on public.appointments (clinic_id, patient_confirmation_status, scheduled_at)
  where deleted_at is null and coalesce(is_active, true);
