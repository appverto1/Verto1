-- Structural regression test for ABA Measurement V3 PR3.
-- Safe after PR1 + PR2 + PR3. Performs no clinical writes.
do $test$
begin
  if to_regclass('public.aba_trials_v3') is null
     or to_regclass('public.aba_trial_steps_v3') is null
     or to_regclass('public.aba_sync_quarantine_v3') is null then
    raise exception 'PR3 persistence tables missing';
  end if;

  if to_regprocedure('public.record_aba_trials_bulk_v3(uuid,uuid,jsonb,uuid)') is null then
    raise exception 'PR3 bulk ingest RPC missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.aba_trials_v3'::regclass
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) ilike '%organization_id%client_event_id%'
  ) then
    raise exception 'PR3 trial idempotency unique missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.aba_trial_steps_v3'::regclass
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) ilike '%trial_id%sequence_no%'
  ) then
    raise exception 'PR3 step sequence unique missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_indexes idx
    where idx.schemaname = 'public'
      and idx.tablename = 'aba_trial_steps_v3'
      and idx.indexname = 'ux_aba_trial_steps_v3_primary_independent'
      and idx.indexdef ilike '%PRIMARY_INDEPENDENT%'
  ) then
    raise exception 'PR3 one-primary-independent invariant missing';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.record_aba_trials_bulk_v3(uuid,uuid,jsonb,uuid)',
    'EXECUTE'
  ) then
    raise exception 'PR3 bulk ingest must remain browser fail-closed';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.record_aba_trials_bulk_v3(uuid,uuid,jsonb,uuid)',
    'EXECUTE'
  ) then
    raise exception 'PR3 service_role bulk EXECUTE missing';
  end if;

  if exists (
    select 1
    from public.aba_measurement_rollout_states_v3 state
    where state.allow_new_v3_sessions = true
  ) then
    raise exception 'PR3 must not enable new V3 sessions';
  end if;
end;
$test$;
