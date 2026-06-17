-- Camada TUSS-ready para pre-faturamento e conferencia de convenios.
-- Esta migration NAO implementa XML TISS, remessa, retorno, glosa, recurso,
-- validacao XSD, envio para operadora ou integracao externa de billing.

create extension if not exists "pgcrypto";

create table if not exists public.tuss_service_catalog (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  internal_code text,
  name text not null,
  description text,
  specialty text,
  service_type text,
  default_duration_minutes integer,
  billing_unit text not null default 'session',
  default_quantity numeric(12, 4) not null default 1,
  default_amount_cents integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  constraint tuss_service_catalog_billing_unit_check check (billing_unit in ('session', 'hour', 'minute', 'unit', 'package')),
  constraint tuss_service_catalog_default_duration_check check (default_duration_minutes is null or default_duration_minutes > 0),
  constraint tuss_service_catalog_default_quantity_check check (default_quantity > 0),
  constraint tuss_service_catalog_default_amount_check check (default_amount_cents is null or default_amount_cents >= 0)
);

alter table public.tuss_service_catalog
  add column if not exists organization_id uuid references public.clinics(id) on delete cascade,
  add column if not exists internal_code text,
  add column if not exists name text,
  add column if not exists description text,
  add column if not exists specialty text,
  add column if not exists service_type text,
  add column if not exists default_duration_minutes integer,
  add column if not exists billing_unit text not null default 'session',
  add column if not exists default_quantity numeric(12, 4) not null default 1,
  add column if not exists default_amount_cents integer,
  add column if not exists active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid;

create unique index if not exists idx_tuss_service_catalog_org_internal_code
  on public.tuss_service_catalog (organization_id, lower(internal_code))
  where internal_code is not null and active = true;
create index if not exists idx_tuss_service_catalog_org_service_type
  on public.tuss_service_catalog (organization_id, service_type)
  where active = true;
create index if not exists idx_tuss_service_catalog_org_active
  on public.tuss_service_catalog (organization_id, active);

alter table public.tuss_service_catalog enable row level security;

drop policy if exists tuss_service_catalog_select_staff on public.tuss_service_catalog;
create policy tuss_service_catalog_select_staff on public.tuss_service_catalog
  for select
  using (
    organization_id in (
      select clinic_id from public.users
      where id = auth.uid()
        and role in ('owner', 'admin', 'coordinator')
    )
  );

drop policy if exists tuss_service_catalog_write_staff on public.tuss_service_catalog;
create policy tuss_service_catalog_write_staff on public.tuss_service_catalog
  for all
  using (
    organization_id in (
      select clinic_id from public.users
      where id = auth.uid()
        and role in ('owner', 'admin', 'coordinator')
    )
  )
  with check (
    organization_id in (
      select clinic_id from public.users
      where id = auth.uid()
        and role in ('owner', 'admin', 'coordinator')
    )
  );

create table if not exists public.tuss_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  code text not null,
  description text not null,
  term_type text,
  version text,
  valid_from date,
  valid_to date,
  active boolean not null default true,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  constraint tuss_codes_validity_check check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

alter table public.tuss_codes
  add column if not exists organization_id uuid references public.clinics(id) on delete cascade,
  add column if not exists code text,
  add column if not exists description text,
  add column if not exists term_type text,
  add column if not exists version text,
  add column if not exists valid_from date,
  add column if not exists valid_to date,
  add column if not exists active boolean not null default true,
  add column if not exists source text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid;

create unique index if not exists idx_tuss_codes_org_code_version
  on public.tuss_codes (organization_id, code, coalesce(version, ''))
  where active = true;
create index if not exists idx_tuss_codes_org_active
  on public.tuss_codes (organization_id, active);
create index if not exists idx_tuss_codes_org_code
  on public.tuss_codes (organization_id, code);

alter table public.tuss_codes enable row level security;

drop policy if exists tuss_codes_select_staff on public.tuss_codes;
create policy tuss_codes_select_staff on public.tuss_codes
  for select
  using (
    organization_id in (
      select clinic_id from public.users
      where id = auth.uid()
        and role in ('owner', 'admin', 'coordinator')
    )
  );

