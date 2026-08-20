-- Structural regression test for Clinical Measurement Engine V3 projection/read models.
begin;

do $assertions$
declare
  v_table text;
begin
  foreach v_table in array array[
    'clinical_measurement_projection_queue_v3',
    'clinical_measurement_session_count_summaries_v3',
    'clinical_measurement_session_rate_summaries_v3',
    'clinical_measurement_session_proportion_summaries_v3',
    'clinical_measurement_session_temporal_summaries_v3',
    'clinical_measurement_session_continuous_summaries_v3',
    'clinical_measurement_session_interval_summaries_v3',
    'clinical_measurement_session_ordinal_summaries_v3',
    'clinical_measurement_session_categorical_summaries_v3',
    'clinical_measurement_session_task_analysis_summaries_v3',
    'clinical_measurement_session_projection_heads_v3',
    'clinical_measurement_session_projection_revisions_v3'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'CMV3_PROJECTION_TABLE_MISSING: %', v_table;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=v_table and c.relrowsecurity
    ) then
      raise exception 'CMV3_PROJECTION_RLS_MISSING: %', v_table;
    end if;
    if has_table_privilege('authenticated','public.' || v_table,'SELECT')
       or has_table_privilege('anon','public.' || v_table,'SELECT') then
      raise exception 'CMV3_PROJECTION_BROWSER_ACCESS_EXPOSED: %', v_table;
    end if;
  end loop;

  if to_regprocedure('public.recompute_clinical_measurement_projection_batch_v3(uuid[],text)') is null
     or to_regprocedure('public.process_clinical_measurement_projection_queue_v3(integer)') is null
     or to_regprocedure('public.rebuild_clinical_measurement_projection_v3(uuid[])') is null then
    raise exception 'CMV3_PROJECTION_FUNCTION_MISSING';
  end if;

  if has_function_privilege('authenticated','public.process_clinical_measurement_projection_queue_v3(integer)','EXECUTE')
     or has_function_privilege('anon','public.process_clinical_measurement_projection_queue_v3(integer)','EXECUTE') then
    raise exception 'CMV3_PROJECTION_BROWSER_RPC_EXPOSED';
  end if;

  if not has_function_privilege('service_role','public.process_clinical_measurement_projection_queue_v3(integer)','EXECUTE') then
    raise exception 'CMV3_PROJECTION_SERVICE_ROLE_RPC_MISSING';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid='public.clinical_measurement_raw_events_v3'::regclass
      and tgname='enqueue_cmv3_projection_raw' and not tgisinternal
  ) then
    raise exception 'CMV3_PROJECTION_RAW_ENQUEUE_TRIGGER_MISSING';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid='public.clinical_measurement_sessions_v3'::regclass
      and tgname='enqueue_cmv3_projection_session_finalized' and not tgisinternal
  ) then
    raise exception 'CMV3_PROJECTION_FINALIZATION_ENQUEUE_TRIGGER_MISSING';
  end if;
end;
$assertions$;

rollback;
