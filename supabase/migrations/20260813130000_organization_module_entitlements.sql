begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create extension if not exists pgcrypto;

alter table public.sales_offers
  add column if not exists trial_days integer not null default 0;

alter table public.sales_offers
  drop constraint if exists sales_offers_modular_checkout_disabled_check;

alter table public.sales_offers
  drop constraint if exists sales_offers_trial_days_check;
alter table public.sales_offers
  add constraint sales_offers_trial_days_check
  check (trial_days in (0, 7, 14, 30)) not valid;
alter table public.sales_offers validate constraint sales_offers_trial_days_check;

comment on column public.sales_offers.modular_checkout_enabled is
  'Habilita Checkout modular para propostas novas preparadas pelo fluxo comercial versionado. Propostas históricas permanecem inalteradas.';
comment on column public.sales_offers.trial_days is
  'Trial comercial congelado da proposta modular. Valores permitidos: 0, 7, 14 ou 30 dias.';

create table if not exists public.organization_module_access_profiles (
  organization_id uuid primary key references public.clinics(id) on delete restrict,
  mode text not null default 'legacy_full',
  version bigint not null default 1,
  source_offer_id uuid references public.sales_offers(id) on delete restrict,
  stripe_subscription_id text,
  activated_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint organization_module_access_profiles_mode_check check (mode in ('legacy_full', 'contract')),
  constraint organization_module_access_profiles_version_check check (version >= 1)
);

create unique index if not exists organization_module_access_profiles_subscription_uidx
  on public.organization_module_access_profiles (stripe_subscription_id)
  where stripe_subscription_id is not null;

create table if not exists public.organization_module_entitlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  module_key text not null,
  status text not null,
  source_offer_id uuid references public.sales_offers(id) on delete restrict,
  source_offer_item_id uuid references public.sales_offer_items(id) on delete restrict,
  stripe_subscription_id text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_module_entitlements_module_key_check check (
    module_key in ('clinical_core','appointments_communication','financial_management','insurance_tiss','school_management')
  ),
  constraint organization_module_entitlements_status_check check (
    status in ('active','trial','grace','suspended','cancelled')
  ),
  constraint organization_module_entitlements_dates_check check (ends_at is null or ends_at >= starts_at),
  unique (organization_id, module_key)
);

create index if not exists organization_module_entitlements_org_status_idx
  on public.organization_module_entitlements (organization_id, status, module_key);
create index if not exists organization_module_entitlements_subscription_idx
  on public.organization_module_entitlements (stripe_subscription_id)
  where stripe_subscription_id is not null;

create table if not exists public.organization_module_entitlement_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  module_key text,
  event_type text not null,
  source_offer_id uuid references public.sales_offers(id) on delete restrict,
  stripe_subscription_id text,
  stripe_event_id text,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint organization_module_entitlement_events_module_key_check check (
    module_key is null or module_key in ('clinical_core','appointments_communication','financial_management','insurance_tiss','school_management')
  ),
  constraint organization_module_entitlement_events_idempotency_length check (char_length(idempotency_key) between 12 and 240),
  constraint organization_module_entitlement_events_payload_object check (jsonb_typeof(payload) = 'object'),
  unique (idempotency_key)
);

create index if not exists organization_module_entitlement_events_org_created_idx
  on public.organization_module_entitlement_events (organization_id, created_at desc);
create index if not exists organization_module_entitlement_events_stripe_event_idx
  on public.organization_module_entitlement_events (stripe_event_id)
  where stripe_event_id is not null;

alter table public.organization_module_access_profiles enable row level security;
alter table public.organization_module_entitlements enable row level security;
alter table public.organization_module_entitlement_events enable row level security;

revoke all on table public.organization_module_access_profiles from anon, authenticated;
revoke all on table public.organization_module_entitlements from anon, authenticated;
revoke all on table public.organization_module_entitlement_events from anon, authenticated;
grant all on table public.organization_module_access_profiles to service_role;
grant all on table public.organization_module_entitlements to service_role;
grant all on table public.organization_module_entitlement_events to service_role;

