-- Structural regression test for ABA Measurement V3 PR4.
-- Safe after PR1 + PR2 + PR3 + PR4. Performs no clinical writes.
do $test$
begin
  if to_regclass('public.aba_session_target_summaries_v3') is null then
    raise exception 'PR4 summary projection table missing';
  end if;

  if to_regclass('public.aba_effective_trials_v3') is null then
    raise exception 'PR4 effective trial projection missing';
  end if;

  if to_regprocedure('public.recompute_aba_session_target_summary_v3(uuid,uuid,text,text,uuid)') is null
     or to_regprocedure('public.verify_aba_session_target_summary_v3(uuid,uuid,text,text,uuid)') is null
     or to_regprocedure('public.record_aba_trial_correction_v3(uuid,uuid,uuid,text,jsonb,text,text,uuid,jsonb)') is null then
    raise exception 'PR4 summary RPCs missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.aba_session_target_summaries_v3'::regclass
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) ilike '%session_id%target_id%target_phase_assignment_id%'
  ) then
    raise exception 'PR4 summary granularity unique missing';
  end if;


  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.aba_trials_v3'::regclass
      and t.tgname = 'validate_aba_trial_v3_has_steps_at_commit'
      and not t.tgisinternal
  ) then
    raise exception 'PR4 deferred orphan trial guard missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.aba_trial_steps_v3'::regclass
      and t.tgname = 'reconcile_aba_v3_summaries_after_steps_insert'
      and not t.tgisinternal
  ) then
    raise exception 'PR4 statement-level raw reconciliation trigger missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.aba_trial_revisions_v3'::regclass
      and t.tgname = 'reconcile_aba_v3_summary_after_revision_insert'
      and not t.tgisinternal
  ) then
    raise exception 'PR4 revision reconciliation trigger missing';
  end if;

  if has_table_privilege('authenticated', 'public.aba_session_target_summaries_v3', 'SELECT') then
    raise exception 'PR4 summaries must remain browser fail-closed';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.recompute_aba_session_target_summary_v3(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'PR4 recompute must remain browser fail-closed';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.verify_aba_session_target_summary_v3(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'PR4 service_role verify EXECUTE missing';
  end if;

  if exists (
    select 1
    from public.aba_measurement_rollout_states_v3 state
    where state.allow_new_v3_sessions = true
  ) then
    raise exception 'PR4 must not enable new V3 sessions';
  end if;
end;
$test$;
