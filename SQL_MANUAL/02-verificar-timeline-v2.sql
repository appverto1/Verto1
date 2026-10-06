-- Somente leitura. Executar após 01-restaurar-timeline-v2.sql.
select
  to_regclass('public.patient_evolution_timeline_entitlements') is not null as entitlement_presente,
  to_regclass('public.clinic_evolution_timeline_addon_billing') is not null as addon_presente,
  to_regprocedure('public.create_patient_evolution_timeline_item_v2(uuid,uuid,date,text,text,uuid,uuid)') is not null as criacao_v2_presente,
  to_regprocedure('public.reserve_patient_evolution_timeline_plus_v1(uuid,uuid,uuid)') is not null as reserva_presente,
  to_regprocedure('public.finalize_patient_evolution_timeline_plus_v1(uuid,uuid,uuid,boolean,text,text)') is not null as finalizacao_presente;

select relname, relrowsecurity as rls_ativa
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('patient_evolution_timeline_entitlements', 'clinic_evolution_timeline_addon_billing');

select
  has_function_privilege('service_role', 'public.create_patient_evolution_timeline_item_v2(uuid,uuid,date,text,text,uuid,uuid)', 'EXECUTE') as servidor_pode_criar,
  not has_function_privilege('anon', 'public.create_patient_evolution_timeline_item_v2(uuid,uuid,date,text,text,uuid,uuid)', 'EXECUTE') as anon_bloqueado,
  not has_function_privilege('authenticated', 'public.create_patient_evolution_timeline_item_v2(uuid,uuid,date,text,text,uuid,uuid)', 'EXECUTE') as cliente_direto_bloqueado;