create or replace function public.protect_organization_module_entitlement_events_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'ORGANIZATION_MODULE_ENTITLEMENT_EVENTS_APPEND_ONLY' using errcode = '55000';
end
$function$;

revoke all on function public.protect_organization_module_entitlement_events_v1() from public, anon, authenticated;
grant execute on function public.protect_organization_module_entitlement_events_v1() to service_role;

drop trigger if exists organization_module_entitlement_events_append_only_v1
  on public.organization_module_entitlement_events;
create trigger organization_module_entitlement_events_append_only_v1
before update or delete on public.organization_module_entitlement_events
for each row execute function public.protect_organization_module_entitlement_events_v1();

-- Preserve exactly the current access for every organization that exists when
-- this migration is applied. No per-row loop: one set-based backfill.
insert into public.organization_module_access_profiles (
  organization_id, mode, version, updated_at
)
select c.id, 'legacy_full', 1, now()
from public.clinics c
on conflict (organization_id) do nothing;

-- New generic/legacy clinic creation remains backward compatible. A paid modular
-- sales activation switches this row to contract in the same login flow before
-- the workspace is returned to the customer.
create or replace function public.initialize_organization_module_access_profile_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  insert into public.organization_module_access_profiles (organization_id, mode, version, updated_at)
  values (new.id, 'legacy_full', 1, now())
  on conflict (organization_id) do nothing;
  return new;
end
$function$;

revoke all on function public.initialize_organization_module_access_profile_v1() from public, anon, authenticated;
grant execute on function public.initialize_organization_module_access_profile_v1() to service_role;

drop trigger if exists clinics_initialize_module_access_profile_v1 on public.clinics;
create trigger clinics_initialize_module_access_profile_v1
after insert on public.clinics
for each row execute function public.initialize_organization_module_access_profile_v1();

-- Commercial fields remain immutable. Stripe linkage fields are operational and
-- may be reconciled after webhook/Checkout without weakening the frozen price,
-- module set or trial evidence.
create or replace function public.protect_sales_modular_offer_financials_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  creation_mode boolean := coalesce(current_setting('verto.modular_offer_creation', true), '') = 'on';
begin
  if tg_op = 'DELETE' and old.offer_type = 'modular' then
    raise exception 'SALES_MODULAR_OFFER_IMMUTABLE' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE'
     and (
       new.offer_type is distinct from old.offer_type
       or (
         old.offer_type = 'modular'
         and (
           new.lead_id is distinct from old.lead_id
           or new.simulation_id is distinct from old.simulation_id
           or new.simulation_snapshot is distinct from old.simulation_snapshot
           or new.base_unit_amount_cents is distinct from old.base_unit_amount_cents
           or new.currency is distinct from old.currency
           or new.initial_active_patient_quantity is distinct from old.initial_active_patient_quantity
           or new.discount_duration_months is distinct from old.discount_duration_months
           or new.discount_type is distinct from old.discount_type
           or new.discount_percentage is distinct from old.discount_percentage
           or new.promotional_monthly_amount_cents is distinct from old.promotional_monthly_amount_cents
           or new.post_discount_monthly_amount_cents is distinct from old.post_discount_monthly_amount_cents
           or new.internal_justification is distinct from old.internal_justification
           or new.public_token_hash is distinct from old.public_token_hash
           or new.expires_at is distinct from old.expires_at
           or new.created_by is distinct from old.created_by
           or new.idempotency_key is distinct from old.idempotency_key
           or new.catalog_version_id is distinct from old.catalog_version_id
           or new.proposal_name is distinct from old.proposal_name
           or new.public_notes is distinct from old.public_notes
           or (not creation_mode and new.modular_checkout_enabled is distinct from old.modular_checkout_enabled)
           or (not creation_mode and new.trial_days is distinct from old.trial_days)
           or (not creation_mode and new.modular_snapshot is distinct from old.modular_snapshot)
           or new.request_hash is distinct from old.request_hash
         )
       )
     ) then
    raise exception 'SALES_MODULAR_OFFER_FINANCIALS_IMMUTABLE' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$function$;

