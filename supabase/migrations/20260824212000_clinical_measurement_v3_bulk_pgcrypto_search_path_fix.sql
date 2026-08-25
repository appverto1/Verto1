-- Verto Clinical Measurement Engine V3
-- Repair pgcrypto resolution for bulk ingestion RPCs.
-- Additive/idempotent: changes function search_path only; no clinical rows are mutated.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
declare
  v_pgcrypto_schema text;
begin
  select n.nspname
    into v_pgcrypto_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';

  if v_pgcrypto_schema is null then
    raise exception 'CMV3_PGCRYPTO_NOT_INSTALLED';
  end if;

  if v_pgcrypto_schema <> 'extensions' then
    raise exception 'CMV3_PGCRYPTO_UNEXPECTED_SCHEMA:%', v_pgcrypto_schema;
  end if;

  if to_regprocedure(
    'public.accept_clinical_measurement_raw_envelopes_bulk_v3(uuid,uuid,uuid,jsonb)'
  ) is null then
    raise exception 'CMV3_RAW_ENVELOPE_BULK_WRITER_MISSING';
  end if;

  if to_regprocedure(
    'public.sync_clinical_measurements_bulk_v3(uuid,uuid,uuid,text,jsonb)'
  ) is null then
    raise exception 'CMV3_BULK_SYNC_WRITER_MISSING';
  end if;
end
$preflight$;

alter function public.accept_clinical_measurement_raw_envelopes_bulk_v3(
  uuid,
  uuid,
  uuid,
  jsonb
)
set search_path = pg_catalog, public, extensions;

alter function public.sync_clinical_measurements_bulk_v3(
  uuid,
  uuid,
  uuid,
  text,
  jsonb
)
set search_path = pg_catalog, public, extensions;

do $postflight$
declare
  v_hash text;
  v_raw_config text;
  v_sync_config text;
begin
  perform set_config('search_path', 'pg_catalog,public,extensions', true);

  select encode(
    digest(convert_to('verto-cmv3-pgcrypto-check', 'UTF8'), 'sha256'),
    'hex'
  )
  into v_hash;

  if v_hash is null or length(v_hash) <> 64 then
    raise exception 'CMV3_PGCRYPTO_RUNTIME_CHECK_FAILED';
  end if;

  select coalesce(array_to_string(p.proconfig, ','), '')
    into v_raw_config
  from pg_proc p
  where p.oid =
    'public.accept_clinical_measurement_raw_envelopes_bulk_v3(uuid,uuid,uuid,jsonb)'::regprocedure;

  select coalesce(array_to_string(p.proconfig, ','), '')
    into v_sync_config
  from pg_proc p
  where p.oid =
    'public.sync_clinical_measurements_bulk_v3(uuid,uuid,uuid,text,jsonb)'::regprocedure;

  if position('extensions' in lower(v_raw_config)) = 0 then
    raise exception 'CMV3_RAW_WRITER_SEARCH_PATH_INVALID';
  end if;

  if position('extensions' in lower(v_sync_config)) = 0 then
    raise exception 'CMV3_SYNC_WRITER_SEARCH_PATH_INVALID';
  end if;
end
$postflight$;

notify pgrst, 'reload schema';

commit;

select jsonb_build_object(
  'gate', 'CMV3_BULK_PGCRYPTO_SEARCH_PATH_REPAIRED',
  'raw_writer_extensions', true,
  'sync_writer_extensions', true,
  'clinical_rows_mutated', false
) as result;
