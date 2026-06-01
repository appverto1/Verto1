-- Additive index for appointment billing context lookup by patient.
-- Keeps appointment-level billing context idempotent and scoped by organization.

create index if not exists idx_appointment_billing_contexts_patient
  on public.appointment_billing_contexts (organization_id, patient_id);