-- Versioned wrapper: reuse the existing canonical snapshot creation, then freeze
-- trial + modular Checkout only for a newly created offer. Historical idempotent
-- offers are never silently enabled.
create or replace function public.create_sales_modular_offer_v2(
  p_simulation_id uuid,
  p_lead_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_public_token_hash text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  result jsonb;
  offer_id uuid;
  trial_value integer;
  refreshed_offer public.sales_offers%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SALES_MODULAR_OFFER_SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  perform set_config('verto.modular_offer_creation', 'on', true);
  result := public.create_sales_modular_offer_v1(
    p_simulation_id,
    p_lead_id,
    p_actor_user_id,
    p_idempotency_key,
    p_request_hash,
    p_public_token_hash,
    p_expires_at
  );
  offer_id := nullif(result #>> '{offer,id}', '')::uuid;
  if offer_id is null then
    raise exception 'PROPOSAL_SNAPSHOT_CONFLICT' using errcode = 'P0001';
  end if;
  if coalesce((result->>'idempotent')::boolean, false) = false then
    select case
      when coalesce(s.modular_input_snapshot->>'trialDays', '0') in ('0','7','14','30')
        then (coalesce(s.modular_input_snapshot->>'trialDays', '0'))::integer
      else 0
    end
    into trial_value
    from public.sales_offer_simulations s
    where s.id = p_simulation_id and s.lead_id = p_lead_id;

    update public.sales_offers
       set trial_days = coalesce(trial_value, 0),
           modular_checkout_enabled = true,
           modular_snapshot = coalesce(modular_snapshot, '{}'::jsonb)
             || jsonb_build_object('trialDays', coalesce(trial_value, 0)),
           updated_at = now()
     where id = offer_id
       and offer_type = 'modular'
     returning * into refreshed_offer;
    result := jsonb_set(result, '{offer}', to_jsonb(refreshed_offer), true);
  end if;
  return result;
end
$function$;

revoke all on function public.create_sales_modular_offer_v2(uuid,uuid,uuid,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.create_sales_modular_offer_v2(uuid,uuid,uuid,text,text,text,timestamptz) to service_role;

-- One canonical read for the whole module set. The application loads this once
-- per authorization context and reuses it for every capability/module check.
create or replace function public.get_organization_module_access_v1(
  p_organization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  profile_row public.organization_module_access_profiles%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'CLINIC_MODULE_SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_organization_id is null then
    raise exception 'CLINIC_MODULE_ORGANIZATION_INVALID' using errcode = '22023';
  end if;

  select * into profile_row
    from public.organization_module_access_profiles
   where organization_id = p_organization_id;
  if not found then
    raise exception 'CLINIC_MODULE_ACCESS_PROFILE_MISSING' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'mode', profile_row.mode,
    'version', profile_row.version,
    'modules', coalesce((
      select jsonb_agg(e.module_key order by e.module_key)
        from public.organization_module_entitlements e
       where e.organization_id = p_organization_id
         and e.status in ('active','trial','grace')
         and e.starts_at <= now()
         and (e.ends_at is null or e.ends_at > now())
    ), '[]'::jsonb)
  );
end
$function$;

revoke all on function public.get_organization_module_access_v1(uuid) from public, anon, authenticated;
grant execute on function public.get_organization_module_access_v1(uuid) to service_role;

create or replace function public.apply_sales_offer_module_entitlements_v1(
  p_offer_id uuid,
  p_organization_id uuid,
  p_stripe_subscription_id text,
  p_stripe_event_id text,
  p_status text default 'active'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  offer_row public.sales_offers%rowtype;
  lead_row public.sales_leads%rowtype;
  profile_row public.organization_module_access_profiles%rowtype;
  effective_status text := lower(coalesce(p_status, ''));
  event_key text;
  before_modules jsonb;
  after_modules jsonb;
  selected_modules jsonb;
  selected_count integer := 0;
  unknown_count integer := 0;
  effective_changed boolean := false;
begin
  if auth.role() <> 'service_role' then
    raise exception 'MODULE_ENTITLEMENT_SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_offer_id is null or p_organization_id is null
     or char_length(coalesce(p_stripe_subscription_id, '')) < 3
     or char_length(coalesce(p_stripe_event_id, '')) < 3
     or effective_status not in ('active','trial','grace','suspended','cancelled') then
    raise exception 'MODULE_ENTITLEMENT_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  event_key := 'module-entitlement:' || p_offer_id::text || ':' || p_organization_id::text || ':'
    || left(encode(digest(p_stripe_subscription_id || ':' || p_stripe_event_id || ':' || effective_status, 'sha256'), 'hex'), 64);

  if exists (
    select 1 from public.organization_module_entitlement_events e
    where e.idempotency_key = event_key
  ) then
    select * into profile_row
      from public.organization_module_access_profiles
     where organization_id = p_organization_id;
    return jsonb_build_object(
      'idempotent', true,
      'mode', profile_row.mode,
      'version', profile_row.version,
      'modules', coalesce((
        select jsonb_agg(e.module_key order by e.module_key)
          from public.organization_module_entitlements e
         where e.organization_id = p_organization_id
           and e.status in ('active','trial','grace')
           and e.starts_at <= now()
           and (e.ends_at is null or e.ends_at > now())
      ), '[]'::jsonb)
    );
  end if;

  select * into offer_row
    from public.sales_offers
   where id = p_offer_id
   for update;
  if not found or offer_row.offer_type <> 'modular'
     or offer_row.accepted_at is null or offer_row.revoked_at is not null then
    raise exception 'MODULE_ENTITLEMENT_OFFER_INVALID' using errcode = 'P0001';
  end if;

  select * into lead_row
    from public.sales_leads
   where id = offer_row.lead_id and deleted_at is null
   for update;
  if not found or lead_row.converted_clinic_id is distinct from p_organization_id then
    raise exception 'MODULE_ENTITLEMENT_ORGANIZATION_MISMATCH' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.organization_module_access_profiles p
     where p.stripe_subscription_id = p_stripe_subscription_id
       and p.organization_id <> p_organization_id
  ) then
    raise exception 'MODULE_ENTITLEMENT_SUBSCRIPTION_TENANT_MISMATCH' using errcode = '42501';
  end if;

  select count(*) into unknown_count
    from public.sales_offer_items i
   where i.offer_id = p_offer_id
     and i.item_key not in (
       'clinical_core','appointments_communication','financial_management','insurance_tiss','school_management',
       'platform_foundation','additional_storage','onboarding'
     );
  if unknown_count > 0 then
    raise exception 'MODULE_ENTITLEMENT_UNKNOWN_MODULE' using errcode = '22023';
  end if;

  select count(*) into selected_count
    from public.sales_offer_items i
   where i.offer_id = p_offer_id
     and i.item_key in ('clinical_core','appointments_communication','financial_management','insurance_tiss','school_management');
  if selected_count < 1 then
    raise exception 'MODULE_ENTITLEMENT_EMPTY_CONTRACT' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(x.module_key order by x.module_key), '[]'::jsonb)
    into before_modules
    from (
      select e.module_key
        from public.organization_module_entitlements e
       where e.organization_id = p_organization_id
         and e.status in ('active','trial','grace')
         and e.starts_at <= now()
         and (e.ends_at is null or e.ends_at > now())
    ) x;

  insert into public.organization_module_access_profiles (
    organization_id, mode, version, source_offer_id, stripe_subscription_id, activated_at, updated_at
  ) values (
    p_organization_id, 'contract', 1, p_offer_id, p_stripe_subscription_id,
    case when effective_status in ('active','trial','grace') then now() else null end, now()
  )
  on conflict (organization_id) do update set
    mode = 'contract',
    source_offer_id = excluded.source_offer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    activated_at = coalesce(public.organization_module_access_profiles.activated_at, excluded.activated_at),
    updated_at = now();

  insert into public.organization_module_entitlements (
    organization_id, module_key, status, source_offer_id, source_offer_item_id,
    stripe_subscription_id, starts_at, ends_at, created_at, updated_at
  )
  select
    p_organization_id,
    i.item_key,
    effective_status,
    p_offer_id,
    (array_agg(i.id order by i.sort_order, i.id))[1],
    p_stripe_subscription_id,
    now(),
    case when effective_status = 'cancelled' then now() else null end,
    now(),
    now()
  from public.sales_offer_items i
  where i.offer_id = p_offer_id
    and i.item_key in ('clinical_core','appointments_communication','financial_management','insurance_tiss','school_management')
  group by i.item_key
  on conflict (organization_id, module_key) do update set
    status = excluded.status,
    source_offer_id = excluded.source_offer_id,
    source_offer_item_id = excluded.source_offer_item_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    starts_at = case
      when excluded.status in ('active','trial','grace') then least(public.organization_module_entitlements.starts_at, now())
      else public.organization_module_entitlements.starts_at
    end,
    ends_at = case when excluded.status = 'cancelled' then now() else null end,
    updated_at = now();

  -- A replacement contract defines the current operational set. Preserve every
  -- domain row; only entitlement state changes.
  if effective_status in ('active','trial','grace') then
    update public.organization_module_entitlements e
       set status = 'cancelled', ends_at = now(), updated_at = now()
     where e.organization_id = p_organization_id
       and e.module_key not in (
         select i.item_key from public.sales_offer_items i
          where i.offer_id = p_offer_id
            and i.item_key in ('clinical_core','appointments_communication','financial_management','insurance_tiss','school_management')
       )
       and e.status <> 'cancelled';
  elsif effective_status in ('suspended','cancelled') then
    update public.organization_module_entitlements e
       set status = effective_status,
           ends_at = case when effective_status = 'cancelled' then now() else e.ends_at end,
           updated_at = now()
     where e.organization_id = p_organization_id
       and e.stripe_subscription_id = p_stripe_subscription_id;
  end if;

  select coalesce(jsonb_agg(x.module_key order by x.module_key), '[]'::jsonb)
    into after_modules
    from (
      select e.module_key
        from public.organization_module_entitlements e
       where e.organization_id = p_organization_id
         and e.status in ('active','trial','grace')
         and e.starts_at <= now()
         and (e.ends_at is null or e.ends_at > now())
    ) x;

  effective_changed := before_modules is distinct from after_modules;
  if effective_changed then
    update public.organization_module_access_profiles
       set version = version + 1, updated_at = now()
     where organization_id = p_organization_id;
  end if;

  select coalesce(jsonb_agg(i.item_key order by i.item_key), '[]'::jsonb)
    into selected_modules
    from (
      select distinct item_key
      from public.sales_offer_items
      where offer_id = p_offer_id
        and item_key in ('clinical_core','appointments_communication','financial_management','insurance_tiss','school_management')
    ) i;

  insert into public.organization_module_entitlement_events (
    organization_id, module_key, event_type, source_offer_id,
    stripe_subscription_id, stripe_event_id, idempotency_key, payload
  ) values (
    p_organization_id,
    null,
    upper(effective_status),
    p_offer_id,
    p_stripe_subscription_id,
    p_stripe_event_id,
    event_key,
    jsonb_build_object(
      'selectedModules', selected_modules,
      'effectiveModules', after_modules,
      'effectiveChanged', effective_changed
    )
  ) on conflict (idempotency_key) do nothing;

  select * into profile_row
    from public.organization_module_access_profiles
   where organization_id = p_organization_id;

  return jsonb_build_object(
    'idempotent', false,
    'mode', profile_row.mode,
    'version', profile_row.version,
    'modules', after_modules
  );
end
$function$;

revoke all on function public.apply_sales_offer_module_entitlements_v1(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.apply_sales_offer_module_entitlements_v1(uuid,uuid,text,text,text) to service_role;

notify pgrst, 'reload schema';
commit;
