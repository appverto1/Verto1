-- Read-only verification for ABA Measurement V3 PR2.
select
  to_regclass('public.aba_session_target_measurement_bindings') is not null
    as bindings_ready,
  to_regclass('public.aba_emergency_legacy_bridges_v3') is not null
    as emergency_bridge_ready,
  to_regclass('public.aba_emergency_legacy_bridge_events_v3') is not null
    as emergency_bridge_audit_ready,
  to_regprocedure(
    'public.resolve_aba_session_target_measurement_binding_v1(uuid,uuid,text,text,uuid)'
  ) is not null as binding_resolver_ready,
  to_regprocedure(
    'public.resolve_aba_measurement_rollout_snapshot_v3(uuid,uuid,text,text,timestamptz)'
  ) is not null as historical_rollout_resolver_ready,
  has_function_privilege(
    'service_role',
    'public.resolve_aba_session_target_measurement_binding_v1(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ) as service_role_execute_ready,
  not has_function_privilege(
    'authenticated',
    'public.resolve_aba_session_target_measurement_binding_v1(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ) as browser_execute_blocked,
  not has_table_privilege(
    'authenticated',
    'public.aba_emergency_legacy_bridges_v3',
    'SELECT'
  ) as emergency_bridge_browser_blocked,
  not exists (
    select 1
    from public.aba_measurement_rollout_states_v3 state
    where state.allow_new_v3_sessions = true
  ) as no_new_v3_sessions_enabled,
  not exists (
    select 1
    from public.aba_measurement_rollout_states_v3 state
    where state.accept_v3_sync = true
  ) as no_v3_sync_enabled;
