-- ABA V3 — target protocol auto-bootstrap pgcrypto schema hotfix.
--
-- Root cause:
--   pgcrypto is installed in schema `extensions`, while the trigger function
--   intentionally uses search_path = pg_catalog, public. The unqualified
--   digest(...) call therefore failed during target INSERT/UPDATE and the API
--   surfaced the database error as a generic therapeutic-plan schema 503.
--
-- Safety:
--   * changes only the trigger-function definition;
--   * does not touch clinical rows, sessions, trials, rollout states or bindings;
--   * does not execute the trigger for existing targets;
--   * browser EXECUTE remains closed.

begin;

do $preflight$
begin
  if to_regprocedure('extensions.digest(text,text)') is null then
    raise exception 'ABA_V3_AUTObootstrap_PGCRYPTO_DIGEST_MISSING';
  end if;

  if to_regprocedure('public.sync_aba_v3_target_protocol_v1()') is null then
    raise exception 'ABA_V3_AUTObootstrap_TRIGGER_FUNCTION_MISSING';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.aba_targets'::regclass
      and t.tgname = 'trg_sync_aba_v3_target_protocol_v1'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ) then
    raise exception 'ABA_V3_AUTObootstrap_TRIGGER_MISSING';
  end if;
end;
$preflight$;

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
  v_hash := encode(extensions.digest(v_definition::text, 'sha256'), 'hex');

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

do $attest$
declare
  v_def text;
begin
  select pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.sync_aba_v3_target_protocol_v1()')
  ) into v_def;

  if position('extensions.digest' in coalesce(v_def,'')) = 0 then
    raise exception 'ABA_V3_AUTObootstrap_PGCRYPTO_QUALIFICATION_NOT_APPLIED';
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
    raise exception 'ABA_V3_AUTObootstrap_BROWSER_EXECUTE_OPEN';
  end if;
end;
$attest$;

select jsonb_build_object(
  'gate', 'ABA_V3_TARGET_PROTOCOL_PGCRYPTO_SCHEMA_HOTFIX_READY',
  'digest_schema', 'extensions',
  'trigger_function_ready', to_regprocedure('public.sync_aba_v3_target_protocol_v1()') is not null,
  'trigger_enabled', exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.aba_targets'::regclass
      and t.tgname = 'trg_sync_aba_v3_target_protocol_v1'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ),
  'browser_execute', coalesce(pg_catalog.has_function_privilege(
    'authenticated',
    pg_catalog.to_regprocedure('public.sync_aba_v3_target_protocol_v1()'),
    'EXECUTE'
  ), false),
  'rollout_mutated', false,
  'clinical_rows_mutated', false
) as aba_v3_target_protocol_pgcrypto_schema_hotfix_install;

commit;
