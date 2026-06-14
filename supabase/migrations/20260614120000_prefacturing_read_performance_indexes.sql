-- Read performance for pre-billing closure and monthly conference.
-- Additive only: no TISS/XML/remittance implementation and no destructive data changes.

create index if not exists idx_appointment_closure_checks_org_scheduled_read
  on public.appointment_closure_checks (organization_id, scheduled_start desc, appointment_id);

create index if not exists idx_appointment_closure_checks_org_status_scheduled
  on public.appointment_closure_checks (organization_id, readiness_status, scheduled_start desc);

create index if not exists idx_appointment_closure_checks_org_patient_scheduled
  on public.appointment_closure_checks (organization_id, patient_id, scheduled_start desc);

create index if not exists idx_appointment_closure_checks_org_professional_scheduled
  on public.appointment_closure_checks (organization_id, professional_id, scheduled_start desc);

create index if not exists idx_appointment_closure_checks_org_payer_scheduled
  on public.appointment_closure_checks (organization_id, payer_id, scheduled_start desc);

create index if not exists idx_appointment_closure_checks_org_service_scheduled
  on public.appointment_closure_checks (organization_id, service_type, scheduled_start desc);

create index if not exists idx_appointment_billing_contexts_appointment_read
  on public.appointment_billing_contexts (organization_id, appointment_id, payer_id);

create index if not exists idx_appointment_billing_items_appointment_read
  on public.appointment_billing_items (organization_id, appointment_id, payer_id, status);

create index if not exists idx_appointment_conference_statuses_appointment_read
  on public.appointment_conference_statuses (organization_id, appointment_id, competence_month, status);

create index if not exists idx_payer_tuss_mappings_payer_active_validity
  on public.payer_tuss_mappings (organization_id, payer_id, active, valid_from, valid_to);

create index if not exists idx_appointments_prefacturing_slot_read
  on public.appointments (organization_id, patient_id, therapist_id, scheduled_at, scheduled_end_at, status);
