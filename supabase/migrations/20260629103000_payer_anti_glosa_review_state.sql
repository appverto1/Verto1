-- Additive anti-glosa review state for payer TISS profiles.
-- This does not change XML generation, XSD validation, official documents, prices, mappings, or authorizations.

alter table public.payer_tiss_profiles
  add column if not exists anti_glosa_reviewed boolean not null default false,
  add column if not exists anti_glosa_reviewed_at timestamptz,
  add column if not exists anti_glosa_reviewed_by uuid references public.users(id) on delete set null,
  add column if not exists operator_has_no_additional_requirements boolean not null default false;

create index if not exists idx_payer_tiss_profiles_anti_glosa_review
  on public.payer_tiss_profiles (organization_id, payer_id, active, anti_glosa_reviewed);

comment on column public.payer_tiss_profiles.anti_glosa_reviewed is
  'True when a clinic user reviewed the payer anti-glosa requirements profile.';

comment on column public.payer_tiss_profiles.operator_has_no_additional_requirements is
  'True when the payer was explicitly reviewed and confirmed to have no additional anti-glosa requirements beyond universal TISS/contract checks.';

notify pgrst, 'reload schema';
