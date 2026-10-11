-- Issue #170 / contract v4 / 09 Data gate.
-- Additive support for TISS-06 retry safety/financial invariants and TISS-13
-- server-side conference filters. Official XML documents remain immutable.

alter table public.tiss_official_tracking_events
  add column if not exists idempotency_key text;

alter table public.tiss_revenue_cycle_events
  add column if not exists idempotency_key text;

create unique index if not exists idx_tiss_official_tracking_events_idempotency
  on public.tiss_official_tracking_events (clinic_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists idx_tiss_revenue_cycle_events_idempotency
  on public.tiss_revenue_cycle_events (clinic_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_patient_financial_plans_conference_filters
  on public.patient_financial_plans (
    organization_id,
    patient_id,
    payer_id,
    billing_mode,
    insurance_plan_name
  )
  where status = 'ACTIVE' and valid_until is null;

create index if not exists idx_patient_financial_plans_plan_name_normalized
  on public.patient_financial_plans (
    organization_id,
    lower(btrim(insurance_plan_name))
  )
  where status = 'ACTIVE'
    and valid_until is null
    and insurance_plan_name is not null;

alter table public.tiss_official_guide_tracking
  drop constraint if exists tiss_official_guide_tracking_amount_balance_check;
alter table public.tiss_official_guide_tracking
  add constraint tiss_official_guide_tracking_amount_balance_check
  check (paid_amount_cents + glossed_amount_cents <= sent_amount_cents);

alter table public.tiss_official_document_tracking
  drop constraint if exists tiss_official_document_tracking_amount_balance_check;
alter table public.tiss_official_document_tracking
  add constraint tiss_official_document_tracking_amount_balance_check
  check (total_paid_amount_cents + total_glossed_amount_cents <= total_sent_amount_cents);

comment on column public.tiss_official_tracking_events.idempotency_key is
  'Retry-safe key supplied by the server-side TISS mutation boundary; unique per clinic when present.';
comment on column public.tiss_revenue_cycle_events.idempotency_key is
  'Retry-safe key supplied by the server-side TISS revenue-cycle mutation boundary; unique per clinic when present.';

notify pgrst, 'reload schema';
