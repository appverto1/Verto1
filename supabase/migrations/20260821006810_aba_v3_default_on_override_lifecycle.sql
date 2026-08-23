-- ABA V3 — explicit override lifecycle for the default-on control plane.
--
-- Goal:
--   * DEFAULT/INHERIT is represented by an inactive override, not by false;
--   * false remains an explicit kill switch;
--   * positive canary rows can be retired without DELETE and without losing
--     append-only rollout event history;
--   * old session decisions remain reproducible as-of session.started_at;
--   * explicit writers reactivate an override when a new admin decision is made.
--
-- No clinical facts, session bindings, V2 history or current rollout booleans are
-- changed by installing this migration. Existing rows start override_active=true.

begin;

alter table public.aba_measurement_rollout_states_v3
  add column if not exists override_active boolean not null default true;

comment on column public.aba_measurement_rollout_states_v3.override_active is
  'true = this persisted scope is an explicit override; false = retain audit lineage but inherit V3_DEFAULT_ON policy';

-- The identity/timeline guard now treats activation/retirement of an override as
-- a real state transition, so it receives a fresh effective_from and can be
-- resolved historically from the append-only event log.
create or replace function public.guard_aba_measurement_rollout_identity_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'INSERT' then
    if new.effective_from < clock_timestamp() - interval '2 seconds' then
      raise exception 'ABA_V3_ROLLOUT_BACKDATE_FORBIDDEN';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'ABA_V3_ROLLOUT_STATE_DELETE_FORBIDDEN';
  end if;

  if old.id is distinct from new.id
     or old.organization_id is distinct from new.organization_id
     or old.scope_type is distinct from new.scope_type
     or old.patient_id is distinct from new.patient_id
     or old.program_id is distinct from new.program_id
     or old.target_id is distinct from new.target_id
     or old.created_at is distinct from new.created_at then
    raise exception 'ABA_V3_ROLLOUT_SCOPE_IMMUTABLE';
  end if;

  if (
    old.allow_new_v3_sessions is distinct from new.allow_new_v3_sessions
    or old.accept_v3_sync is distinct from new.accept_v3_sync
    or coalesce(old.override_active, true) is distinct from coalesce(new.override_active, true)
  ) then
    if new.effective_from is not distinct from old.effective_from then
      raise exception 'ABA_V3_ROLLOUT_EFFECTIVE_FROM_REQUIRED';
    end if;

    if new.effective_from < clock_timestamp() - interval '2 seconds' then
      raise exception 'ABA_V3_ROLLOUT_BACKDATE_FORBIDDEN';
    end if;
  elsif new.effective_from is distinct from old.effective_from then
    raise exception 'ABA_V3_ROLLOUT_EFFECTIVE_FROM_WITHOUT_STATE_CHANGE';
  end if;

  return new;
end;
$function$;

-- Explicit low-level writes always mean an explicit admin override. If a row had
-- previously been retired to INHERIT, this writer reactivates it atomically.
create or replace function public.set_aba_measurement_rollout_state_v3(
  p_organization_id uuid,
  p_scope_type text,
  p_patient_id uuid default null,
  p_program_id text default null,
  p_target_id text default null,
  p_allow_new_v3_sessions boolean default false,
  p_accept_v3_sync boolean default false,
  p_reason text default null,
  p_actor_id uuid default null,
  p_expected_state_version bigint default null
)
returns public.aba_measurement_rollout_states_v3
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_scope text := upper(btrim(coalesce(p_scope_type,'')));
  v_reason text := btrim(coalesce(p_reason,''));
  v_existing public.aba_measurement_rollout_states_v3%rowtype;
  v_result public.aba_measurement_rollout_states_v3%rowtype;
  v_readiness jsonb;
