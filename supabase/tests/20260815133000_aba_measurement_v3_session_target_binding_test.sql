-- Structural regression test for ABA Measurement V3 PR2.
-- Safe to run after the PR1 + PR2 migrations; it performs no clinical writes.
do $test$
begin
  if to_regprocedure(
    'public.resolve_aba_session_target_measurement_binding_v1(uuid,uuid,text,text,uuid)'
  ) is null then
    raise exception 'PR2 binding resolver missing';
  end if;

  if to_regprocedure(
    'public.resolve_aba_measurement_rollout_snapshot_v3(uuid,uuid,text,text,timestamptz)'
  ) is null then
    raise exception 'PR2 historical rollout resolver missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = 'public.aba_session_target_measurement_bindings'::regclass
      and attribute.attname = 'decision_at'
      and not attribute.attisdropped
      and attribute.attnotnull
  ) then
    raise exception 'PR2 binding decision_at must be NOT NULL';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.aba_session_target_measurement_bindings'::regclass
      and constraint_row.contype = 'u'
      and pg_get_constraintdef(constraint_row.oid) ilike '%session_id%target_id%'
  ) then
    raise exception 'PR2 immutable binding unique(session_id,target_id) missing';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.resolve_aba_session_target_measurement_binding_v1(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'PR2 resolver must remain browser fail-closed';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.resolve_aba_session_target_measurement_binding_v1(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'PR2 resolver service_role EXECUTE missing';
  end if;

  if exists (
    select 1
    from public.aba_measurement_rollout_states_v3 state
    where state.allow_new_v3_sessions = true
       or state.accept_v3_sync = true
  ) then
    raise exception 'PR2 must not enable V3 rollout gates';
  end if;
end;
$test$;
