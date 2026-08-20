-- ABA V3 exact production canary protocol bootstrap — transaction-time hotfix.
-- Scope: ONE preselected DEMO patient/program/target only.
-- Purpose: create the immutable published collection definition and active target phase
-- required by ABA V3 readiness. It DOES NOT enable rollout and DOES NOT create sessions/trials.
-- Fail-closed + idempotent for this exact cohort.
-- HOTFIX: use transaction_timestamp()/now() for persisted validity boundaries because
-- readiness uses now(); clock_timestamp() inside the same transaction can be later than now().

begin;

DO $bootstrap$
DECLARE
  v_org uuid := '79b1a8f9-ab9d-43dc-b57d-3afca67b553b'::uuid;
  v_patient uuid := 'dc739da0-4626-4cf8-a339-30e431283a4a'::uuid;
  v_program text := '4ff72c73-8588-4746-9d19-5ea3c7d4bbf2';
  v_target text := 'eff9b97f-948d-491e-9b9a-afdef276e2a5';
  v_security jsonb;
  v_rollout_count integer;
  v_open_sessions integer;
  v_target_row public.aba_targets%rowtype;
  v_program_row public.aba_programs%rowtype;
  v_definition jsonb;
  v_hash text;
  v_next_version integer;
BEGIN
  -- Serialize this exact target bootstrap only.
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ABA_V3_PROD_CANARY_PROTOCOL:' || v_org::text || ':' || v_target, 0)
  );

  -- Security must already be green before any metadata write.
  v_security := public.get_clinical_measurement_v3_security_preflight();
  if coalesce((v_security ->> 'ok')::boolean, false) is false then
    raise exception 'ABA_V3_CANARY_BOOTSTRAP_SECURITY_PREFLIGHT_FAILED';
  end if;

  select * into v_program_row
  from public.aba_programs p
  where p.id = v_program
    and p.patient_id = v_patient
    and p.clinic_id = v_org::text;

  if not found then
    raise exception 'ABA_V3_CANARY_BOOTSTRAP_PROGRAM_SCOPE_INVALID';
  end if;

  select * into v_target_row
  from public.aba_targets t
  where t.id = v_target
    and t.patient_id = v_patient
    and t.program_id = v_program
    and t.clinic_id = v_org::text;

  if not found then
    raise exception 'ABA_V3_CANARY_BOOTSTRAP_TARGET_SCOPE_INVALID';
  end if;

  if lower(coalesce(v_target_row.target_type, '')) <> 'dtt' then
    raise exception 'ABA_V3_CANARY_BOOTSTRAP_TARGET_NOT_DTT';
  end if;

  if lower(coalesce(v_target_row.phase, '')) <> 'teaching' then
    raise exception 'ABA_V3_CANARY_BOOTSTRAP_TARGET_NOT_TEACHING';
  end if;

  if lower(coalesce(v_program_row.status, '')) not in ('teaching', 'active') then
    raise exception 'ABA_V3_CANARY_BOOTSTRAP_PROGRAM_NOT_ACTIVE';
  end if;

  select count(*)::integer into v_open_sessions
  from public.aba_sessions s
  where s.patient_id = v_patient
    and s.clinic_id = v_org::text
    and lower(coalesce(s.status, '')) = 'active';

  if v_open_sessions <> 0 then
    raise exception 'ABA_V3_CANARY_BOOTSTRAP_OPEN_SESSION_EXISTS';
  end if;

  -- Nothing can already be enabled while protocol metadata is being prepared.
  select count(*)::integer into v_rollout_count
  from public.aba_measurement_rollout_states_v3 r
  where r.organization_id = v_org
    and r.allow_new_v3_sessions is true;

  if v_rollout_count <> 0 then
    raise exception 'ABA_V3_CANARY_BOOTSTRAP_PREEXISTING_ROLLOUT';
  end if;

  -- Immutable protocol snapshot: derive from the exact clinical configuration
  -- already persisted for the DEMO target/program. No scores or inferred semantics.
  v_definition := jsonb_build_object(
    'schema_version', 3,
    'kind', 'ABA_DTT_OPPORTUNITY',
    'source', 'PRODUCTION_DEMO_CANARY_BOOTSTRAP',
    'target', jsonb_build_object(
      'id', v_target_row.id,
      'name', v_target_row.name,
      'description', v_target_row.description,
      'target_type', v_target_row.target_type,
      'measurement_type', v_target_row.measurement_type,
      'phase_at_publish', v_target_row.phase,
      'clinical_status_at_publish', v_target_row.clinical_status,
      'protocol_id', v_target_row.protocol_id,
      'protocol_title', v_target_row.protocol_title,
      'domain_id', v_target_row.domain_id,
      'domain_name', v_target_row.domain_name,
      'objective_snapshot', v_target_row.objective_snapshot,
      'mastery_criteria', coalesce(v_target_row.mastery_criteria, '{}'::jsonb),
      'program_version', v_target_row.program_version
    ),
    'program', jsonb_build_object(
      'id', v_program_row.id,
      'name', v_program_row.name,
      'program_type', v_program_row.program_type,
      'status_at_publish', v_program_row.status,
      'measurement_type', v_program_row.measurement_type,
      'objective', v_program_row.objective,
      'category', v_program_row.category,
      'protocol_id', v_program_row.protocol_id,
      'protocol_title', v_program_row.protocol_title,
      'domain_id', v_program_row.domain_id,
      'domain_name', v_program_row.domain_name,
      'mastery_criteria', coalesce(v_program_row.mastery_criteria, '{}'::jsonb),
      'advanced_settings', coalesce(v_program_row.advanced_settings, '{}'::jsonb),
      'version', v_program_row.version
    ),
    'prompt_catalog', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'key', pl.key,
          'name', pl.name,
          'abbreviation', pl.abbreviation,
          'sort_order', pl.sort_order,
          'is_independent', pl.is_independent,
          'is_error', pl.is_error,
          'is_default', pl.is_default
        ) order by pl.sort_order, pl.key
      )
      from public.aba_prompt_levels pl
      where pl.clinic_id = v_org::text
    ), '[]'::jsonb),
    'opportunity_semantics', jsonb_build_object(
      'independent_response', 'PRIMARY_INDEPENDENT',
      'prompted_response', 'SUPPORT',
      'incorrect_response', 'PRIMARY_INDEPENDENT',
      'no_response', 'PRIMARY_INDEPENDENT'
    )
  );

  v_hash := encode(digest(v_definition::text, 'sha256'), 'hex');

  -- Publish only if this target has no currently published definition.
  if not exists (
    select 1
    from public.aba_collection_definition_versions_v3 d
    where d.organization_id = v_org
      and d.patient_id = v_patient
      and d.program_id = v_program
      and d.target_id = v_target
      and d.status = 'PUBLISHED'
      and d.deprecated_at is null
  ) then
    select coalesce(max(d.version), 0) + 1
      into v_next_version
    from public.aba_collection_definition_versions_v3 d
    where d.target_id = v_target;

    insert into public.aba_collection_definition_versions_v3 (
      organization_id,
      patient_id,
      program_id,
      target_id,
      version,
      schema_version,
      status,
      definition,
      definition_hash,
      published_at,
      created_by
    ) values (
      v_org,
      v_patient,
      v_program,
      v_target,
      v_next_version,
      3,
      'PUBLISHED',
      v_definition,
      v_hash,
      now(),
      null
    );
  end if;

  -- Establish exactly one currently-active clinical phase for future sessions.
  if not exists (
    select 1
    from public.aba_target_phase_assignments_v3 ph
    where ph.organization_id = v_org
      and ph.patient_id = v_patient
      and ph.program_id = v_program
      and ph.target_id = v_target
      and ph.effective_from <= now()
      and (ph.effective_until is null or now() < ph.effective_until)
  ) then
    insert into public.aba_target_phase_assignments_v3 (
      organization_id,
      patient_id,
      program_id,
      target_id,
      source_clinical_plan_phase_id,
      phase_type,
      phase_key,
      label,
      reason,
      effective_from,
      effective_until,
      created_by
    ) values (
      v_org,
      v_patient,
      v_program,
      v_target,
      null,
      'intervention',
      'teaching',
      'Ensino',
      'Production DEMO canary protocol bootstrap',
      now(),
      null,
      null
    );
  end if;
