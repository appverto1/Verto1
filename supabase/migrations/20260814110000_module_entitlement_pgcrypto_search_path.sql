begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- pgcrypto is installed in Supabase under the extensions schema. The entitlement
-- RPC is SECURITY DEFINER with an explicit search_path, so extensions must be
-- explicitly present or unqualified digest(...) cannot be resolved at runtime.
create extension if not exists pgcrypto with schema extensions;

-- Preserve the existing function body and permissions. Only correct its
-- function-local search_path so the already-deployed digest(text, text) call is
-- resolvable. This is idempotent and safe to re-run.
alter function public.apply_sales_offer_module_entitlements_v1(
  uuid,
  uuid,
  text,
  text,
  text
) set search_path = pg_catalog, public, extensions;

-- Fail the migration immediately if pgcrypto is not callable from the exact
-- search path used by the RPC. No application data is changed by this check.
do $verto_pgcrypto_check$
declare
  v_hash text;
begin
  perform set_config('search_path', 'pg_catalog,public,extensions', true);
  select encode(digest('verto-module-entitlement-check'::text, 'sha256'::text), 'hex')
    into v_hash;

  if v_hash is null or char_length(v_hash) <> 64 then
    raise exception 'MODULE_ENTITLEMENT_PGCRYPTO_UNAVAILABLE' using errcode = '42883';
  end if;
end
$verto_pgcrypto_check$;

notify pgrst, 'reload schema';
commit;
