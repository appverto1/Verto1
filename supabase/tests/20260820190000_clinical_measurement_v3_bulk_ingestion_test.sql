-- Structural regression test for Clinical Measurement Engine V3 bulk/offline ingestion.
begin;

do $assertions$
declare
  v_table text;
begin
  foreach v_table in array array[
    'clinical_measurement_sync_batches_v3',
    'clinical_measurement_sync_batch_events_v3',
    'clinical_aba_trial_protocol_intents_v3'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'CMV3_SYNC_TABLE_MISSING: %', v_table;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=v_table and c.relrowsecurity
    ) then
      raise exception 'CMV3_SYNC_RLS_MISSING: %', v_table;
    end if;
    if has_table_privilege('authenticated','public.' || v_table,'SELECT')
       or has_table_privilege('anon','public.' || v_table,'SELECT') then
      raise exception 'CMV3_SYNC_BROWSER_TABLE_ACCESS_EXPOSED: %', v_table;
    end if;
  end loop;

  if to_regprocedure('public.sync_clinical_measurements_bulk_v3(uuid,uuid,uuid,text,jsonb)') is null then
    raise exception 'CMV3_SYNC_RPC_MISSING';
  end if;

  if has_function_privilege('authenticated','public.sync_clinical_measurements_bulk_v3(uuid,uuid,uuid,text,jsonb)','EXECUTE')
     or has_function_privilege('anon','public.sync_clinical_measurements_bulk_v3(uuid,uuid,uuid,text,jsonb)','EXECUTE') then
    raise exception 'CMV3_SYNC_BROWSER_RPC_EXPOSED';
  end if;

  if not has_function_privilege('service_role','public.sync_clinical_measurements_bulk_v3(uuid,uuid,uuid,text,jsonb)','EXECUTE') then
    raise exception 'CMV3_SYNC_SERVICE_ROLE_RPC_MISSING';
  end if;

  if to_regprocedure('public.ingest_clinical_measurement_primitives_bulk_v3(uuid,jsonb)') is null
     or to_regprocedure('public.ingest_clinical_aba_trials_bulk_v3(uuid,jsonb)') is null
     or to_regprocedure('public.ingest_clinical_aba_task_runs_bulk_v3(uuid,jsonb)') is null then
    raise exception 'CMV3_SYNC_SET_BASED_HANDLER_MISSING';
  end if;
end;
$assertions$;

rollback;