drop policy if exists tuss_codes_write_staff on public.tuss_codes;
create policy tuss_codes_write_staff on public.tuss_codes
  for all
  using (
    organization_id in (
      select clinic_id from public.users
      where id = auth.uid()
        and role in ('owner', 'admin', 'coordinator')
    )
  )
  with check (
    organization_id in (
      select clinic_id from public.users
      where id = auth.uid()
        and role in ('owner', 'admin', 'coordinator')
    )
  );

create table if not exists public.payer_tuss_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  payer_id uuid not null references public.clinic_payers(id) on delete cascade,
  service_catalog_id uuid not null references public.tuss_service_catalog(id) on delete cascade,
  tuss_code_id uuid references public.tuss_codes(id) on delete restrict,
  guide_type text not null default 'sp_sadt',
  billing_unit text not null default 'session',
  quantity_rule text not null default 'per_session',
  default_quantity numeric(12, 4) not null default 1,
  amount_cents integer,
  requires_authorization boolean not null default false,
  requires_guide boolean not null default false,
  requires_report boolean not null default false,
  requires_signature boolean not null default false,
  requires_professional_registry boolean not null default false,
  requires_patient_document boolean not null default false,
  use_actual_duration boolean not null default false,
  active boolean not null default true,
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  constraint payer_tuss_mappings_guide_type_check check (guide_type in ('consulta', 'sp_sadt', 'other')),
  constraint payer_tuss_mappings_billing_unit_check check (billing_unit in ('session', 'hour', 'minute', 'unit', 'package')),
  constraint payer_tuss_mappings_quantity_rule_check check (quantity_rule in ('fixed', 'duration_based', 'per_session', 'per_hour')),
  constraint payer_tuss_mappings_default_quantity_check check (default_quantity > 0),
  constraint payer_tuss_mappings_amount_check check (amount_cents is null or amount_cents >= 0),
  constraint payer_tuss_mappings_validity_check check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

alter table public.payer_tuss_mappings
  add column if not exists organization_id uuid references public.clinics(id) on delete cascade,
  add column if not exists payer_id uuid references public.clinic_payers(id) on delete cascade,
  add column if not exists service_catalog_id uuid references public.tuss_service_catalog(id) on delete cascade,
  add column if not exists tuss_code_id uuid references public.tuss_codes(id) on delete restrict,
  add column if not exists guide_type text not null default 'sp_sadt',
  add column if not exists billing_unit text not null default 'session',
  add column if not exists quantity_rule text not null default 'per_session',
  add column if not exists default_quantity numeric(12, 4) not null default 1,
  add column if not exists amount_cents integer,
  add column if not exists requires_authorization boolean not null default false,
  add column if not exists requires_guide boolean not null default false,
  add column if not exists requires_report boolean not null default false,
  add column if not exists requires_signature boolean not null default false,
  add column if not exists requires_professional_registry boolean not null default false,
  add column if not exists requires_patient_document boolean not null default false,
  add column if not exists use_actual_duration boolean not null default false,
  add column if not exists active boolean not null default true,
  add column if not exists valid_from date,
  add column if not exists valid_to date,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid;

create unique index if not exists idx_payer_tuss_mappings_active_unique
  on public.payer_tuss_mappings (organization_id, payer_id, service_catalog_id)
  where active = true;
create index if not exists idx_payer_tuss_mappings_clinic_payer_service
  on public.payer_tuss_mappings (organization_id, payer_id, service_catalog_id)
  where active = true;
create index if not exists idx_payer_tuss_mappings_tuss_code
  on public.payer_tuss_mappings (organization_id, tuss_code_id)
  where active = true;
create index if not exists idx_payer_tuss_mappings_validity
  on public.payer_tuss_mappings (organization_id, valid_from, valid_to)
  where active = true;

alter table public.payer_tuss_mappings enable row level security;

drop policy if exists payer_tuss_mappings_select_staff on public.payer_tuss_mappings;
create policy payer_tuss_mappings_select_staff on public.payer_tuss_mappings
  for select
  using (
    organization_id in (
      select clinic_id from public.users
      where id = auth.uid()
        and role in ('owner', 'admin', 'coordinator')
    )
  );

drop policy if exists payer_tuss_mappings_write_staff on public.payer_tuss_mappings;
create policy payer_tuss_mappings_write_staff on public.payer_tuss_mappings
  for all
  using (
    organization_id in (
      select clinic_id from public.users
      where id = auth.uid()
        and role in ('owner', 'admin', 'coordinator')
    )
  )
  with check (
    organization_id in (
      select clinic_id from public.users
      where id = auth.uid()
        and role in ('owner', 'admin', 'coordinator')
    )
  );

