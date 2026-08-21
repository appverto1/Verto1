-- Migration G verification: fail loudly if the semantic/decision foundation is incomplete.
do $verify$
declare missing text[];
begin
  select array_agg(name) into missing from (values
    ('clinical_measurement_criterion_epochs_v3'),
    ('clinical_measurement_evidence_revisions_v3'),
    ('clinical_measurement_clinical_decision_events_v3'),
    ('clinical_measurement_target_states_v3')
  ) v(name) where to_regclass('public.'||name) is null;
  if missing is not null then raise exception 'CMV3_G_MISSING_TABLES:%',missing; end if;
  if to_regprocedure('public.evaluate_clinical_measurement_criterion_v3(uuid)') is null then raise exception 'CMV3_G_EVALUATOR_MISSING'; end if;
  if to_regprocedure('public.refresh_clinical_measurement_target_state_v3(uuid)') is null then
    raise exception 'CMV3_G_REFRESH_FUNCTION_MISSING';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.clinical_measurement_clinical_decision_events_v3'::regclass and tgname='cmv3_append_only_guard' and not tgisinternal) then
    raise exception 'CMV3_G_DECISION_APPEND_ONLY_GUARD_MISSING';
  end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='clinical_measurement_target_states_v3' and c.relrowsecurity) then
    raise exception 'CMV3_G_RLS_MISSING';
  end if;
end;$verify$;

select 'CMV3_MIGRATION_G_OK' as verification_result;