begin
  if p_organization_id is null or p_actor_id is null then raise exception 'ABA_V3_ROLLOUT_ACTOR_SCOPE_REQUIRED'; end if;
  if v_scope not in ('CLINIC','PATIENT','PROGRAM','TARGET') then raise exception 'ABA_V3_ROLLOUT_SCOPE_INVALID'; end if;
  if length(v_reason) < 5 or length(v_reason) > 500 then raise exception 'ABA_V3_ROLLOUT_REASON_INVALID'; end if;

  if not exists (
    select 1 from public.platform_admins platform_admin
    where platform_admin.user_id = p_actor_id
      and platform_admin.active is true
  ) then raise exception 'ABA_V3_ROLLOUT_PLATFORM_ADMIN_REQUIRED'; end if;

  if (v_scope = 'CLINIC' and (p_patient_id is not null or p_program_id is not null or p_target_id is not null))
     or (v_scope = 'PATIENT' and (p_patient_id is null or p_program_id is not null or p_target_id is not null))
     or (v_scope = 'PROGRAM' and (p_patient_id is null or p_program_id is null or p_target_id is not null))
     or (v_scope = 'TARGET' and (p_patient_id is null or p_program_id is null or p_target_id is null)) then
    raise exception 'ABA_V3_ROLLOUT_SCOPE_SHAPE_INVALID';
  end if;

  if p_patient_id is not null and not exists (
    select 1 from public.patients patient
    where patient.id = p_patient_id and patient.clinic_id = p_organization_id::text
  ) then raise exception 'ABA_V3_ROLLOUT_PATIENT_SCOPE_INVALID'; end if;

  if p_allow_new_v3_sessions and not p_accept_v3_sync then
    raise exception 'ABA_V3_ROLLOUT_SYNC_REQUIRED';
  end if;

  -- Readiness is required to open new V3 sessions. A kill switch / sync-drain
  -- state must remain writable even during a degraded readiness condition.
  if p_allow_new_v3_sessions then
    if v_scope in ('PROGRAM','TARGET') then
      v_readiness := public.get_aba_v3_pilot_readiness(
        p_organization_id,
        p_patient_id,
        p_program_id,
        case when v_scope = 'TARGET' then p_target_id else null end
      );
      if coalesce((v_readiness ->> 'ready')::boolean, false) = false then
        raise exception 'ABA_V3_ROLLOUT_PREFLIGHT_BLOCKED:%', v_readiness::text;
      end if;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(':','aba-v3-rollout',p_organization_id::text,v_scope,
      coalesce(p_patient_id::text,'-'),coalesce(p_program_id,'-'),coalesce(p_target_id,'-')), 0
  ));

  select * into v_existing
  from public.aba_measurement_rollout_states_v3 state
  where state.organization_id = p_organization_id
    and state.scope_type = v_scope
    and state.patient_id is not distinct from p_patient_id
    and state.program_id is not distinct from p_program_id
    and state.target_id is not distinct from p_target_id
  for update;

  if found then
    if p_expected_state_version is not null and v_existing.state_version <> p_expected_state_version then
      raise exception 'ABA_V3_ROLLOUT_STATE_VERSION_CONFLICT';
    end if;
    if v_existing.allow_new_v3_sessions = p_allow_new_v3_sessions
       and v_existing.accept_v3_sync = p_accept_v3_sync
       and coalesce(v_existing.override_active, true) is true then
      return v_existing;
    end if;

    update public.aba_measurement_rollout_states_v3
    set allow_new_v3_sessions = p_allow_new_v3_sessions,
        accept_v3_sync = p_accept_v3_sync,
        override_active = true,
        effective_from = clock_timestamp(),
        reason = v_reason,
        changed_by = p_actor_id
    where id = v_existing.id
    returning * into v_result;
    return v_result;
  end if;

  if p_expected_state_version is not null and p_expected_state_version <> 0 then
    raise exception 'ABA_V3_ROLLOUT_STATE_VERSION_CONFLICT';
  end if;

  insert into public.aba_measurement_rollout_states_v3(
    organization_id, scope_type, patient_id, program_id, target_id,
    allow_new_v3_sessions, accept_v3_sync, override_active, effective_from, reason, changed_by
  ) values (
    p_organization_id, v_scope, p_patient_id, p_program_id, p_target_id,
    p_allow_new_v3_sessions, p_accept_v3_sync, true, clock_timestamp(), v_reason, p_actor_id
  ) returning * into v_result;
  return v_result;
end;
$function$;

