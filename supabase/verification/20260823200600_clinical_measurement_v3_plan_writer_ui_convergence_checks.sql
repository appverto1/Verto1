-- READ ONLY — Bloco 5 V3 Plan/PTS writer convergence check.
with writer as (
  select pg_get_functiondef('public.write_clinical_plan_measurement_v3(uuid,uuid,uuid,text,text,uuid,text,uuid,text,text,text,text,text,text,timestamp with time zone,jsonb)'::regprocedure) as body
), reader as (
  select pg_get_functiondef('public.read_clinical_plan_outcomes_v3(uuid,uuid,date,date,uuid[],uuid[],integer)'::regprocedure) as body
), security as (
  select
    not coalesce(has_function_privilege('anon','public.write_clinical_plan_measurement_v3(uuid,uuid,uuid,text,text,uuid,text,uuid,text,text,text,text,text,text,timestamp with time zone,jsonb)','EXECUTE'),false)
      and not coalesce(has_function_privilege('authenticated','public.write_clinical_plan_measurement_v3(uuid,uuid,uuid,text,text,uuid,text,uuid,text,text,text,text,text,text,timestamp with time zone,jsonb)','EXECUTE'),false)
      and coalesce(has_function_privilege('service_role','public.write_clinical_plan_measurement_v3(uuid,uuid,uuid,text,text,uuid,text,uuid,text,text,text,text,text,text,timestamp with time zone,jsonb)','EXECUTE'),false) as ok
)
select jsonb_build_object(
  'gate', case
    when position('PROPORTION' in writer.body) = 0 then 'BLOCKED_PLAN_WRITER_PROPORTION_MISSING'
    when position('numerator_category_keys' in writer.body) = 0 or position('denominator_category_keys' in writer.body) = 0 then 'BLOCKED_PLAN_WRITER_PROPORTION_CONFIG_MISSING'
    when position('clinical_measurement_session_proportion_summaries_v3' in reader.body) = 0 then 'BLOCKED_PLAN_READER_PROPORTION_MISSING'
    when not security.ok then 'BLOCKED_PLAN_WRITER_SECURITY'
    else 'PASS_CMV3_PLAN_WRITER_UI_CONVERGENCE'
  end,
  'writer_supports_proportion', position('PROPORTION' in writer.body) > 0,
  'reader_supports_proportion', position('clinical_measurement_session_proportion_summaries_v3' in reader.body) > 0,
  'browser_execute_revoked', security.ok,
  'writes', false
) as clinical_measurement_v3_plan_writer_ui_convergence_check
from writer, reader, security;
