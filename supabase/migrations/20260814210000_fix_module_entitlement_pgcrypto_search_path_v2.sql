begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- The stale-event fence migration recreated both entitlement RPCs after the
-- original pgcrypto search_path repair and unintentionally removed the
-- `extensions` schema again. In Supabase, pgcrypto lives under `extensions`,
-- so unqualified digest(...) inside these SECURITY DEFINER functions fails at
-- runtime even though the functions themselves exist.
create extension if not exists pgcrypto with schema extensions;

alter function public.apply_sales_offer_module_entitlements_v1(
  uuid,
  uuid,
  text,
  text,
  text
) set search_path = pg_catalog, public, extensions;

alter function public.apply_sales_offer_module_entitlements_v2(
  uuid,
  uuid,
  text,
  text,
  timestamptz,
  text
) set search_path = pg_catalog, public, extensions;

-- Validate the exact function-local environment used by the entitlement RPCs.
do $verto_module_entitlement_pgcrypto_check$
declare
  v_hash text;
  v_v1_config text;
  v_v2_config text;
begin
  perform set_config('search_path', 'pg_catalog,public,extensions', true);

  select encode(digest('verto-entitlement-runtime-check'::text, 'sha256'::text), 'hex')
    into v_hash;

  if v_hash is null or char_length(v_hash) <> 64 then
    raise exception 'MODULE_ENTITLEMENT_PGCRYPTO_UNAVAILABLE' using errcode = '42883';
  end if;

  select coalesce(array_to_string(p.proconfig, ','), '')
    into v_v1_config
    from pg_proc p
   where p.oid = 'public.apply_sales_offer_module_entitlements_v1(uuid,uuid,text,text,text)'::regprocedure;

  select coalesce(array_to_string(p.proconfig, ','), '')
    into v_v2_config
    from pg_proc p
   where p.oid = 'public.apply_sales_offer_module_entitlements_v2(uuid,uuid,text,text,timestamptz,text)'::regprocedure;

  if position('extensions' in lower(v_v1_config)) = 0 then
    raise exception 'MODULE_ENTITLEMENT_V1_SEARCH_PATH_INVALID' using errcode = '42883';
  end if;

  if position('extensions' in lower(v_v2_config)) = 0 then
    raise exception 'MODULE_ENTITLEMENT_V2_SEARCH_PATH_INVALID' using errcode = '42883';
  end if;
end
$verto_module_entitlement_pgcrypto_check$;

notify pgrst, 'reload schema';
commit;

select
  position(
    'extensions' in lower(coalesce(array_to_string(p1.proconfig, ','), ''))
  ) > 0 as entitlement_v1_pgcrypto_ready,
  position(
    'extensions' in lower(coalesce(array_to_string(p2.proconfig, ','), ''))
  ) > 0 as entitlement_v2_pgcrypto_ready
from pg_proc p1
cross join pg_proc p2
where p1.oid = 'public.apply_sales_offer_module_entitlements_v1(uuid,uuid,text,text,text)'::regprocedure
  and p2.oid = 'public.apply_sales_offer_module_entitlements_v2(uuid,uuid,text,text,timestamptz,text)'::regprocedure;
