begin;

set local lock_timeout = '5s';
set local statement_timeout = '45s';

-- Recovery only: the canonical module-entitlement schema must already exist.
-- Never recreate a partial entitlement model here because that could weaken RLS
-- or silently grant modules with incomplete commercial evidence.
do $verto_module_recovery_preflight$
begin
  if to_regclass('public.organization_module_access_profiles') is null
     or to_regclass('public.organization_module_entitlements') is null
     or to_regclass('public.organization_module_entitlement_events') is null then
    raise exception 'ORGANIZATION_MODULE_ENTITLEMENTS_BASE_MIGRATION_REQUIRED'
      using errcode = '55000';
  end if;

  if to_regprocedure('public.get_organization_module_access_v1(uuid)') is null
     or to_regprocedure('public.apply_sales_offer_module_entitlements_v1(uuid,uuid,text,text,text)') is null then
    raise exception 'ORGANIZATION_MODULE_ENTITLEMENTS_RPC_REQUIRED'
      using errcode = '55000';
  end if;
end
$verto_module_recovery_preflight$;

-- A paid modular activation is stronger evidence than the backward-compatible
-- legacy_full default. If an interrupted activation already owns a technical
-- clinic, fail closed as contract/empty until the existing login recovery flow
-- replays Stripe status and applies the exact frozen offer modules.
with pending_modular_contracts as (
  select distinct on (u.clinic_id)
    u.clinic_id as organization_id,
    o.id as source_offer_id
  from public.users u
  join public.pending_activations pa
    on lower(btrim(pa.email)) = lower(btrim(u.email))
   and pa.source = 'sales_assisted_signup'
   and pa.used = false
   and (pa.expires_at is null or pa.expires_at > now())
  join public.sales_offers o
    on o.id = pa.sales_offer_id
   and o.offer_type = 'modular'
   and o.status = 'paid'
   and o.revoked_at is null
  where u.clinic_id is not null
    and u.id = u.clinic_id
  order by u.clinic_id, pa.created_at desc, o.id desc
)
update public.organization_module_access_profiles p
set
  mode = 'contract',
  source_offer_id = pending.source_offer_id,
  version = p.version + 1,
  updated_at = now()
from pending_modular_contracts pending
where p.organization_id = pending.organization_id
  and p.mode = 'legacy_full';

-- Repair only missing access profiles. Existing clinics keep their established
-- mode. Pending paid modular clinics start fail-closed; every other historical
-- clinic keeps the backward-compatible legacy_full behavior.
with pending_modular_contracts as (
  select distinct on (u.clinic_id)
    u.clinic_id as organization_id,
    o.id as source_offer_id
  from public.users u
  join public.pending_activations pa
    on lower(btrim(pa.email)) = lower(btrim(u.email))
   and pa.source = 'sales_assisted_signup'
   and pa.used = false
   and (pa.expires_at is null or pa.expires_at > now())
  join public.sales_offers o
    on o.id = pa.sales_offer_id
   and o.offer_type = 'modular'
   and o.status = 'paid'
   and o.revoked_at is null
  where u.clinic_id is not null
    and u.id = u.clinic_id
  order by u.clinic_id, pa.created_at desc, o.id desc
)
insert into public.organization_module_access_profiles (
  organization_id,
  mode,
  version,
  source_offer_id,
  updated_at
)
select
  c.id,
  case when pending.organization_id is not null then 'contract' else 'legacy_full' end,
  1,
  pending.source_offer_id,
  now()
from public.clinics c
left join pending_modular_contracts pending
  on pending.organization_id = c.id
left join public.organization_module_access_profiles existing
  on existing.organization_id = c.id
where existing.organization_id is null
on conflict (organization_id) do nothing;

-- Preserve the existing generic-clinic behavior for future non-commercial
-- creation. Commercial activation remains responsible for switching to contract.
create or replace function public.initialize_organization_module_access_profile_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  insert into public.organization_module_access_profiles (
    organization_id,
    mode,
    version,
    updated_at
  )
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

-- Keep pgcrypto reachable by the existing SECURITY DEFINER entitlement RPC.
create extension if not exists pgcrypto with schema extensions;
alter function public.apply_sales_offer_module_entitlements_v1(
  uuid,
  uuid,
  text,
  text,
  text
) set search_path = pg_catalog, public, extensions;

notify pgrst, 'reload schema';
commit;

select
  (select count(*) from public.organization_module_access_profiles) as access_profiles,
  (
    select count(*)
    from public.clinics c
    left join public.organization_module_access_profiles p
      on p.organization_id = c.id
    where p.organization_id is null
  ) as clinics_without_access_profile,
  (
    select count(*)
    from public.users u
    join public.pending_activations pa
      on lower(btrim(pa.email)) = lower(btrim(u.email))
     and pa.source = 'sales_assisted_signup'
     and pa.used = false
     and (pa.expires_at is null or pa.expires_at > now())
    join public.sales_offers o
      on o.id = pa.sales_offer_id
     and o.offer_type = 'modular'
     and o.status = 'paid'
     and o.revoked_at is null
    left join public.organization_module_access_profiles p
      on p.organization_id = u.clinic_id
    where u.clinic_id is not null
      and u.id = u.clinic_id
      and coalesce(p.mode, '') <> 'contract'
  ) as pending_paid_modular_not_contract,
  exists (
    select 1
    from pg_trigger
    where tgname = 'clinics_initialize_module_access_profile_v1'
      and not tgisinternal
  ) as initialization_trigger_ready;
