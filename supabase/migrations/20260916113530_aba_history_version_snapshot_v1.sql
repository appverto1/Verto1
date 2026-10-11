-- Issue #186 — version-bound ABA history snapshot for NEW V3 session/target bindings only.
-- Forward-only, no historical backfill. Existing bindings remain untouched and therefore
-- explicitly legacy/unversioned for graph semantics that require this snapshot.

begin;

alter table public.aba_session_target_measurement_bindings
  add column if not exists program_version_id uuid,
  add column if not exists program_version_snapshot integer,
  add column if not exists measurement_type_snapshot text,
  add column if not exists target_status_snapshot text;

-- New V3 bindings must be born with enough immutable context to interpret their
-- future chart points without joining mutable current program/target state.
alter table public.aba_session_target_measurement_bindings
  drop constraint if exists aba_session_target_binding_history_snapshot_v1;
alter table public.aba_session_target_measurement_bindings
  add constraint aba_session_target_binding_history_snapshot_v1
  check (
    measurement_model_version <> 'V3'
    or (
      program_version_id is not null
      and program_version_snapshot is not null
      and program_version_snapshot > 0
      and nullif(btrim(measurement_type_snapshot), '') is not null
      and nullif(btrim(target_status_snapshot), '') is not null
    )
  ) not valid;

create index if not exists idx_aba_session_target_binding_history_snapshot_v1
  on public.aba_session_target_measurement_bindings
  (organization_id, patient_id, program_id, program_version_snapshot, target_id, decision_at desc)
  where measurement_model_version = 'V3' and program_version_id is not null;

create or replace function public.snapshot_aba_session_target_history_context_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_target public.aba_targets%rowtype;
  v_program public.aba_programs%rowtype;
  v_program_version public.aba_program_versions%rowtype;
  v_measurement_type text;
begin
  if new.measurement_model_version <> 'V3' then
    return new;
  end if;

  select * into v_target
  from public.aba_targets target
  where target.id = new.target_id
    and target.patient_id = new.patient_id
    and target.clinic_id = new.organization_id::text
    and target.program_id = new.program_id;

  if not found then
    raise exception 'ABA_V3_HISTORY_SNAPSHOT_TARGET_SCOPE_INVALID';
  end if;

  select * into v_program
  from public.aba_programs program
  where program.id = new.program_id
    and program.patient_id = new.patient_id
    and program.organization_id = new.organization_id::text;

  if not found then
    raise exception 'ABA_V3_HISTORY_SNAPSHOT_PROGRAM_SCOPE_INVALID';
  end if;

  if v_target.program_version is null or v_target.program_version <= 0 then
    raise exception 'ABA_V3_HISTORY_SNAPSHOT_PROGRAM_VERSION_REQUIRED';
  end if;

  select * into v_program_version
  from public.aba_program_versions version_row
  where version_row.organization_id = new.organization_id::text
    and version_row.patient_id = new.patient_id
    and version_row.program_id = new.program_id
    and version_row.version = v_target.program_version
  limit 1;

  if not found then
    raise exception 'ABA_V3_HISTORY_SNAPSHOT_PROGRAM_VERSION_NOT_FOUND';
  end if;

  v_measurement_type := coalesce(
    nullif(btrim(v_target.measurement_type), ''),
    nullif(btrim(v_program.measurement_type), '')
  );

  if v_measurement_type is null then
    raise exception 'ABA_V3_HISTORY_SNAPSHOT_MEASUREMENT_TYPE_REQUIRED';
  end if;

  if nullif(btrim(v_target.phase), '') is null then
    raise exception 'ABA_V3_HISTORY_SNAPSHOT_TARGET_STATUS_REQUIRED';
  end if;

  new.program_version_id := v_program_version.id;
  new.program_version_snapshot := v_target.program_version;
  new.measurement_type_snapshot := v_measurement_type;
  new.target_status_snapshot := v_target.phase;

  return new;
end;
$function$;

-- Runs before the existing scope validator and immutable guard becomes relevant.
-- Snapshot and binding are one INSERT/transaction: either both persist or neither does.
drop trigger if exists snapshot_aba_session_target_history_context_v1
  on public.aba_session_target_measurement_bindings;
create trigger snapshot_aba_session_target_history_context_v1
before insert on public.aba_session_target_measurement_bindings
for each row execute function public.snapshot_aba_session_target_history_context_v1();

revoke all on function public.snapshot_aba_session_target_history_context_v1() from public, anon, authenticated;
grant execute on function public.snapshot_aba_session_target_history_context_v1() to service_role;

comment on column public.aba_session_target_measurement_bindings.program_version_id is
  'Immutable program-version ledger reference captured for NEW V3 bindings; NULL on legacy rows means LEGACY_UNVERSIONED.';
comment on column public.aba_session_target_measurement_bindings.program_version_snapshot is
  'Program version number captured atomically when a NEW V3 session/target binding is created.';
comment on column public.aba_session_target_measurement_bindings.measurement_type_snapshot is
  'Canonical target/program measurement type captured atomically for NEW V3 bindings.';
comment on column public.aba_session_target_measurement_bindings.target_status_snapshot is
  'Canonical aba_targets.phase captured atomically for NEW V3 bindings; never inferred later for historical points.';

commit;
