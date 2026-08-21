-- Read-only diagnostic retained for future pgcrypto/search_path incidents in ABA V3 target autobootstrap.
select jsonb_build_object(
  'pgcrypto_schema',
  (
    select n.nspname
    from pg_catalog.pg_extension e
    join pg_catalog.pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pgcrypto'
  ),
  'extensions_digest_text', to_regprocedure('extensions.digest(text,text)') is not null,
  'extensions_digest_bytea', to_regprocedure('extensions.digest(bytea,text)') is not null,
  'public_digest_text', to_regprocedure('public.digest(text,text)') is not null,
  'trigger_exists', exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.aba_targets'::regclass
      and t.tgname = 'trg_sync_aba_v3_target_protocol_v1'
      and not t.tgisinternal
  ),
  'writes', false
) as aba_v3_autobootstrap_digest_diagnostic;
