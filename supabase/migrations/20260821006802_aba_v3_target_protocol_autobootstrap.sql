-- ABA Measurement V3 — automatic protocol bootstrap/versioning for ABA targets.
-- Default-on follow-up: new/edited ABA targets should not require manual V3 metadata preparation.
--
-- Safety model:
--   * additive metadata only; never rewrites ABA V2 trials/sessions;
--   * definitions are immutable versions (old PUBLISHED version is only lifecycle-deprecated);
--   * phases are target-scoped time episodes and change only when target.phase/program changes;
--   * draft/on-hold/discontinued targets have no active V3 phase, so resolver remains fail-closed;
--   * trigger function is SECURITY DEFINER but cannot be invoked directly by browser roles;
--   * no rollout rows are created or mutated here. Default-on/kill-switch policy remains 06801.

begin;

create or replace function public.build_aba_v3_target_definition_snapshot_v1(
  p_target_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_target public.aba_targets%rowtype;
  v_program public.aba_programs%rowtype;
  v_kind text;
begin
  if nullif(btrim(coalesce(p_target_id,'')), '') is null then
    raise exception 'ABA_V3_TARGET_DEFINITION_TARGET_REQUIRED';
  end if;

  select * into v_target
  from public.aba_targets t
  where t.id = p_target_id;

  if not found then
    raise exception 'ABA_V3_TARGET_DEFINITION_TARGET_NOT_FOUND';
  end if;

  if v_target.program_id is null then
    raise exception 'ABA_V3_TARGET_DEFINITION_PROGRAM_REQUIRED';
  end if;

  select * into v_program
  from public.aba_programs p
  where p.id = v_target.program_id
    and p.patient_id = v_target.patient_id
    and p.clinic_id = v_target.clinic_id;

  if not found then
    raise exception 'ABA_V3_TARGET_DEFINITION_PROGRAM_SCOPE_INVALID';
  end if;

  v_kind := case lower(coalesce(v_target.target_type,''))
    when 'dtt' then 'ABA_ATOMIC_OPPORTUNITY'
    when 'net' then 'ABA_ATOMIC_OPPORTUNITY'
    when 'probe' then 'ABA_ATOMIC_OPPORTUNITY'
    when 'task_analysis' then 'ABA_TASK_ANALYSIS'
    when 'behavior' then 'ABA_BEHAVIOR_TARGET'
    else 'ABA_UNSUPPORTED_TARGET'
  end;

  return jsonb_build_object(
    'schema_version', 3,
    'kind', v_kind,
    'source', 'ABA_TARGET_AUTOBootstrap_V1',
    'target', jsonb_build_object(
      'id', v_target.id,
      'name', v_target.name,
      'description', v_target.description,
      'target_type', lower(coalesce(v_target.target_type,'')),
      'measurement_type', v_target.measurement_type,
      'protocol_id', v_target.protocol_id,
      'protocol_title', v_target.protocol_title,
      'domain_id', v_target.domain_id,
      'domain_name', v_target.domain_name,
      'objective_snapshot', v_target.objective_snapshot,
      'mastery_criteria', coalesce(v_target.mastery_criteria, '{}'::jsonb),
      'program_version', v_target.program_version
    ),
    'program', jsonb_build_object(
      'id', v_program.id,
      'name', v_program.name,
      'program_type', v_program.program_type,
      'measurement_type', v_program.measurement_type,
      'objective', v_program.objective,
      'category', v_program.category,
      'protocol_id', v_program.protocol_id,
      'protocol_title', v_program.protocol_title,
      'domain_id', v_program.domain_id,
      'domain_name', v_program.domain_name,
      'mastery_criteria', coalesce(v_program.mastery_criteria, '{}'::jsonb),
      'advanced_settings', coalesce(v_program.advanced_settings, '{}'::jsonb),
      'version', v_program.version
    ),
    'opportunity_semantics', case
      when lower(coalesce(v_target.target_type,'')) in ('dtt','net','probe') then
        jsonb_build_object(
          'independent_response', 'PRIMARY_INDEPENDENT',
          'prompted_response', 'SUPPORT',
          'incorrect_response', 'PRIMARY_INDEPENDENT',
          'no_response', 'PRIMARY_INDEPENDENT'
        )
      else '{}'::jsonb
    end
  );
end;
$function$;

revoke all on function public.build_aba_v3_target_definition_snapshot_v1(text)
  from public, anon, authenticated;
grant execute on function public.build_aba_v3_target_definition_snapshot_v1(text)
  to service_role;

create or replace function public.sync_aba_v3_target_protocol_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_org uuid;
  v_actor uuid;
  v_now timestamptz := now();
  v_definition jsonb;
  v_hash text;
  v_current public.aba_collection_definition_versions_v3%rowtype;
  v_next_version integer;
  v_active_phase public.aba_target_phase_assignments_v3%rowtype;
  v_phase_type text;
  v_phase_key text;
  v_phase_label text;
  v_should_have_phase boolean := false;
  v_supported boolean := false;
begin
  -- Trigger should never broaden target scope or make a legacy malformed tenant fatal.
  v_org := public.aba_try_uuid_v3(coalesce(new.organization_id, new.clinic_id));
  v_actor := public.aba_try_uuid_v3(new.created_by);
  v_supported := lower(coalesce(new.target_type,'')) in ('dtt','net','probe','task_analysis','behavior');

  if v_org is null or new.patient_id is null or new.program_id is null or not v_supported then
    return new;
  end if;

  -- Serialize protocol evolution for this one target only.
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ABA_V3_TARGET_PROTOCOL:' || v_org::text || ':' || new.id, 0)
  );

  -- Confirm program/tenant binding before privileged metadata writes.
  if not exists (
    select 1
    from public.aba_programs p
    where p.id = new.program_id
      and p.patient_id = new.patient_id
      and p.clinic_id = v_org::text
  ) then
    raise exception 'ABA_V3_TARGET_PROTOCOL_PROGRAM_SCOPE_INVALID';
  end if;

  -- Definition versions intentionally exclude target.phase / clinical FSM state.
  -- A phase transition must break the series, not create a fake protocol version.
  v_definition := public.build_aba_v3_target_definition_snapshot_v1(new.id);
  v_hash := encode(digest(v_definition::text, 'sha256'), 'hex');

  select * into v_current
  from public.aba_collection_definition_versions_v3 d
  where d.organization_id = v_org
    and d.patient_id = new.patient_id
    and d.target_id = new.id
    and d.status = 'PUBLISHED'
    and d.deprecated_at is null
  order by d.version desc
  limit 1
  for update;

  if not found or v_current.definition_hash is distinct from v_hash or v_current.program_id is distinct from new.program_id then
    if found then
      update public.aba_collection_definition_versions_v3 d
      set status = 'DEPRECATED',
          deprecated_at = v_now
      where d.id = v_current.id
        and d.status = 'PUBLISHED'
        and d.deprecated_at is null;
    end if;

    select coalesce(max(d.version), 0) + 1
      into v_next_version
    from public.aba_collection_definition_versions_v3 d
    where d.target_id = new.id;

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
      new.patient_id,
      new.program_id,
      new.id,
      v_next_version,
      3,
      'PUBLISHED',
      v_definition,
      v_hash,
      v_now,
      v_actor
    );
  end if;

  -- Translate the user-managed target phase into a V3 time episode.
  -- States in which collection should not start are intentionally phase-less.
  case lower(coalesce(new.phase,''))
    when 'baseline' then
      v_should_have_phase := true; v_phase_type := 'baseline'; v_phase_key := 'baseline'; v_phase_label := 'Baseline';
    when 'teaching' then
      v_should_have_phase := true; v_phase_type := 'intervention'; v_phase_key := 'teaching'; v_phase_label := 'Ensino';
    when 'mastered' then
      v_should_have_phase := true; v_phase_type := 'maintenance'; v_phase_key := 'mastered'; v_phase_label := 'Domínio / manutenção';
    when 'maintenance' then
      v_should_have_phase := true; v_phase_type := 'maintenance'; v_phase_key := 'maintenance'; v_phase_label := 'Manutenção';
    when 'generalization' then
      v_should_have_phase := true; v_phase_type := 'generalization'; v_phase_key := 'generalization'; v_phase_label := 'Generalização';
    when 'regressed' then
      v_should_have_phase := true; v_phase_type := 'procedure_change'; v_phase_key := 'regressed'; v_phase_label := 'Regressão / reavaliação';
    else
      v_should_have_phase := false;
  end case;

  select * into v_active_phase
  from public.aba_target_phase_assignments_v3 ph
  where ph.organization_id = v_org
    and ph.patient_id = new.patient_id
    and ph.target_id = new.id
    and ph.effective_from <= v_now
    and (ph.effective_until is null or v_now < ph.effective_until)
  order by ph.effective_from desc
  limit 1
  for update;

  if v_should_have_phase then
    if found
       and v_active_phase.program_id is not distinct from new.program_id
       and v_active_phase.phase_key = v_phase_key
       and v_active_phase.phase_type = v_phase_type then
      return new;
    end if;

    if found then
      -- If the phase was created earlier in this same transaction, no committed
      -- history exists yet; adjust that uncommitted episode instead of creating
      -- an invalid zero-width range.
      if v_active_phase.effective_from = v_now then
        update public.aba_target_phase_assignments_v3 ph
        set program_id = new.program_id,
            phase_type = v_phase_type,
            phase_key = v_phase_key,
            label = v_phase_label,
            reason = 'ABA V3 automatic target phase synchronization'
        where ph.id = v_active_phase.id;
        return new;
      end if;

      update public.aba_target_phase_assignments_v3 ph
      set effective_until = v_now
      where ph.id = v_active_phase.id
        and ph.effective_until is null;
    end if;

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
      new.patient_id,
      new.program_id,
      new.id,
      null,
      v_phase_type,
      v_phase_key,
      v_phase_label,
      'ABA V3 automatic target phase synchronization',
      v_now,
      null,
      v_actor
    );
  elsif found then
    -- draft / on_hold / discontinued must not remain collection-ready.
    if v_active_phase.effective_from = v_now then
      delete from public.aba_target_phase_assignments_v3 ph
      where ph.id = v_active_phase.id
        and not exists (
          select 1 from public.aba_session_target_measurement_bindings b
          where b.target_phase_assignment_id = ph.id
        );
    else
      update public.aba_target_phase_assignments_v3 ph
      set effective_until = v_now
      where ph.id = v_active_phase.id
        and ph.effective_until is null;
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.sync_aba_v3_target_protocol_v1()
  from public, anon, authenticated, service_role;

