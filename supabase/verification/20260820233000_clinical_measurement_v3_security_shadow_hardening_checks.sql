-- Clinical Measurement Engine V3 - Migration I verification.

select public.get_clinical_measurement_v3_security_preflight() as security_preflight;

select
  to_regprocedure('public.get_clinical_measurement_v3_shadow_comparison(uuid,uuid,uuid,uuid,date,date)') is not null as shadow_comparison_ready,
  not pg_catalog.has_function_privilege('anon','public.get_clinical_measurement_v3_shadow_comparison(uuid,uuid,uuid,uuid,date,date)','EXECUTE') as shadow_hidden_from_anon,
  not pg_catalog.has_function_privilege('authenticated','public.get_clinical_measurement_v3_shadow_comparison(uuid,uuid,uuid,uuid,date,date)','EXECUTE') as shadow_hidden_from_authenticated,
  pg_catalog.has_function_privilege('service_role','public.get_clinical_measurement_v3_shadow_comparison(uuid,uuid,uuid,uuid,date,date)','EXECUTE') as shadow_service_role_ready;

select
  not pg_catalog.has_function_privilege('authenticated','public.resolve_clinical_measurement_payload_kind_v3(uuid)','EXECUTE') as payload_kind_helper_closed,
  not pg_catalog.has_function_privilege('authenticated','public.publish_clinical_aba_prompt_hierarchy_version_v3(uuid)','EXECUTE') as prompt_publish_closed,
  not pg_catalog.has_function_privilege('authenticated','public.publish_clinical_aba_chaining_policy_version_v3(uuid)','EXECUTE') as chaining_publish_closed;

-- Optional targeted shadow call (replace UUIDs only after choosing a mapped ABA target):
-- select public.get_clinical_measurement_v3_shadow_comparison(
--   '<clinic_uuid>'::uuid,
--   '<patient_uuid>'::uuid,
--   '<cmv3_target_uuid>'::uuid,
--   '<cmv3_definition_uuid>'::uuid,
--   current_date - 90,
--   current_date
-- );

-- Candidate mapped ABA targets for a real shadow run. This is read-only and may
-- legitimately return zero rows until Universal V3 has collected comparable data.
select
  t.organization_id,
  t.patient_id,
  t.id as cmv3_target_id,
  t.aba_target_id,
  d.id as cmv3_definition_id,
  d.semantic_family,
  count(distinct cms.aba_session_id) filter (where ps.expectation_id is not null) as universal_v3_session_count,
  count(distinct av3.session_id) as canonical_aba_v3_session_count
from public.clinical_measurement_targets_v3 t
join public.clinical_measurement_definitions_v3 d
  on d.organization_id=t.organization_id and d.patient_id=t.patient_id and d.target_id=t.id
left join public.clinical_measurement_session_proportion_summaries_v3 ps
  on ps.organization_id=t.organization_id and ps.patient_id=t.patient_id and ps.target_id=t.id
left join public.clinical_measurement_sessions_v3 cms
  on cms.id=ps.session_id and cms.source_kind='ABA_SESSION'
left join public.aba_session_target_summaries_v3 av3
  on av3.organization_id=t.organization_id and av3.patient_id=t.patient_id and av3.target_id=t.aba_target_id
where t.source_kind='ABA_TARGET'
  and d.semantic_family='PROPORTION'
group by t.organization_id,t.patient_id,t.id,t.aba_target_id,d.id,d.semantic_family
order by universal_v3_session_count desc, canonical_aba_v3_session_count desc
limit 20;
