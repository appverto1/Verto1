-- Manual tracking for validated official TISS XML batches.
-- Additive only. Official XML documents remain immutable; this layer records
-- operator protocol, payment, denial/glosa, appeal and audit state.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.tiss_official_document_tracking (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  official_document_id uuid not null references public.tiss_official_documents(id) on delete cascade,
  payer_id uuid references public.clinic_payers(id) on delete set null,
  competence_month date,
  batch_number text,
  status text not null default 'generated',
  sent_at timestamptz,
  sent_channel text,
  operator_protocol text,
  sent_registered_by uuid references public.users(id) on delete set null,
  expected_return_date date,
  returned_at timestamptz,
  return_status text,
  return_registered_by uuid references public.users(id) on delete set null,
  total_sent_amount_cents integer not null default 0,
  total_paid_amount_cents integer not null default 0,
  total_glossed_amount_cents integer not null default 0,
  total_pending_amount_cents integer not null default 0,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tiss_official_document_tracking_tenant_check check (organization_id = clinic_id),
  constraint tiss_official_document_tracking_status_check check (
    status in (
      'generated',
      'sent_to_operator',
      'protocol_registered',
      'under_review',
      'paid',
      'partially_paid',
      'denied_or_rejected',
      'glossed',
      'appeal_prepared',
      'appeal_sent',
      'appeal_accepted',
      'appeal_rejected',
      'cancelled',
      'replaced'
    )
  ),
  constraint tiss_official_document_tracking_return_status_check check (
    return_status is null or return_status in (
      'paid',
      'partially_paid',
      'glossed',
      'denied_or_rejected',
      'under_review'
    )
  ),
  constraint tiss_official_document_tracking_amounts_check check (
    total_sent_amount_cents >= 0
    and total_paid_amount_cents >= 0
    and total_glossed_amount_cents >= 0
    and total_pending_amount_cents >= 0
  )
);

create unique index if not exists idx_tiss_official_document_tracking_document
  on public.tiss_official_document_tracking (organization_id, official_document_id);
create index if not exists idx_tiss_official_document_tracking_period
  on public.tiss_official_document_tracking (organization_id, competence_month desc, payer_id, status);
create index if not exists idx_tiss_official_document_tracking_status
  on public.tiss_official_document_tracking (organization_id, status, updated_at desc);
create index if not exists idx_tiss_official_document_tracking_protocol
  on public.tiss_official_document_tracking (organization_id, operator_protocol)
  where operator_protocol is not null;

