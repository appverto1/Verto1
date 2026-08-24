-- ABA V3 — bounded production health snapshot.
--
-- Read-only observability surface for the production Default-On baseline.
-- It does not mutate rollout, sessions, bindings, clinical facts, projections or
-- quarantine state. Browser roles cannot execute it directly.

begin;

create or replace function public.get_aba_v3_production_health_v1(
  p_organization_id uuid default null,
  p_window_days integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_checked_at timestamptz := clock_timestamp();
  v_from timestamptz;

  v_binding_total integer := 0;
  v_binding_v3 integer := 0;
  v_binding_legacy integer := 0;
  v_binding_emergency integer := 0;
  v_fallback_reasons jsonb := '{}'::jsonb;

  v_quarantine_open integer := 0;
  v_quarantine_ready integer := 0;
  v_quarantine_oldest_seconds bigint;

  v_projection_pending integer := 0;
  v_projection_processing integer := 0;
  v_projection_failed integer := 0;
  v_projection_oldest_seconds bigint;

  v_positive_overrides integer := 0;
  v_kill_switches integer := 0;
  v_inactive_overrides integer := 0;

  v_mixed_authority integer := 0;
  v_security jsonb := 'null'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_health_state text := 'HEALTHY';
  v_gate text := 'PASS_ABA_V3_PRODUCTION_HEALTH';
begin
  if p_window_days is null or p_window_days < 1 or p_window_days > 30 then
    raise exception 'ABA_V3_PRODUCTION_HEALTH_WINDOW_INVALID';
  end if;

  if p_organization_id is not null and not exists (
    select 1 from public.clinics clinic where clinic.id = p_organization_id
  ) then
    raise exception 'ABA_V3_PRODUCTION_HEALTH_ORGANIZATION_INVALID';
  end if;

  v_from := v_checked_at - make_interval(days => p_window_days);

  select
    count(*)::integer,
    count(*) filter (where binding.measurement_model_version = 'V3')::integer,
    count(*) filter (where binding.measurement_model_version = 'LEGACY_V2')::integer,
    count(*) filter (where binding.measurement_model_version = 'EMERGENCY_LEGACY_BRIDGE')::integer
  into v_binding_total, v_binding_v3, v_binding_legacy, v_binding_emergency
  from public.aba_session_target_measurement_bindings binding
  where binding.bound_at >= v_from
    and (p_organization_id is null or binding.organization_id = p_organization_id);

  select coalesce(jsonb_object_agg(reason_count.binding_reason, reason_count.total order by reason_count.binding_reason), '{}'::jsonb)
  into v_fallback_reasons
  from (
    select binding.binding_reason, count(*)::integer as total
    from public.aba_session_target_measurement_bindings binding
    where binding.bound_at >= v_from
      and binding.measurement_model_version <> 'V3'
      and (p_organization_id is null or binding.organization_id = p_organization_id)
    group by binding.binding_reason
  ) reason_count;

  select
    count(*) filter (where quarantine.status = 'OPEN')::integer,
    count(*) filter (where quarantine.status = 'READY_FOR_RETRY')::integer,
    case
      when min(quarantine.first_seen_at) filter (where quarantine.status in ('OPEN','READY_FOR_RETRY')) is null then null
      else greatest(
        0,
        extract(epoch from (
          v_checked_at - min(quarantine.first_seen_at) filter (where quarantine.status in ('OPEN','READY_FOR_RETRY'))
        ))::bigint
      )
    end
  into v_quarantine_open, v_quarantine_ready, v_quarantine_oldest_seconds
  from public.aba_sync_quarantine_v3 quarantine
  where p_organization_id is null or quarantine.organization_id = p_organization_id;

  select
    count(*) filter (where queue.status = 'PENDING')::integer,
    count(*) filter (where queue.status = 'PROCESSING')::integer,
    count(*) filter (where queue.status = 'FAILED')::integer,
    case
      when min(queue.enqueued_at) filter (where queue.status in ('PENDING','PROCESSING','FAILED')) is null then null
      else greatest(
        0,
        extract(epoch from (
          v_checked_at - min(queue.enqueued_at) filter (where queue.status in ('PENDING','PROCESSING','FAILED'))
        ))::bigint
      )
    end
  into v_projection_pending, v_projection_processing, v_projection_failed, v_projection_oldest_seconds
  from public.clinical_measurement_projection_queue_v3 queue
  where p_organization_id is null or queue.organization_id = p_organization_id;

  select
    count(*) filter (
      where coalesce(state.override_active, true) is true
        and state.allow_new_v3_sessions is true
        and state.accept_v3_sync is true
    )::integer,
    count(*) filter (
      where coalesce(state.override_active, true) is true
        and (state.allow_new_v3_sessions is false or state.accept_v3_sync is false)
    )::integer,
    count(*) filter (where coalesce(state.override_active, true) is false)::integer
  into v_positive_overrides, v_kill_switches, v_inactive_overrides
  from public.aba_measurement_rollout_states_v3 state
  where p_organization_id is null or state.organization_id = p_organization_id;

  select count(*)::integer
  into v_mixed_authority
  from (
    select distinct trial.organization_id, trial.session_id, trial.target_id
    from public.aba_trials_v3 trial
    where trial.occurred_at >= v_from
      and (p_organization_id is null or trial.organization_id = p_organization_id)
      and exists (
        select 1
        from public.aba_trials legacy
        where legacy.clinic_id = trial.organization_id::text
          and legacy.session_id = trial.session_id
          and legacy.target_id = trial.target_id
      )
  ) mixed;

  if to_regprocedure('public.get_clinical_measurement_v3_security_preflight()') is not null then
    execute 'select public.get_clinical_measurement_v3_security_preflight()' into v_security;
  else
    v_warnings := v_warnings || jsonb_build_array('SECURITY_PREFLIGHT_UNAVAILABLE');
  end if;

  if v_positive_overrides > 0 then
    v_warnings := v_warnings || jsonb_build_array('ACTIVE_POSITIVE_OVERRIDES_PRESENT');
  end if;
  if v_kill_switches > 0 then
    v_warnings := v_warnings || jsonb_build_array('ACTIVE_KILL_SWITCHES_PRESENT');
  end if;
  if (v_quarantine_open + v_quarantine_ready) > 0 then
    v_warnings := v_warnings || jsonb_build_array('UNRESOLVED_SYNC_QUARANTINE');
  end if;
  if v_projection_failed > 0 then
    v_warnings := v_warnings || jsonb_build_array('FAILED_PROJECTION_QUEUE_ITEMS');
  end if;

  if coalesce((v_security->>'ok')::boolean, false) is false then
    v_health_state := 'BLOCKED';
    v_gate := 'BLOCKED_ABA_V3_SECURITY_PREFLIGHT';
  elsif v_mixed_authority > 0 then
    v_health_state := 'BLOCKED';
    v_gate := 'BLOCKED_ABA_V3_MIXED_AUTHORITY';
  elsif v_projection_failed > 0 then
    v_health_state := 'DEGRADED';
    v_gate := 'DEGRADED_ABA_V3_PROJECTION_FAILURES';
  elsif (v_quarantine_open + v_quarantine_ready) > 0 then
    v_health_state := 'DEGRADED';
    v_gate := 'DEGRADED_ABA_V3_SYNC_QUARANTINE';
  end if;

  return jsonb_build_object(
    'gate', v_gate,
    'health_state', v_health_state,
    'writes', false,
    'checked_at', v_checked_at,
    'scope', jsonb_build_object(
      'organization_id', p_organization_id,
      'window_days', p_window_days,
      'from', v_from,
      'to', v_checked_at
    ),
    'bindings', jsonb_build_object(
      'total_recent', v_binding_total,
      'v3_recent', v_binding_v3,
      'legacy_v2_recent', v_binding_legacy,
      'emergency_bridge_recent', v_binding_emergency,
      'v3_ratio_percent', case
        when v_binding_total = 0 then null
        else round((100.0 * v_binding_v3::numeric) / v_binding_total::numeric, 2)
      end,
      'fallback_reasons', v_fallback_reasons
    ),
    'sync_quarantine', jsonb_build_object(
      'open', v_quarantine_open,
      'ready_for_retry', v_quarantine_ready,
      'oldest_unresolved_age_seconds', v_quarantine_oldest_seconds
    ),
    'projection_queue', jsonb_build_object(
      'pending', v_projection_pending,
      'processing', v_projection_processing,
      'failed', v_projection_failed,
      'oldest_non_done_age_seconds', v_projection_oldest_seconds
    ),
    'control_plane', jsonb_build_object(
      'active_positive_overrides', v_positive_overrides,
      'active_kill_switches', v_kill_switches,
      'inactive_historical_overrides', v_inactive_overrides,
      'normal_default_on_mode', v_positive_overrides = 0
    ),
    'integrity', jsonb_build_object(
      'mixed_authority_session_targets_recent', v_mixed_authority,
      'mixed_authority_expected', 0
    ),
    'security_preflight', v_security,
    'warnings', v_warnings
  );
end;
$function$;

revoke all on function public.get_aba_v3_production_health_v1(uuid,integer) from public, anon, authenticated;
grant execute on function public.get_aba_v3_production_health_v1(uuid,integer) to service_role;

comment on function public.get_aba_v3_production_health_v1(uuid,integer) is
  'Read-only bounded ABA/CMV3 production health snapshot. Service-role only; no clinical or rollout writes.';

commit;
