-- Structural regression for Migration G. Safe to run after migration in staging.
begin;

do $test$
declare
  v_count integer;
begin
  select count(*) into v_count from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname in (
    'clinical_measurement_criterion_epochs_v3','clinical_measurement_evidence_revisions_v3',
    'clinical_measurement_clinical_decision_events_v3','clinical_measurement_target_states_v3');
  if v_count <> 4 then raise exception 'CMV3_G_TABLE_COUNT_INVALID:%',v_count; end if;

  if not exists(select 1 from pg_constraint where conrelid='public.clinical_measurement_criterion_epochs_v3'::regclass and conname='cmv3_criterion_epoch_no_overlap') then
    raise exception 'CMV3_G_CRITERION_OVERLAP_GUARD_MISSING';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.clinical_measurement_evidence_revisions_v3'::regclass and tgname='cmv3_append_only_guard' and not tgisinternal) then
    raise exception 'CMV3_G_EVIDENCE_APPEND_ONLY_MISSING';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.clinical_measurement_clinical_decision_events_v3'::regclass and tgname='cmv3_validate_decision_actor' and not tgisinternal) then
    raise exception 'CMV3_G_ACTOR_SCOPE_GUARD_MISSING';
  end if;
end;$test$;

rollback;