create table if not exists public.appointment_billing_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  professional_id uuid,
  payer_id uuid references public.clinic_payers(id) on delete set null,
  service_catalog_id uuid references public.tuss_service_catalog(id) on delete set null,
  tuss_code_id uuid references public.tuss_codes(id) on delete set null,
  payer_tuss_mapping_id uuid references public.payer_tuss_mappings(id) on delete set null,
  guide_type text,
  billing_unit text,
  quantity numeric(12, 4) not null default 1,
  duration_minutes integer,
  unit_amount_cents integer,
  amount_cents integer,
  authorization_number text,
  guide_number text,
  card_number text,
  status text not null default 'draft',
  readiness_reason text,
  readiness_reasons text[] not null default array[]::text[],
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  constraint appointment_billing_items_status_check check (status in ('draft', 'ready', 'pending', 'reviewed', 'exported', 'non_billable')),
  constraint appointment_billing_items_billing_unit_check check (billing_unit is null or billing_unit in ('session', 'hour', 'minute', 'unit', 'package')),
  constraint appointment_billing_items_guide_type_check check (guide_type is null or guide_type in ('consulta', 'sp_sadt', 'other')),
  constraint appointment_billing_items_quantity_check check (quantity > 0),
  constraint appointment_billing_items_duration_check check (duration_minutes is null or duration_minutes >= 0),
  constraint appointment_billing_items_amount_check check (amount_cents is null or amount_cents >= 0),
  constraint appointment_billing_items_unit_amount_check check (unit_amount_cents is null or unit_amount_cents >= 0)
);

alter table public.appointment_billing_items
  add column if not exists organization_id uuid references public.clinics(id) on delete cascade,
  add column if not exists appointment_id uuid references public.appointments(id) on delete cascade,
  add column if not exists patient_id uuid references public.patients(id) on delete cascade,
  add column if not exists professional_id uuid,
  add column if not exists payer_id uuid references public.clinic_payers(id) on delete set null,
  add column if not exists service_catalog_id uuid references public.tuss_service_catalog(id) on delete set null,
  add column if not exists tuss_code_id uuid references public.tuss_codes(id) on delete set null,
  add column if not exists payer_tuss_mapping_id uuid references public.payer_tuss_mappings(id) on delete set null,
  add column if not exists guide_type text,
  add column if not exists billing_unit text,
  add column if not exists quantity numeric(12, 4) not null default 1,
  add column if not exists duration_minutes integer,
  add column if not exists unit_amount_cents integer,
  add column if not exists amount_cents integer,
  add column if not exists authorization_number text,
  add column if not exists guide_number text,
  add column if not exists card_number text,
  add column if not exists status text not null default 'draft',
  add column if not exists readiness_reason text,
  add column if not exists readiness_reasons text[] not null default array[]::text[],
  add column if not exists resolved_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid;

create unique index if not exists idx_appointment_billing_items_appointment
  on public.appointment_billing_items (organization_id, appointment_id);
create index if not exists idx_appointment_billing_items_patient_payer
  on public.appointment_billing_items (organization_id, patient_id, payer_id);
create index if not exists idx_appointment_billing_items_status
  on public.appointment_billing_items (organization_id, status);
create index if not exists idx_appointment_billing_items_tuss
  on public.appointment_billing_items (organization_id, tuss_code_id);
create index if not exists idx_appointment_billing_items_service
  on public.appointment_billing_items (organization_id, service_catalog_id);

alter table public.appointment_billing_items enable row level security;

drop policy if exists appointment_billing_items_select_staff on public.appointment_billing_items;
create policy appointment_billing_items_select_staff on public.appointment_billing_items
  for select to authenticated
  using (
    organization_id in (
      select clinic_id from public.users
      where id = auth.uid()
        and role in ('owner', 'admin', 'coordinator')
    )
  );

drop policy if exists appointment_billing_items_write_staff on public.appointment_billing_items;
create policy appointment_billing_items_write_staff on public.appointment_billing_items
  for all to authenticated
  using (
    organization_id in (
      select clinic_id from public.users
      where id = auth.uid()
        and role in ('owner', 'admin', 'coordinator')
    )
  )
  with check (
    organization_id in (
      select clinic_id from public.users
      where id = auth.uid()
        and role in ('owner', 'admin', 'coordinator')
    )
  );
