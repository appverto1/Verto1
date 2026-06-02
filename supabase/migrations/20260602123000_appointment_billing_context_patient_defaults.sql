-- Add patient default billing metadata to appointment billing contexts.
-- Additive only; appointment context remains independent from patient registration.

alter table public.appointment_billing_contexts
  add column if not exists payer_type text,
  add column if not exists insurance_card_number text,
  add column if not exists insurance_plan_name text,
  add column if not exists source text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid;

create index if not exists idx_appointment_billing_contexts_source
  on public.appointment_billing_contexts (organization_id, source);