create table if not exists public.tiss_official_guide_tracking (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  official_document_id uuid not null references public.tiss_official_documents(id) on delete cascade,
  official_tracking_id uuid references public.tiss_official_document_tracking(id) on delete cascade,
  pre_guide_id uuid references public.appointment_tiss_pre_guides(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  patient_id uuid references public.patients(id) on delete set null,
  payer_id uuid references public.clinic_payers(id) on delete set null,
  provider_guide_number text,
  operator_guide_number text,
  authorization_code text,
  patient_name text,
  scheduled_start timestamptz,
  tuss_code text,
  procedure_name text,
  status text not null default 'sent',
  sent_amount_cents integer not null default 0,
  paid_amount_cents integer not null default 0,
  glossed_amount_cents integer not null default 0,
  pending_amount_cents integer not null default 0,
  denial_reason text,
  operator_reason_code text,
  internal_note text,
  return_date date,
  payment_date date,
  appeal_deadline date,
  appeal_status text,
  appeal_sent_at timestamptz,
  appeal_result text,
  appeal_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tiss_official_guide_tracking_tenant_check check (organization_id = clinic_id),
  constraint tiss_official_guide_tracking_status_check check (
    status in (
      'sent',
      'under_review',
      'paid',
      'partially_paid',
      'glossed',
      'rejected',
      'appeal_pending',
      'appeal_sent',
      'appeal_accepted',
      'appeal_rejected',
      'cancelled'
    )
  ),
  constraint tiss_official_guide_tracking_appeal_status_check check (
    appeal_status is null or appeal_status in (
      'appeal_pending',
      'appeal_prepared',
      'appeal_sent',
      'appeal_accepted',
      'appeal_rejected'
    )
  ),
  constraint tiss_official_guide_tracking_amounts_check check (
    sent_amount_cents >= 0
    and paid_amount_cents >= 0
    and glossed_amount_cents >= 0
    and pending_amount_cents >= 0
  )
);

create unique index if not exists idx_tiss_official_guide_tracking_pre_guide
  on public.tiss_official_guide_tracking (organization_id, official_document_id, pre_guide_id)
  where pre_guide_id is not null;
create index if not exists idx_tiss_official_guide_tracking_document
  on public.tiss_official_guide_tracking (organization_id, official_document_id, status);
create index if not exists idx_tiss_official_guide_tracking_patient
  on public.tiss_official_guide_tracking (organization_id, patient_id, scheduled_start desc);
create index if not exists idx_tiss_official_guide_tracking_numbers
  on public.tiss_official_guide_tracking (organization_id, provider_guide_number, operator_guide_number);

create table if not exists public.tiss_official_tracking_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  official_document_id uuid not null references public.tiss_official_documents(id) on delete cascade,
  official_tracking_id uuid references public.tiss_official_document_tracking(id) on delete cascade,
  guide_tracking_id uuid references public.tiss_official_guide_tracking(id) on delete cascade,
  pre_guide_id uuid references public.appointment_tiss_pre_guides(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  event_type text not null,
  previous_status text,
  new_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint tiss_official_tracking_events_tenant_check check (organization_id = clinic_id),
  constraint tiss_official_tracking_events_type_check check (
    event_type in (
      'official_xml_tracking_created',
      'official_xml_marked_sent',
      'official_xml_protocol_registered',
      'official_xml_return_registered',
      'official_xml_guide_paid',
      'official_xml_guide_partially_paid',
      'official_xml_guide_glossed',
      'official_xml_guide_rejected',
      'official_xml_appeal_prepared',
      'official_xml_appeal_sent',
      'official_xml_appeal_resolved',
      'official_xml_tracking_note_added'
    )
  )
);

create index if not exists idx_tiss_official_tracking_events_document
  on public.tiss_official_tracking_events (organization_id, official_document_id, created_at desc);
create index if not exists idx_tiss_official_tracking_events_guide
  on public.tiss_official_tracking_events (organization_id, guide_tracking_id, created_at desc);
create index if not exists idx_tiss_official_tracking_events_type
  on public.tiss_official_tracking_events (organization_id, event_type, created_at desc);

alter table public.tiss_official_document_tracking enable row level security;
alter table public.tiss_official_guide_tracking enable row level security;
alter table public.tiss_official_tracking_events enable row level security;

drop policy if exists tiss_official_document_tracking_admin_rw on public.tiss_official_document_tracking;
create policy tiss_official_document_tracking_admin_rw on public.tiss_official_document_tracking
for all to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = tiss_official_document_tracking.clinic_id or u.id = tiss_official_document_tracking.clinic_id)
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = tiss_official_document_tracking.clinic_id or u.id = tiss_official_document_tracking.clinic_id)
  )
);

drop policy if exists tiss_official_guide_tracking_admin_rw on public.tiss_official_guide_tracking;
create policy tiss_official_guide_tracking_admin_rw on public.tiss_official_guide_tracking
for all to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = tiss_official_guide_tracking.clinic_id or u.id = tiss_official_guide_tracking.clinic_id)
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = tiss_official_guide_tracking.clinic_id or u.id = tiss_official_guide_tracking.clinic_id)
  )
);

drop policy if exists tiss_official_tracking_events_admin_rw on public.tiss_official_tracking_events;
create policy tiss_official_tracking_events_admin_rw on public.tiss_official_tracking_events
for all to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = tiss_official_tracking_events.clinic_id or u.id = tiss_official_tracking_events.clinic_id)
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = tiss_official_tracking_events.clinic_id or u.id = tiss_official_tracking_events.clinic_id)
  )
);

revoke all on table public.tiss_official_document_tracking from anon;
revoke all on table public.tiss_official_guide_tracking from anon;
revoke all on table public.tiss_official_tracking_events from anon;

grant select, insert, update on table public.tiss_official_document_tracking to authenticated;
grant select, insert, update on table public.tiss_official_guide_tracking to authenticated;
grant select, insert on table public.tiss_official_tracking_events to authenticated;

notify pgrst, 'reload schema';