-- Only clinically meaningful target fields trigger protocol reconciliation.
-- sort_order and other presentation-only changes do not create definition versions.
drop trigger if exists trg_sync_aba_v3_target_protocol_v1 on public.aba_targets;
create trigger trg_sync_aba_v3_target_protocol_v1
after insert or update of
  program_id,
  name,
  description,
  target_type,
  phase,
  measurement_type,
  protocol_id,
  protocol_title,
  domain_id,
  domain_name,
  objective_snapshot,
  mastery_criteria,
  program_version
on public.aba_targets
for each row
execute function public.sync_aba_v3_target_protocol_v1();

-- Installation is intentionally non-backfilling. Existing targets remain exactly
-- as they were; 06800 already attested current production coverage before install.
do $attest$
begin
  if to_regprocedure('public.build_aba_v3_target_definition_snapshot_v1(text)') is null then
    raise exception 'ABA_V3_TARGET_AUTObootstrap_BUILDER_MISSING';
  end if;
  if to_regprocedure('public.sync_aba_v3_target_protocol_v1()') is null then
    raise exception 'ABA_V3_TARGET_AUTObootstrap_TRIGGER_FUNCTION_MISSING';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.aba_targets'::regclass
      and t.tgname = 'trg_sync_aba_v3_target_protocol_v1'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ) then
    raise exception 'ABA_V3_TARGET_AUTObootstrap_TRIGGER_MISSING';
  end if;
  if coalesce(pg_catalog.has_function_privilege(
      'anon',
      pg_catalog.to_regprocedure('public.sync_aba_v3_target_protocol_v1()'),
      'EXECUTE'
    ), false)
    or coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      pg_catalog.to_regprocedure('public.sync_aba_v3_target_protocol_v1()'),
      'EXECUTE'
    ), false) then
    raise exception 'ABA_V3_TARGET_AUTObootstrap_BROWSER_EXECUTE_OPEN';
  end if;
end;
$attest$;

commit;

select jsonb_build_object(
  'gate','ABA_V3_TARGET_PROTOCOL_AUTObootstrap_INSTALLED',
  'default_on_policy_unchanged',true,
  'rollout_rows_mutated',false,
  'existing_targets_backfilled',false,
  'new_supported_targets_auto_definition',true,
  'active_target_phase_auto_versioned',true,
  'inactive_phase_states',jsonb_build_array('draft','on_hold','discontinued'),
  'task_analysis_requires_explicit_steps',true,
  'behavior_requires_non_abc_mapping',true,
  'browser_trigger_function_execute',false
) as aba_v3_target_protocol_autobootstrap_install;
