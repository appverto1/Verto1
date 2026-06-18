-- Adds audit-safe TUSS origin metadata for patient payer authorizations.
-- This migration does not backfill, transmit, alter XML documents, or recalculate pre-guides.

alter table public.patient_payer_authorizations
  add column if not exists payer_tuss_mapping_id uuid references public.payer_tuss_mappings(id) on delete set null,
  add column if not exists tuss_source text,
  add column if not exists manual_tuss_override boolean not null default false,
  add column if not exists override_reason text,
  add column if not exists synchronized_at timestamptz,
  add column if not exists synchronized_by uuid references public.users(id) on delete set null,
  add column if not exists sync_metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_patient_payer_authorizations_mapping
  on public.patient_payer_authorizations (organization_id, payer_tuss_mapping_id)
  where payer_tuss_mapping_id is not null;

create index if not exists idx_patient_payer_authorizations_tuss_sync
  on public.patient_payer_authorizations (organization_id, payer_id, service_catalog_id, status, active)
  where service_catalog_id is not null;

alter table public.tiss_revenue_cycle_events
  drop constraint if exists tiss_revenue_cycle_events_type_check;
alter table public.tiss_revenue_cycle_events
  add constraint tiss_revenue_cycle_events_type_check check (
    event_type in (
      'PRE_GUIDE_MATERIALIZED',
      'PRE_GUIDE_VALIDATED',
      'PRE_GUIDE_READY_FOR_BILLING',
      'PRE_GUIDE_PENDING',
      'AUTHORIZATION_ATTACHED',
      'AUTHORIZATION_TUSS_AUTO_RESOLVED',
      'AUTHORIZATION_TUSS_SYNCHRONIZED',
      'AUTHORIZATION_TUSS_OVERRIDE_APPLIED',
      'PRE_GUIDES_REVALIDATED_AFTER_AUTHORIZATION_SYNC',
      'XML_DRAFT_GENERATED',
      'XML_DRAFT_VALIDATED',
      'XML_DRAFT_SUPERSEDED',
      'TISS_BILLING_BATCH_DRAFT_CREATED',
      'TISS_BILLING_BATCH_DRAFT_CANCELLED',
      'TISS_OFFICIAL_XML_GENERATED',
      'TISS_OFFICIAL_XML_XSD_VALIDATED',
      'MANUAL_OVERRIDE_APPLIED'
    )
  );

notify pgrst, 'reload schema';