END;
$bootstrap$;

-- Fail closed unless exact readiness is green AFTER the two metadata objects exist.
DO $attest$
DECLARE
  v_ready jsonb;
BEGIN
  v_ready := public.get_aba_v3_pilot_readiness(
    '79b1a8f9-ab9d-43dc-b57d-3afca67b553b'::uuid,
    'dc739da0-4626-4cf8-a339-30e431283a4a'::uuid,
    '4ff72c73-8588-4746-9d19-5ea3c7d4bbf2'::text,
    'eff9b97f-948d-491e-9b9a-afdef276e2a5'::text
  );

  if coalesce((v_ready ->> 'ready')::boolean, false) is false then
    raise exception 'ABA_V3_CANARY_BOOTSTRAP_POST_READINESS_FAILED: %', v_ready::text;
  end if;

  if exists (
    select 1
    from public.aba_measurement_rollout_states_v3 r
    where r.organization_id = '79b1a8f9-ab9d-43dc-b57d-3afca67b553b'::uuid
      and r.allow_new_v3_sessions is true
  ) then
    raise exception 'ABA_V3_CANARY_BOOTSTRAP_ROLLOUT_MUTATED_UNEXPECTEDLY';
  end if;
END;
$attest$;

commit;

select jsonb_build_object(
  'gate', 'EXACT_COHORT_PROTOCOL_READY_DARK',
  'scope', jsonb_build_object(
    'organization_id', '79b1a8f9-ab9d-43dc-b57d-3afca67b553b',
    'patient_id', 'dc739da0-4626-4cf8-a339-30e431283a4a',
    'program_id', '4ff72c73-8588-4746-9d19-5ea3c7d4bbf2',
    'target_id', 'eff9b97f-948d-491e-9b9a-afdef276e2a5'
  ),
  'published_definition', (
    select jsonb_build_object('id', d.id, 'version', d.version, 'hash', d.definition_hash)
    from public.aba_collection_definition_versions_v3 d
    where d.organization_id = '79b1a8f9-ab9d-43dc-b57d-3afca67b553b'::uuid
      and d.patient_id = 'dc739da0-4626-4cf8-a339-30e431283a4a'::uuid
      and d.program_id = '4ff72c73-8588-4746-9d19-5ea3c7d4bbf2'
      and d.target_id = 'eff9b97f-948d-491e-9b9a-afdef276e2a5'
      and d.status = 'PUBLISHED'
      and d.deprecated_at is null
    order by d.version desc
    limit 1
  ),
  'active_phase', (
    select jsonb_build_object('id', ph.id, 'phase_type', ph.phase_type, 'phase_key', ph.phase_key, 'effective_from', ph.effective_from)
    from public.aba_target_phase_assignments_v3 ph
    where ph.organization_id = '79b1a8f9-ab9d-43dc-b57d-3afca67b553b'::uuid
      and ph.patient_id = 'dc739da0-4626-4cf8-a339-30e431283a4a'::uuid
      and ph.program_id = '4ff72c73-8588-4746-9d19-5ea3c7d4bbf2'
      and ph.target_id = 'eff9b97f-948d-491e-9b9a-afdef276e2a5'
      and ph.effective_from <= now()
      and (ph.effective_until is null or now() < ph.effective_until)
    order by ph.effective_from desc
    limit 1
  ),
  'readiness', public.get_aba_v3_pilot_readiness(
    '79b1a8f9-ab9d-43dc-b57d-3afca67b553b'::uuid,
    'dc739da0-4626-4cf8-a339-30e431283a4a'::uuid,
    '4ff72c73-8588-4746-9d19-5ea3c7d4bbf2'::text,
    'eff9b97f-948d-491e-9b9a-afdef276e2a5'::text
  ),
  'rollout_enabled', exists (
    select 1
    from public.aba_measurement_rollout_states_v3 r
    where r.organization_id = '79b1a8f9-ab9d-43dc-b57d-3afca67b553b'::uuid
      and r.allow_new_v3_sessions is true
  ),
  'writes', jsonb_build_array('PUBLISHED_COLLECTION_DEFINITION_IF_MISSING', 'ACTIVE_TARGET_PHASE_IF_MISSING')
) as exact_production_canary_protocol_bootstrap;
