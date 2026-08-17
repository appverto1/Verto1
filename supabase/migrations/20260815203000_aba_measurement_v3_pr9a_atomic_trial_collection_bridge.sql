-- ABA Measurement V3 - PR9A atomic trial collection bridge.
-- Additive only. It composes existing PR3 trial persistence with PR6 maintenance
-- probe lifecycle so a maintenance trial can never commit without its probe link.
-- No Legacy V2 table, prompt score, rollout state or historical row is changed.

begin;

create or replace function public.record_aba_trial_action_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_trial jsonb,
  p_probe_key text default null,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_result jsonb;
  v_trial_id uuid;
  v_trial_type text := upper(trim(coalesce(p_trial ->> 'trial_type', '')));
  v_session_id text := trim(coalesce(p_trial ->> 'session_id', ''));
  v_target_id text := trim(coalesce(p_trial ->> 'target_id', ''));
  v_target_type text;
  v_binding public.aba_session_target_measurement_bindings%rowtype;
  v_effective_trial jsonb;
  v_probe public.aba_maintenance_probes_v3%rowtype;
  v_link public.aba_maintenance_probe_trials_v3%rowtype;
begin
  if p_actor_id is null then
    raise exception 'ABA_V3_COLLECTION_ACTOR_REQUIRED';
  end if;

  if jsonb_typeof(p_trial) is distinct from 'object' then
    raise exception 'ABA_V3_COLLECTION_TRIAL_OBJECT_REQUIRED';
  end if;

  if nullif(v_session_id, '') is null or nullif(v_target_id, '') is null then
    raise exception 'ABA_V3_COLLECTION_SCOPE_REQUIRED';
  end if;

  if p_probe_key is not null and nullif(trim(p_probe_key), '') is null then
    raise exception 'ABA_V3_PROBE_KEY_INVALID';
  end if;

  if nullif(trim(coalesce(p_probe_key, '')), '') is not null and v_trial_type <> 'MAINTENANCE_PROBE' then
    raise exception 'ABA_V3_PROBE_KEY_ONLY_FOR_MAINTENANCE';
  end if;

  if v_trial_type = 'MAINTENANCE_PROBE' and nullif(trim(coalesce(p_probe_key, '')), '') is null then
    raise exception 'ABA_V3_MAINTENANCE_PROBE_KEY_REQUIRED';
  end if;

  -- PR9A intentionally exposes only opportunity/trial families. Behavior,
  -- interval and task-analysis collection need their own canonical V3 UI/ingest
  -- boundaries and must never fall through to Legacy V2 by accident.
  select lower(trim(target.target_type))
  into v_target_type
  from public.aba_targets target
  where target.id = v_target_id
    and target.patient_id = p_patient_id
    and target.clinic_id = p_organization_id::text;

  if not found then
    raise exception 'ABA_V3_COLLECTION_SCOPE_INVALID';
  end if;

  if v_target_type not in ('dtt', 'net', 'probe') then
    raise exception 'ABA_V3_UI_MEASUREMENT_NOT_READY';
  end if;

  -- Resolve the immutable binding inside the same database transaction as the
  -- write. The browser/Node never owns definition or phase IDs. This keeps the
  -- Node write path to one RPC while PR3 still revalidates the binding/version
  -- during canonical ingestion.
  v_binding := public.resolve_aba_session_target_measurement_binding_v1(
    p_organization_id,
    p_patient_id,
    v_session_id,
    v_target_id,
    p_actor_id
  );

  if v_binding.measurement_model_version <> 'V3' then
    raise exception 'ABA_V3_TARGET_NOT_V3';
  end if;

  if v_binding.collection_definition_version_id is null
     or v_binding.target_phase_assignment_id is null then
    raise exception 'ABA_V3_CONFIGURATION_INCOMPLETE';
  end if;

  v_effective_trial := (
    p_trial
      - 'collection_definition_version_id'
      - 'target_phase_assignment_id'
  ) || jsonb_build_object(
    'collection_definition_version_id', v_binding.collection_definition_version_id,
    'target_phase_assignment_id', v_binding.target_phase_assignment_id
  );

  -- record_aba_trial_v3 performs the canonical scope/version/phase/idempotency
  -- validation from PR3 using the immutable IDs resolved above.
  v_result := public.record_aba_trial_v3(
    p_organization_id,
    p_patient_id,
    v_effective_trial,
    p_actor_id
  );

  if coalesce((v_result ->> 'quarantined')::integer, 0) > 0 then
    -- Do not create a probe for an event that was not accepted. Keeping the
    -- quarantine result is intentional and lets the client surface the reason.
    return v_result;
  end if;

  select nullif(item ->> 'trial_id', '')::uuid
  into v_trial_id
  from jsonb_array_elements(coalesce(v_result -> 'accepted', '[]'::jsonb)) item
  limit 1;

  if v_trial_id is null then
    raise exception 'ABA_V3_COLLECTION_ACCEPTED_TRIAL_MISSING';
  end if;

  if v_trial_type = 'MAINTENANCE_PROBE' then
    v_probe := public.open_aba_maintenance_probe_v3(
      p_organization_id,
      p_patient_id,
      v_session_id,
      v_target_id,
      trim(p_probe_key),
      p_actor_id,
      coalesce(public.aba_try_timestamptz_v3(p_trial ->> 'occurred_at'), now())
    );

    -- Replays may arrive after session finalization. If this exact trial was
    -- already linked while the probe was OPEN, treat the replay as idempotent
    -- instead of asking PR6 to reopen or mutate a closed clinical probe.
    select * into v_link
    from public.aba_maintenance_probe_trials_v3 link
    where link.probe_id = v_probe.id
      and link.trial_id = v_trial_id;

    if not found then
      v_link := public.link_aba_trial_to_maintenance_probe_v3(
        v_probe.id,
        v_trial_id,
        p_actor_id
      );
    end if;

    v_result := v_result || jsonb_build_object(
      'maintenance_probe_id', v_probe.id,
      'maintenance_probe_linked', v_link.trial_id = v_trial_id
    );
  end if;

  return v_result;
end;
$function$;

revoke all on function public.record_aba_trial_action_v3(uuid,uuid,jsonb,text,uuid)
  from public, anon, authenticated;
grant execute on function public.record_aba_trial_action_v3(uuid,uuid,jsonb,text,uuid)
  to service_role;

-- PR9A does not create or mutate rollout rows. New V3 sessions remain controlled
-- exclusively by the rollout state created in PR1/PR2.

commit;

select
  to_regprocedure('public.record_aba_trial_action_v3(uuid,uuid,jsonb,text,uuid)') is not null as trial_action_rpc_ready,
  to_regprocedure('public.resolve_aba_session_target_measurement_binding_v1(uuid,uuid,text,text,uuid)') is not null as binding_resolver_ready,
  to_regprocedure('public.record_aba_trial_v3(uuid,uuid,jsonb,uuid)') is not null as trial_engine_ready,
  to_regprocedure('public.open_aba_maintenance_probe_v3(uuid,uuid,text,text,text,uuid,timestamp with time zone)') is not null as maintenance_probe_ready,
  to_regprocedure('public.complete_aba_session_v3(uuid,uuid,uuid,text,uuid,text,timestamp with time zone,text,jsonb,text,text)') is not null as hybrid_completion_ready,
  not exists (
    select 1 from public.aba_measurement_rollout_states_v3
    where allow_new_v3_sessions
  ) as no_new_v3_sessions_enabled;