-- Dedicated transition from an explicit override back to DEFAULT/INHERIT. The row
-- is never deleted; its next append-only audit event records override_active=false.
create or replace function public.clear_aba_measurement_rollout_override_v3(
  p_organization_id uuid,
  p_scope_type text,
  p_patient_id uuid default null,
  p_program_id text default null,
  p_target_id text default null,
  p_reason text default null,
  p_actor_id uuid default null,
  p_expected_state_version bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_scope text := upper(btrim(coalesce(p_scope_type,'')));
  v_reason text := btrim(coalesce(p_reason,''));
  v_existing public.aba_measurement_rollout_states_v3%rowtype;
  v_result public.aba_measurement_rollout_states_v3%rowtype;
begin
  if p_organization_id is null or p_actor_id is null then raise exception 'ABA_V3_ROLLOUT_ACTOR_SCOPE_REQUIRED'; end if;
  if v_scope not in ('CLINIC','PATIENT','PROGRAM','TARGET') then raise exception 'ABA_V3_ROLLOUT_SCOPE_INVALID'; end if;
  if length(v_reason) < 5 or length(v_reason) > 500 then raise exception 'ABA_V3_ROLLOUT_REASON_INVALID'; end if;

  if not exists (
    select 1 from public.platform_admins pa
    where pa.user_id = p_actor_id and pa.active is true
  ) then raise exception 'ABA_V3_ROLLOUT_PLATFORM_ADMIN_REQUIRED'; end if;

  if (v_scope = 'CLINIC' and (p_patient_id is not null or p_program_id is not null or p_target_id is not null))
     or (v_scope = 'PATIENT' and (p_patient_id is null or p_program_id is not null or p_target_id is not null))
     or (v_scope = 'PROGRAM' and (p_patient_id is null or p_program_id is null or p_target_id is not null))
     or (v_scope = 'TARGET' and (p_patient_id is null or p_program_id is null or p_target_id is null)) then
    raise exception 'ABA_V3_ROLLOUT_SCOPE_SHAPE_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(':','aba-v3-rollout',p_organization_id::text,v_scope,
      coalesce(p_patient_id::text,'-'),coalesce(p_program_id,'-'),coalesce(p_target_id,'-')), 0
  ));

  select * into v_existing
  from public.aba_measurement_rollout_states_v3 state
  where state.organization_id = p_organization_id
    and state.scope_type = v_scope
    and state.patient_id is not distinct from p_patient_id
    and state.program_id is not distinct from p_program_id
    and state.target_id is not distinct from p_target_id
  for update;

  if not found then
    if p_expected_state_version is not null and p_expected_state_version <> 0 then
      raise exception 'ABA_V3_ROLLOUT_STATE_VERSION_CONFLICT';
    end if;
    return jsonb_build_object('cleared',false,'idempotent',true,'scope_type',v_scope,'state',null);
  end if;

  if p_expected_state_version is not null and v_existing.state_version <> p_expected_state_version then
    raise exception 'ABA_V3_ROLLOUT_STATE_VERSION_CONFLICT';
  end if;

  if coalesce(v_existing.override_active, true) is false then
    return jsonb_build_object('cleared',false,'idempotent',true,'scope_type',v_scope,'state',to_jsonb(v_existing));
  end if;

  update public.aba_measurement_rollout_states_v3
  set override_active = false,
      effective_from = clock_timestamp(),
      reason = v_reason,
      changed_by = p_actor_id
  where id = v_existing.id
  returning * into v_result;

  return jsonb_build_object('cleared',true,'idempotent',false,'scope_type',v_scope,'state',to_jsonb(v_result));
end;
$function$;

create or replace function public.resolve_aba_measurement_rollout_snapshot_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_program_id text,
  p_target_id text,
  p_decision_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_clinic jsonb;
  v_patient jsonb;
  v_program jsonb;
  v_target jsonb;
  v_enrollment jsonb;
  v_enrollment_scope text;

  v_target_type text;
  v_definition_id uuid;
  v_has_definition boolean := false;
  v_has_phase boolean := false;
  v_has_task_steps boolean := false;
  v_has_behavior_mapping boolean := false;
  v_has_abc_behavior_mapping boolean := false;
  v_semantics_supported boolean := false;
  v_readiness_green boolean := false;

  v_allow_kill_switch boolean := false;
  v_sync_kill_switch boolean := false;
  v_allow boolean := false;
  v_accept boolean := true;
  v_policy_reason text;
  v_blockers jsonb := '[]'::jsonb;
