-- Completes the operational authorization/guide cycle used by TISS pre-guides.
-- This migration does not generate TISS XML, batches, remittances, returns, denials, or external billing integrations.

alter table public.payer_tiss_profiles
  add column if not exists requires_authorized_procedure boolean not null default false;

alter table public.patient_payer_authorizations
  add column if not exists authorization_number text,
  add column if not exists issue_date date,
  add column if not exists used_quantity numeric(12, 4),
  add column if not exists service_catalog_id uuid references public.tuss_service_catalog(id) on delete set null,
  add column if not exists tuss_code_id uuid references public.tuss_codes(id) on delete set null,
  add column if not exists procedure_code_snapshot text,
  add column if not exists procedure_name_snapshot text,
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid;

create index if not exists idx_patient_payer_authorizations_catalog
  on public.patient_payer_authorizations (organization_id, service_catalog_id)
  where service_catalog_id is not null;

create index if not exists idx_patient_payer_authorizations_tuss_code_id
  on public.patient_payer_authorizations (organization_id, tuss_code_id)
  where tuss_code_id is not null;

create index if not exists idx_patient_payer_authorizations_active_period
  on public.patient_payer_authorizations (organization_id, patient_id, payer_id, active, status, valid_from, valid_until);

notify pgrst, 'reload schema';
