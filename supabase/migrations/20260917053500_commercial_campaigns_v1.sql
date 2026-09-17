-- #190 Commercial campaigns: server-owned campaign/version/target/exposure/event contract.
-- Additive only. Does not alter entitlement or accepted-offer authorities.

create extension if not exists pgcrypto;

create table if not exists public.commercial_campaigns (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'draft' check (status in ('draft','scheduled','active','paused','ended')),
  target_mode text not null default 'all_eligible' check (target_mode in ('all_eligible','selected_clinics')),
  starts_at timestamptz,
  ends_at timestamptz,
  current_version integer not null default 1 check (current_version > 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table if not exists public.commercial_campaign_versions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.commercial_campaigns(id) on delete restrict,
  version integer not null check (version > 0),
  module_key text not null check (length(btrim(module_key)) between 1 and 80),
  title text not null check (length(btrim(title)) between 1 and 180),
  body text not null check (length(body) between 1 and 2000),
  badge_label text not null default 'Oferta Verto' check (length(badge_label) between 1 and 80),
  surface_kind text not null default 'banner' check (surface_kind in ('banner','card','modal')),
  audience_capability text not null check (length(btrim(audience_capability)) between 1 and 120),
  allow_passive_after_intrusive_cap boolean not null default true,
  commercial_condition jsonb not null default '{}'::jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (campaign_id, version)
);

create table if not exists public.commercial_campaign_targets (
  campaign_id uuid not null references public.commercial_campaigns(id) on delete cascade,
  organization_id uuid not null references public.clinics(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (campaign_id, organization_id)
);

create table if not exists public.commercial_campaign_exposures (
  organization_id uuid not null references public.clinics(id) on delete cascade,
  campaign_version_id uuid not null references public.commercial_campaign_versions(id) on delete cascade,
  user_id uuid not null,
  intrusive_impression_count smallint not null default 0 check (intrusive_impression_count between 0 and 2),
  dismiss_count smallint not null default 0 check (dismiss_count between 0 and 2),
  suppressed_until timestamptz,
  last_impression_at timestamptz,
  last_dismissed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (organization_id, campaign_version_id, user_id)
);

create table if not exists public.commercial_campaign_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  campaign_version_id uuid not null references public.commercial_campaign_versions(id) on delete restrict,
  user_id uuid,
  event_type text not null check (event_type in ('impression','dismiss','cta','offer_materialized','conversion')),
  idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 180),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create index if not exists idx_commercial_campaigns_delivery
  on public.commercial_campaigns (status, starts_at, ends_at);
create index if not exists idx_commercial_campaign_targets_org
  on public.commercial_campaign_targets (organization_id, campaign_id);
create index if not exists idx_commercial_campaign_versions_module
  on public.commercial_campaign_versions (module_key, campaign_id, version desc);
create index if not exists idx_commercial_campaign_exposures_delivery
  on public.commercial_campaign_exposures (organization_id, user_id, suppressed_until, campaign_version_id);
create index if not exists idx_commercial_campaign_events_aggregate
  on public.commercial_campaign_events (campaign_version_id, event_type, created_at desc);

alter table public.commercial_campaigns enable row level security;
alter table public.commercial_campaign_versions enable row level security;
alter table public.commercial_campaign_targets enable row level security;
alter table public.commercial_campaign_exposures enable row level security;
alter table public.commercial_campaign_events enable row level security;

drop policy if exists commercial_campaigns_platform_sales_admin_all on public.commercial_campaigns;
create policy commercial_campaigns_platform_sales_admin_all on public.commercial_campaigns
for all to authenticated using (public.is_platform_sales_admin()) with check (public.is_platform_sales_admin());

drop policy if exists commercial_campaign_versions_platform_sales_admin_all on public.commercial_campaign_versions;
create policy commercial_campaign_versions_platform_sales_admin_all on public.commercial_campaign_versions
for all to authenticated using (public.is_platform_sales_admin()) with check (public.is_platform_sales_admin());

drop policy if exists commercial_campaign_targets_platform_sales_admin_all on public.commercial_campaign_targets;
create policy commercial_campaign_targets_platform_sales_admin_all on public.commercial_campaign_targets
for all to authenticated using (public.is_platform_sales_admin()) with check (public.is_platform_sales_admin());

drop policy if exists commercial_campaign_exposures_platform_sales_admin_all on public.commercial_campaign_exposures;
create policy commercial_campaign_exposures_platform_sales_admin_all on public.commercial_campaign_exposures
for all to authenticated using (public.is_platform_sales_admin()) with check (public.is_platform_sales_admin());

drop policy if exists commercial_campaign_events_platform_sales_admin_all on public.commercial_campaign_events;
create policy commercial_campaign_events_platform_sales_admin_all on public.commercial_campaign_events
for all to authenticated using (public.is_platform_sales_admin()) with check (public.is_platform_sales_admin());

-- Delivery/mutation is intentionally server-owned through service_role. Browser RLS does not
-- grant tenant users direct campaign/exposure/event access; the 05 server endpoints derive
-- tenant/user/capability from the authenticated session and revalidate entitlement/demo state.

grant select, insert, update, delete on public.commercial_campaigns to service_role;
grant select, insert, update, delete on public.commercial_campaign_versions to service_role;
grant select, insert, update, delete on public.commercial_campaign_targets to service_role;
grant select, insert, update, delete on public.commercial_campaign_exposures to service_role;
grant select, insert on public.commercial_campaign_events to service_role;