begin
  if p_organization_id is null
     or p_patient_id is null
     or nullif(btrim(coalesce(p_program_id,'')), '') is null
     or nullif(btrim(coalesce(p_target_id,'')), '') is null
     or p_decision_at is null then
    raise exception 'ABA_V3_DEFAULT_ON_SCOPE_REQUIRED';
  end if;

  -- Historical rollout state as-of session.started_at.
  v_clinic := public.get_aba_rollout_scope_state_at_v3(
    p_organization_id, 'CLINIC', null, null, null, p_decision_at
  );
  v_patient := public.get_aba_rollout_scope_state_at_v3(
    p_organization_id, 'PATIENT', p_patient_id, null, null, p_decision_at
  );
  v_program := public.get_aba_rollout_scope_state_at_v3(
    p_organization_id, 'PROGRAM', p_patient_id, p_program_id, null, p_decision_at
  );
  v_target := public.get_aba_rollout_scope_state_at_v3(
    p_organization_id, 'TARGET', p_patient_id, p_program_id, p_target_id, p_decision_at
  );

  -- A rollout row can now be retired back to INHERIT without deleting its
  -- immutable event history. Historical events created before override_active
  -- existed are treated as active for backward-compatible as-of resolution.
  if v_clinic is not null and coalesce((v_clinic ->> 'override_active')::boolean, true) is false then
    v_clinic := null;
  end if;
  if v_patient is not null and coalesce((v_patient ->> 'override_active')::boolean, true) is false then
    v_patient := null;
  end if;
  if v_program is not null and coalesce((v_program ->> 'override_active')::boolean, true) is false then
    v_program := null;
  end if;
  if v_target is not null and coalesce((v_target ->> 'override_active')::boolean, true) is false then
    v_target := null;
  end if;

  -- Most-specific persisted state is retained only for audit lineage. It is no
  -- longer required for enrollment because DEFAULT_ON is the normal policy.
  if v_target is not null then
    v_enrollment := v_target;
    v_enrollment_scope := 'TARGET';
  elsif v_program is not null then
    v_enrollment := v_program;
    v_enrollment_scope := 'PROGRAM';
  elsif v_patient is not null then
    v_enrollment := v_patient;
    v_enrollment_scope := 'PATIENT';
  elsif v_clinic is not null then
    v_enrollment := v_clinic;
    v_enrollment_scope := 'CLINIC';
  else
    v_enrollment := null;
    v_enrollment_scope := 'DEFAULT_ON';
  end if;

  -- Any explicit false is a kill switch. Missing state means inherit default-on.
  v_allow_kill_switch :=
       (v_clinic is not null and coalesce((v_clinic ->> 'allow_new_v3_sessions')::boolean,false) = false)
    or (v_patient is not null and coalesce((v_patient ->> 'allow_new_v3_sessions')::boolean,false) = false)
    or (v_program is not null and coalesce((v_program ->> 'allow_new_v3_sessions')::boolean,false) = false)
    or (v_target is not null and coalesce((v_target ->> 'allow_new_v3_sessions')::boolean,false) = false);

  v_sync_kill_switch :=
       (v_clinic is not null and coalesce((v_clinic ->> 'accept_v3_sync')::boolean,false) = false)
    or (v_patient is not null and coalesce((v_patient ->> 'accept_v3_sync')::boolean,false) = false)
    or (v_program is not null and coalesce((v_program ->> 'accept_v3_sync')::boolean,false) = false)
    or (v_target is not null and coalesce((v_target ->> 'accept_v3_sync')::boolean,false) = false);

  v_accept := not v_sync_kill_switch;

  select lower(coalesce(t.target_type,''))
    into v_target_type
  from public.aba_targets t
  where t.id = p_target_id
    and t.patient_id = p_patient_id
    and t.program_id = p_program_id
    and t.clinic_id = p_organization_id::text;

  if not found then
    v_policy_reason := 'TARGET_SCOPE_INVALID';
    v_blockers := v_blockers || jsonb_build_array('TARGET_SCOPE_INVALID');
    return jsonb_build_object(
      'decision_at', p_decision_at,
      'policy_mode', 'V3_DEFAULT_ON',
      'policy_reason', v_policy_reason,
      'target_type', null,
      'semantics_supported', false,
      'readiness_green', false,
      'allow_new_v3_sessions', false,
      'accept_v3_sync', v_accept,
      'explicit_allow_kill_switch', v_allow_kill_switch,
      'explicit_sync_kill_switch', v_sync_kill_switch,
      'blockers', v_blockers,
      'clinic', coalesce(v_clinic, 'null'::jsonb),
      'patient', coalesce(v_patient, 'null'::jsonb),
      'program', coalesce(v_program, 'null'::jsonb),
      'target', coalesce(v_target, 'null'::jsonb),
      'enrollment_scope', v_enrollment_scope,
      'enrollment_state_id', nullif(v_enrollment ->> 'id', ''),
      'enrollment_state_version', nullif(v_enrollment ->> 'state_version', '')
    );
  end if;

  -- Definition valid for the exact session-start instant.
  select d.id
    into v_definition_id
  from public.aba_collection_definition_versions_v3 d
  where d.organization_id = p_organization_id
    and d.patient_id = p_patient_id
    and d.program_id = p_program_id
    and d.target_id = p_target_id
    and d.status in ('PUBLISHED','DEPRECATED','ARCHIVED')
    and d.published_at <= p_decision_at
    and (d.deprecated_at is null or p_decision_at < d.deprecated_at)
  order by d.version desc
  limit 1;
  v_has_definition := found;

  select exists (
    select 1
    from public.aba_target_phase_assignments_v3 ph
    where ph.organization_id = p_organization_id
      and ph.patient_id = p_patient_id
      and ph.program_id = p_program_id
      and ph.target_id = p_target_id
      and ph.effective_from <= p_decision_at
      and (ph.effective_until is null or p_decision_at < ph.effective_until)
  ) into v_has_phase;

  if v_target_type = 'task_analysis' and v_definition_id is not null then
    select exists (
      select 1
      from public.aba_task_analysis_step_definitions_v3 st
      where st.collection_definition_version_id = v_definition_id
    ) into v_has_task_steps;
  end if;

  if v_target_type = 'behavior' then
    select exists (
      select 1
      from public.aba_behavior_target_bindings_v3 b
      join public.aba_behavior_definitions bd
        on bd.id = b.behavior_id
       and bd.patient_id = b.patient_id
       and bd.clinic_id = b.organization_id::text
      where b.organization_id = p_organization_id
        and b.patient_id = p_patient_id
        and b.target_id = p_target_id
        and b.status = 'ACTIVE'
        and b.created_at <= p_decision_at
        and lower(coalesce(bd.measurement_type,'')) <> 'abc'
    ) into v_has_behavior_mapping;

    select exists (
      select 1
      from public.aba_behavior_target_bindings_v3 b
      join public.aba_behavior_definitions bd
        on bd.id = b.behavior_id
       and bd.patient_id = b.patient_id
       and bd.clinic_id = b.organization_id::text
      where b.organization_id = p_organization_id
        and b.patient_id = p_patient_id
        and b.target_id = p_target_id
        and b.status = 'ACTIVE'
        and b.created_at <= p_decision_at
        and lower(coalesce(bd.measurement_type,'')) = 'abc'
    ) into v_has_abc_behavior_mapping;
  end if;

  v_semantics_supported := v_target_type in ('dtt','net','probe','task_analysis','behavior');

  if not v_semantics_supported then
    v_blockers := v_blockers || jsonb_build_array('UNSUPPORTED_TARGET_SEMANTICS');
  end if;
  if not v_has_definition then
    v_blockers := v_blockers || jsonb_build_array('MISSING_PUBLISHED_COLLECTION_DEFINITION');
  end if;
  if not v_has_phase then
    v_blockers := v_blockers || jsonb_build_array('MISSING_ACTIVE_TARGET_PHASE');
  end if;
  if v_target_type = 'task_analysis' and not v_has_task_steps then
    v_blockers := v_blockers || jsonb_build_array('TASK_ANALYSIS_STEPS_MISSING');
  end if;
  if v_target_type = 'behavior' and not v_has_behavior_mapping then
    v_blockers := v_blockers || jsonb_build_array('BEHAVIOR_MAPPING_MISSING');
  end if;
  if v_target_type = 'behavior' and v_has_abc_behavior_mapping then
    v_blockers := v_blockers || jsonb_build_array('ABC_V3_MAPPING_FORBIDDEN');
  end if;

  v_readiness_green := jsonb_array_length(v_blockers) = 0;
  v_allow := v_readiness_green and not v_allow_kill_switch;

  v_policy_reason := case
    when v_allow_kill_switch then 'EXPLICIT_KILL_SWITCH'
    when not v_readiness_green then 'READINESS_OR_SEMANTICS_FALLBACK'
    else 'DEFAULT_ON_ELIGIBLE'
  end;

  return jsonb_build_object(
    'decision_at', p_decision_at,
    'policy_mode', 'V3_DEFAULT_ON',
    'policy_reason', v_policy_reason,
    'target_type', v_target_type,
    'semantics_supported', v_semantics_supported,
    'readiness_green', v_readiness_green,
    'allow_new_v3_sessions', v_allow,
    'accept_v3_sync', v_accept,
    'explicit_allow_kill_switch', v_allow_kill_switch,
    'explicit_sync_kill_switch', v_sync_kill_switch,
    'blockers', v_blockers,
    'clinic', coalesce(v_clinic, 'null'::jsonb),
    'patient', coalesce(v_patient, 'null'::jsonb),
    'program', coalesce(v_program, 'null'::jsonb),
    'target', coalesce(v_target, 'null'::jsonb),
    'enrollment_scope', v_enrollment_scope,
    'enrollment_state_id', nullif(v_enrollment ->> 'id', ''),
    'enrollment_state_version', nullif(v_enrollment ->> 'state_version', '')
  );
end;
$function$;

-- Current operational snapshot aligned with DEFAULT_ON/INHERIT semantics.
create or replace function public.get_aba_v3_exact_target_cohort_snapshot_v1(
  p_organization_id uuid,
  p_patient_id uuid,
  p_program_id text,
  p_target_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_readiness jsonb;
  v_drain jsonb;
  v_resolved jsonb;
  v_security jsonb := null;
  v_target jsonb;
  v_open_sessions integer := 0;
  v_clinic_state jsonb;
  v_patient_state jsonb;
  v_program_state jsonb;
  v_target_state jsonb;
  v_active_positive_override_count integer := 0;
  v_control_mode text;
begin
  if p_organization_id is null or p_patient_id is null
     or nullif(btrim(coalesce(p_program_id,'')), '') is null
     or nullif(btrim(coalesce(p_target_id,'')), '') is null then
    raise exception 'ABA_V3_COHORT_SCOPE_REQUIRED';
  end if;

  select jsonb_build_object(
    'clinic_id', t.clinic_id,
    'patient_id', t.patient_id,
    'program_id', t.program_id,
    'target_id', t.id,
    'target_name', t.name,
    'target_type', t.target_type,
    'target_phase', t.phase,
    'program_name', p.name,
    'program_status', p.status,
    'patient_name', patient.name,
    'clinic_name', clinic.name
  )
  into v_target
  from public.aba_targets t
  join public.aba_programs p
    on p.id = t.program_id
   and p.patient_id = t.patient_id
  join public.patients patient
    on patient.id = t.patient_id
  join public.clinics clinic
    on clinic.id = p_organization_id
  where t.id = p_target_id
    and t.program_id = p_program_id
    and t.patient_id = p_patient_id
    and t.clinic_id = p_organization_id::text
    and patient.clinic_id = p_organization_id
  limit 1;

  if v_target is null then
    raise exception 'ABA_V3_COHORT_TARGET_SCOPE_INVALID';
  end if;

  v_readiness := public.get_aba_v3_pilot_readiness(
    p_organization_id, p_patient_id, p_program_id, p_target_id
  );

  v_drain := public.get_aba_v3_rollout_drain_status(
    p_organization_id, 'TARGET', p_patient_id, p_program_id, p_target_id
  );

  v_resolved := public.resolve_aba_measurement_rollout_snapshot_v3(
    p_organization_id, p_patient_id, p_program_id, p_target_id, clock_timestamp()
  );

  select count(*)::integer
  into v_open_sessions
  from public.aba_sessions s
  where s.patient_id = p_patient_id
    and s.clinic_id = p_organization_id::text
    and lower(coalesce(s.status,'')) in ('active','in_progress');

  select to_jsonb(r) into v_clinic_state
  from public.aba_measurement_rollout_states_v3 r
  where r.organization_id = p_organization_id
    and r.scope_type = 'CLINIC'
  limit 1;

  select to_jsonb(r) into v_patient_state
  from public.aba_measurement_rollout_states_v3 r
  where r.organization_id = p_organization_id
    and r.scope_type = 'PATIENT'
    and r.patient_id = p_patient_id
  limit 1;

  select to_jsonb(r) into v_program_state
  from public.aba_measurement_rollout_states_v3 r
  where r.organization_id = p_organization_id
    and r.scope_type = 'PROGRAM'
    and r.patient_id = p_patient_id
    and r.program_id = p_program_id
  limit 1;

  select to_jsonb(r) into v_target_state
  from public.aba_measurement_rollout_states_v3 r
  where r.organization_id = p_organization_id
    and r.scope_type = 'TARGET'
    and r.patient_id = p_patient_id
    and r.program_id = p_program_id
    and r.target_id = p_target_id
  limit 1;

  select count(*)::integer into v_active_positive_override_count
  from public.aba_measurement_rollout_states_v3 r
  where r.organization_id = p_organization_id
    and coalesce(r.override_active, true) is true
    and r.allow_new_v3_sessions is true
    and r.accept_v3_sync is true
    and (
      r.scope_type = 'CLINIC'
      or (r.scope_type = 'PATIENT' and r.patient_id = p_patient_id)
      or (r.scope_type = 'PROGRAM' and r.patient_id = p_patient_id and r.program_id = p_program_id)
      or (r.scope_type = 'TARGET' and r.patient_id = p_patient_id and r.program_id = p_program_id and r.target_id = p_target_id)
    );

  v_control_mode := case
    when coalesce((v_resolved->>'explicit_allow_kill_switch')::boolean,false)
      or coalesce((v_resolved->>'explicit_sync_kill_switch')::boolean,false)
      then 'KILL_SWITCH'
    when v_active_positive_override_count > 0
      then 'LEGACY_POSITIVE_OVERRIDE'
    else 'DEFAULT_INHERIT'
  end;

  if to_regprocedure('public.get_clinical_measurement_v3_security_preflight()') is not null then
    execute 'select public.get_clinical_measurement_v3_security_preflight()' into v_security;
  end if;

  return jsonb_build_object(
    'snapshot_version', 'ABA_V3_EXACT_TARGET_OPERATIONAL_DEFAULT_ON_V2',
    'checked_at', clock_timestamp(),
    'scope', jsonb_build_object(
      'organization_id', p_organization_id,
      'patient_id', p_patient_id,
      'program_id', p_program_id,
      'target_id', p_target_id
    ),
    'target', v_target,
    'readiness', v_readiness,
    'drain_status', v_drain,
    'resolved_rollout', v_resolved,
    'security_preflight', coalesce(v_security, 'null'::jsonb),
    'open_session_count', v_open_sessions,
    'states', jsonb_build_object(
      'clinic', coalesce(v_clinic_state, 'null'::jsonb),
      'patient', coalesce(v_patient_state, 'null'::jsonb),
      'program', coalesce(v_program_state, 'null'::jsonb),
      'target', coalesce(v_target_state, 'null'::jsonb)
    ),
    'expected_state_versions', jsonb_build_object(
      'clinic', coalesce((v_clinic_state->>'state_version')::bigint, 0),
      'patient', coalesce((v_patient_state->>'state_version')::bigint, 0),
      'program', coalesce((v_program_state->>'state_version')::bigint, 0),
      'target', coalesce((v_target_state->>'state_version')::bigint, 0)
    ),
    'control_mode', v_control_mode,
    'active_positive_override_count', v_active_positive_override_count,
    'target_override_active', coalesce((v_target_state->>'override_active')::boolean, false),
    'effective_enabled', coalesce((v_resolved->>'allow_new_v3_sessions')::boolean, false),
    'writer_supported', lower(coalesce(v_target->>'target_type','')) in ('dtt','net','cold_probe','baseline_probe','maintenance_probe'),
    'can_enable',
      coalesce((v_readiness->>'ready')::boolean, false)
      and lower(coalesce(v_target->>'target_type','')) in ('dtt','net','cold_probe','baseline_probe','maintenance_probe')
      and coalesce((v_security->>'ok')::boolean, true),
    'can_disable_new_sessions',
      coalesce((v_resolved->>'allow_new_v3_sessions')::boolean, false)
      and lower(coalesce(v_target->>'target_type','')) in ('dtt','net','cold_probe','baseline_probe','maintenance_probe')
  );
end;
$function$;

-- Default-on semantics for the existing exact-target operational writer:
--   p_enable=false => create/activate an exact TARGET kill switch;
--   p_enable=true  => retire the exact TARGET override back to DEFAULT/INHERIT.
-- It no longer creates positive CLINIC/PATIENT/TARGET enrollment rows.
create or replace function public.set_aba_v3_exact_target_cohort_v1(
  p_organization_id uuid,
  p_patient_id uuid,
  p_program_id text,
  p_target_id text,
  p_enable boolean,
  p_reason text,
  p_actor_id uuid,
  p_expected_clinic_version bigint,
  p_expected_patient_version bigint,
  p_expected_target_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_reason text := btrim(coalesce(p_reason,''));
  v_before jsonb;
  v_after jsonb;
  v_current_clinic_version bigint := 0;
  v_current_patient_version bigint := 0;
  v_current_target_version bigint := 0;
begin
  if p_organization_id is null or p_patient_id is null or p_actor_id is null
     or nullif(btrim(coalesce(p_program_id,'')), '') is null
     or nullif(btrim(coalesce(p_target_id,'')), '') is null then
    raise exception 'ABA_V3_COHORT_SCOPE_REQUIRED';
  end if;
  if length(v_reason) < 10 or length(v_reason) > 500 then
    raise exception 'ABA_V3_COHORT_REASON_INVALID';
  end if;
  if p_expected_clinic_version is null or p_expected_clinic_version < 0
     or p_expected_patient_version is null or p_expected_patient_version < 0
     or p_expected_target_version is null or p_expected_target_version < 0 then
    raise exception 'ABA_V3_COHORT_EXPECTED_VERSIONS_REQUIRED';
  end if;

  if not exists (
    select 1 from public.platform_admins pa
    where pa.user_id = p_actor_id and pa.active is true
  ) then
    raise exception 'ABA_V3_ROLLOUT_PLATFORM_ADMIN_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(':','aba-v3-exact-cohort',p_organization_id::text,p_patient_id::text,p_program_id,p_target_id), 0
  ));

  v_before := public.get_aba_v3_exact_target_cohort_snapshot_v1(
    p_organization_id, p_patient_id, p_program_id, p_target_id
  );

  v_current_clinic_version := coalesce((v_before #>> '{expected_state_versions,clinic}')::bigint, 0);
  v_current_patient_version := coalesce((v_before #>> '{expected_state_versions,patient}')::bigint, 0);
  v_current_target_version := coalesce((v_before #>> '{expected_state_versions,target}')::bigint, 0);

  if v_current_clinic_version <> p_expected_clinic_version
     or v_current_patient_version <> p_expected_patient_version
     or v_current_target_version <> p_expected_target_version then
    raise exception 'ABA_V3_COHORT_STATE_VERSION_CONFLICT';
  end if;

  if p_enable then
    perform public.clear_aba_measurement_rollout_override_v3(
      p_organization_id, 'TARGET', p_patient_id, p_program_id, p_target_id,
      v_reason, p_actor_id, v_current_target_version
    );
  else
    perform public.set_aba_measurement_rollout_state_v3(
      p_organization_id, 'TARGET', p_patient_id, p_program_id, p_target_id,
      false, true, v_reason, p_actor_id, v_current_target_version
    );
  end if;

  v_after := public.get_aba_v3_exact_target_cohort_snapshot_v1(
    p_organization_id, p_patient_id, p_program_id, p_target_id
  );

  if not p_enable and coalesce((v_after #>> '{resolved_rollout,explicit_allow_kill_switch}')::boolean,false) is not true then
    raise exception 'ABA_V3_TARGET_KILL_SWITCH_POSTCONDITION_FAILED:%', left(v_after::text,4000);
  end if;

  return jsonb_build_object(
    'action', case when p_enable then 'RETURN_TO_DEFAULT' else 'APPLY_TARGET_KILL_SWITCH' end,
    'snapshot', v_after
  );
end;
$function$;

revoke all on function public.get_aba_v3_exact_target_cohort_snapshot_v1(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.set_aba_measurement_rollout_state_v3(uuid,text,uuid,text,text,boolean,boolean,text,uuid,bigint) from public, anon, authenticated;
revoke all on function public.clear_aba_measurement_rollout_override_v3(uuid,text,uuid,text,text,text,uuid,bigint) from public, anon, authenticated;
revoke all on function public.resolve_aba_measurement_rollout_snapshot_v3(uuid,uuid,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.set_aba_v3_exact_target_cohort_v1(uuid,uuid,text,text,boolean,text,uuid,bigint,bigint,bigint) from public, anon, authenticated;

grant execute on function public.get_aba_v3_exact_target_cohort_snapshot_v1(uuid,uuid,text,text) to service_role;
grant execute on function public.set_aba_measurement_rollout_state_v3(uuid,text,uuid,text,text,boolean,boolean,text,uuid,bigint) to service_role;
grant execute on function public.clear_aba_measurement_rollout_override_v3(uuid,text,uuid,text,text,text,uuid,bigint) to service_role;
grant execute on function public.resolve_aba_measurement_rollout_snapshot_v3(uuid,uuid,text,text,timestamptz) to service_role;
grant execute on function public.set_aba_v3_exact_target_cohort_v1(uuid,uuid,text,text,boolean,text,uuid,bigint,bigint,bigint) to service_role;

commit;

select jsonb_build_object(
  'gate', case
    when not exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = 'public.aba_measurement_rollout_states_v3'::regclass
        and attname = 'override_active' and not attisdropped
    ) then 'BLOCKED_OVERRIDE_ACTIVE_COLUMN_MISSING'
    when to_regprocedure('public.clear_aba_measurement_rollout_override_v3(uuid,text,uuid,text,text,text,uuid,bigint)') is null
      then 'BLOCKED_CLEAR_OVERRIDE_RPC_MISSING'
    when has_function_privilege('authenticated','public.clear_aba_measurement_rollout_override_v3(uuid,text,uuid,text,text,text,uuid,bigint)','EXECUTE')
      then 'BLOCKED_BROWSER_CLEAR_OVERRIDE_EXECUTE'
    when not has_function_privilege('service_role','public.clear_aba_measurement_rollout_override_v3(uuid,text,uuid,text,text,text,uuid,bigint)','EXECUTE')
      then 'BLOCKED_SERVICE_ROLE_CLEAR_OVERRIDE_EXECUTE'
    else 'ABA_V3_DEFAULT_ON_OVERRIDE_LIFECYCLE_READY'
  end,
  'override_active_column', true,
  'absence_or_inactive_override_means', 'INHERIT_DEFAULT_ON',
  'explicit_false_means', 'KILL_SWITCH',
  'existing_rows_mutated', false,
  'clinical_rows_mutated', false,
  'bindings_rewritten', false
) as aba_v3_default_on_override_lifecycle_install;
