-- ABA Measurement V3 - PR2 immutable session + target binding resolver.
-- Additive only. No ABA V2 table/route is mutated by this migration.
-- The resolver is service-role only and V3 remains dark until rollout rows are
-- explicitly enabled in a later pilot operation.

begin;

-- Extra immutable audit context for the decision that selected LEGACY_V2/V3.
-- PR1 had no supported binding writer, so a first PR2 install expects the dark
-- binding table to still be empty. This avoids mutating an immutable clinical row.
do $binding_upgrade$
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = 'public.aba_session_target_measurement_bindings'::regclass
      and attribute.attname = 'decision_at'
      and not attribute.attisdropped
  ) and exists (
    select 1 from public.aba_session_target_measurement_bindings
  ) then
    raise exception 'ABA_V3_PR2_EXPECTED_EMPTY_DARK_BINDING_TABLE';
  end if;
end;
$binding_upgrade$;

alter table public.aba_session_target_measurement_bindings
  add column if not exists decision_at timestamptz not null;

alter table public.aba_session_target_measurement_bindings
  add column if not exists binding_reason text not null default 'PR2_RESOLVER';

alter table public.aba_session_target_measurement_bindings
  add column if not exists rollout_snapshot jsonb not null default '{}'::jsonb;

alter table public.aba_session_target_measurement_bindings
  alter column decision_at set not null;
alter table public.aba_session_target_measurement_bindings
  alter column binding_reason set not null;
alter table public.aba_session_target_measurement_bindings
  alter column rollout_snapshot set not null;

alter table public.aba_session_target_measurement_bindings
  drop constraint if exists aba_session_target_binding_rollout_snapshot_object_v3;

alter table public.aba_session_target_measurement_bindings
  add constraint aba_session_target_binding_rollout_snapshot_object_v3
  check (jsonb_typeof(rollout_snapshot) = 'object');

create index if not exists idx_aba_session_target_binding_v3_decision
  on public.aba_session_target_measurement_bindings
  (organization_id, patient_id, decision_at desc, target_id);

-- Emergency continuity bridge. There is intentionally no browser/API writer in
-- PR2. A future audited operational flow may create these rows if a V3 target must
-- temporarily continue collection without pretending that V3 reverted to V2.
create table if not exists public.aba_emergency_legacy_bridges_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  program_id text references public.aba_programs(id) on delete restrict,
  target_id text not null references public.aba_targets(id) on delete restrict,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'CLOSED', 'CANCELLED')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  reason text not null,
  authorized_by uuid not null,
  closed_by uuid,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aba_emergency_legacy_bridge_v3_window
    check (ends_at is null or ends_at > starts_at),
  constraint aba_emergency_legacy_bridge_v3_closure
    check (
      (status = 'ACTIVE' and closed_at is null)
      or
      (status in ('CLOSED', 'CANCELLED') and closed_at is not null)
    ),
  unique (id, organization_id, patient_id, target_id)
);

create unique index if not exists ux_aba_emergency_legacy_bridge_v3_active_target
  on public.aba_emergency_legacy_bridges_v3 (organization_id, patient_id, target_id)
  where status = 'ACTIVE';

create index if not exists idx_aba_emergency_legacy_bridge_v3_timeline
  on public.aba_emergency_legacy_bridges_v3
  (organization_id, patient_id, target_id, starts_at desc);

create table if not exists public.aba_emergency_legacy_bridge_events_v3 (
  id uuid primary key default gen_random_uuid(),
  bridge_id uuid not null references public.aba_emergency_legacy_bridges_v3(id) on delete restrict,
  organization_id uuid not null references public.clinics(id) on delete restrict,
  event_type text not null check (event_type in ('CREATED', 'CLOSED', 'CANCELLED')),
  before_state jsonb,
  after_state jsonb not null,
  actor_id uuid,
  occurred_at timestamptz not null default now(),
  constraint aba_emergency_bridge_event_before_object_v3
    check (before_state is null or jsonb_typeof(before_state) = 'object'),
  constraint aba_emergency_bridge_event_after_object_v3
    check (jsonb_typeof(after_state) = 'object')
);

create index if not exists idx_aba_emergency_legacy_bridge_events_v3
  on public.aba_emergency_legacy_bridge_events_v3
  (organization_id, bridge_id, occurred_at desc);

-- Reuse PR1 scope validation for the bridge's tenant/patient/program/target shape.
drop trigger if exists validate_aba_emergency_legacy_bridge_scope_v3
  on public.aba_emergency_legacy_bridges_v3;
create trigger validate_aba_emergency_legacy_bridge_scope_v3
before insert or update on public.aba_emergency_legacy_bridges_v3
for each row execute function public.validate_aba_v3_foundation_scope();

-- Rollout identity is immutable. Only state, effective time, reason and actor may
-- change. A state change MUST get a fresh, non-backdated effective_from so offline
-- sessions can resolve the gate that was actually in effect at session.started_at.
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

drop trigger if exists guard_aba_measurement_rollout_identity_v3
  on public.aba_measurement_rollout_states_v3;
create trigger guard_aba_measurement_rollout_identity_v3
before insert or update or delete on public.aba_measurement_rollout_states_v3
for each row execute function public.guard_aba_measurement_rollout_identity_v3();

-- Bridge lifecycle is auditable and its clinical identity/time origin cannot be
-- rewritten after creation.
create or replace function public.guard_aba_emergency_legacy_bridge_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'ABA_V3_EMERGENCY_BRIDGE_DELETE_FORBIDDEN';
  end if;

  if old.id is distinct from new.id
     or old.organization_id is distinct from new.organization_id
     or old.patient_id is distinct from new.patient_id
     or old.program_id is distinct from new.program_id
     or old.target_id is distinct from new.target_id
     or old.starts_at is distinct from new.starts_at
     or old.reason is distinct from new.reason
     or old.authorized_by is distinct from new.authorized_by
     or old.created_at is distinct from new.created_at then
    raise exception 'ABA_V3_EMERGENCY_BRIDGE_IDENTITY_IMMUTABLE';
  end if;

  if old.status <> 'ACTIVE' then
    raise exception 'ABA_V3_EMERGENCY_BRIDGE_ALREADY_FINAL';
  end if;

  if new.status not in ('CLOSED', 'CANCELLED') then
    raise exception 'ABA_V3_EMERGENCY_BRIDGE_INVALID_TRANSITION';
  end if;

  if new.closed_at is null or new.closed_by is null then
    raise exception 'ABA_V3_EMERGENCY_BRIDGE_CLOSURE_AUDIT_REQUIRED';
  end if;

  new.updated_at := now();
  if new.ends_at is null then
    new.ends_at := new.closed_at;
  end if;

  return new;
end;
$function$;

drop trigger if exists guard_aba_emergency_legacy_bridge_v3
  on public.aba_emergency_legacy_bridges_v3;
create trigger guard_aba_emergency_legacy_bridge_v3
before update or delete on public.aba_emergency_legacy_bridges_v3
for each row execute function public.guard_aba_emergency_legacy_bridge_v3();

create or replace function public.audit_aba_emergency_legacy_bridge_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  insert into public.aba_emergency_legacy_bridge_events_v3 (
    bridge_id,
    organization_id,
    event_type,
    before_state,
    after_state,
    actor_id
  ) values (
    new.id,
    new.organization_id,
    case
      when tg_op = 'INSERT' then 'CREATED'
      when new.status = 'CLOSED' then 'CLOSED'
      else 'CANCELLED'
    end,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new),
    case
      when tg_op = 'INSERT' then new.authorized_by
      else new.closed_by
    end
  );

  return new;
end;
$function$;

drop trigger if exists audit_aba_emergency_legacy_bridge_v3
  on public.aba_emergency_legacy_bridges_v3;
create trigger audit_aba_emergency_legacy_bridge_v3
after insert or update on public.aba_emergency_legacy_bridges_v3
for each row execute function public.audit_aba_emergency_legacy_bridge_v3();

create or replace function public.guard_aba_emergency_legacy_bridge_event_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'ABA_V3_EMERGENCY_BRIDGE_EVENT_APPEND_ONLY';
end;
$function$;

drop trigger if exists guard_aba_emergency_legacy_bridge_event_v3
  on public.aba_emergency_legacy_bridge_events_v3;
create trigger guard_aba_emergency_legacy_bridge_event_v3
before update or delete on public.aba_emergency_legacy_bridge_events_v3
for each row execute function public.guard_aba_emergency_legacy_bridge_event_v3();

-- Return the latest rollout state for one immutable scope as it was effective at
-- p_decision_at. It reads append-only rollout events, not the mutable current row,
-- which protects late/offline session sync from mid-session upgrades.
create or replace function public.get_aba_rollout_scope_state_at_v3(
  p_organization_id uuid,
  p_scope_type text,
  p_patient_id uuid default null,
  p_program_id text default null,
  p_target_id text default null,
  p_decision_at timestamptz default now()
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
  select event.after_state
  from public.aba_measurement_rollout_events_v3 event
  where event.organization_id = p_organization_id
    and upper(coalesce(event.after_state ->> 'scope_type', '')) = upper(p_scope_type)
    and (
      (upper(p_scope_type) = 'CLINIC'
       and nullif(event.after_state ->> 'patient_id', '') is null
       and nullif(event.after_state ->> 'program_id', '') is null
       and nullif(event.after_state ->> 'target_id', '') is null)
      or
      (upper(p_scope_type) = 'PATIENT'
       and nullif(event.after_state ->> 'patient_id', '')::uuid = p_patient_id
       and nullif(event.after_state ->> 'program_id', '') is null
       and nullif(event.after_state ->> 'target_id', '') is null)
      or
      (upper(p_scope_type) = 'PROGRAM'
       and nullif(event.after_state ->> 'patient_id', '')::uuid = p_patient_id
       and event.after_state ->> 'program_id' = p_program_id
       and nullif(event.after_state ->> 'target_id', '') is null)
      or
      (upper(p_scope_type) = 'TARGET'
       and nullif(event.after_state ->> 'patient_id', '')::uuid = p_patient_id
       and event.after_state ->> 'program_id' = p_program_id
       and event.after_state ->> 'target_id' = p_target_id)
    )
    and event.occurred_at <= p_decision_at
    and coalesce(
      nullif(event.after_state ->> 'effective_from', '')::timestamptz,
      event.occurred_at
    ) <= p_decision_at
  order by
    coalesce(
      nullif(event.after_state ->> 'effective_from', '')::timestamptz,
      event.occurred_at
    ) desc,
    event.state_version desc,
    event.occurred_at desc
  limit 1;
$function$;

-- Pilot semantics are deliberately fail-closed:
--   CLINIC must be enabled
--   PATIENT cohort must be enabled
--   TARGET state wins over PROGRAM state; one of them must be enabled
-- New V3 bindings require BOTH allow_new_v3_sessions and accept_v3_sync at all
-- applicable gates. This prevents a target from producing data before sync ingest
-- has been deliberately prepared.
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
  v_allow boolean := false;
  v_accept boolean := false;
begin
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

  if v_target is not null then
    v_enrollment := v_target;
    v_enrollment_scope := 'TARGET';
  else
    v_enrollment := v_program;
    v_enrollment_scope := case when v_program is null then null else 'PROGRAM' end;
  end if;

  v_allow :=
    coalesce((v_clinic ->> 'allow_new_v3_sessions')::boolean, false)
    and coalesce((v_patient ->> 'allow_new_v3_sessions')::boolean, false)
    and coalesce((v_enrollment ->> 'allow_new_v3_sessions')::boolean, false);

  v_accept :=
    coalesce((v_clinic ->> 'accept_v3_sync')::boolean, false)
    and coalesce((v_patient ->> 'accept_v3_sync')::boolean, false)
    and coalesce((v_enrollment ->> 'accept_v3_sync')::boolean, false);

  return jsonb_build_object(
    'decision_at', p_decision_at,
    'allow_new_v3_sessions', v_allow,
    'accept_v3_sync', v_accept,
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

-- The only supported writer for PR2 bindings. Existing binding wins forever.
-- The decision timestamp is session.started_at, not request/sync time.
create or replace function public.resolve_aba_session_target_measurement_binding_v1(
  p_organization_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_target_id text,
  p_actor_id uuid default null
)
returns public.aba_session_target_measurement_bindings
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_existing public.aba_session_target_measurement_bindings%rowtype;
  v_result public.aba_session_target_measurement_bindings%rowtype;
  v_session public.aba_sessions%rowtype;
  v_target public.aba_targets%rowtype;
  v_program_id text;
  v_rollout jsonb;
  v_definition public.aba_collection_definition_versions_v3%rowtype;
  v_phase public.aba_target_phase_assignments_v3%rowtype;
  v_bridge public.aba_emergency_legacy_bridges_v3%rowtype;
  v_enrollment_state_id uuid;
  v_enrollment_state_version bigint;
  v_binding_model text;
  v_binding_reason text;
begin
  if p_organization_id is null or p_patient_id is null
     or nullif(trim(p_session_id), '') is null
     or nullif(trim(p_target_id), '') is null then
    raise exception 'ABA_V3_BINDING_ARGUMENTS_REQUIRED';
  end if;

  -- Serialize only this session+target decision; unrelated targets never contend.
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_session_id || ':' || p_target_id,
      0
    )
  );

  select *
    into v_existing
  from public.aba_session_target_measurement_bindings binding
  where binding.session_id = p_session_id
    and binding.target_id = p_target_id;

  if found then
    if v_existing.organization_id is distinct from p_organization_id
       or v_existing.patient_id is distinct from p_patient_id then
      raise exception 'ABA_V3_EXISTING_BINDING_SCOPE_MISMATCH';
    end if;
    return v_existing;
  end if;

  select *
    into v_session
  from public.aba_sessions session
  where session.id = p_session_id;

  if not found
     or v_session.patient_id is distinct from p_patient_id
     or v_session.clinic_id is distinct from p_organization_id::text then
    raise exception 'ABA_V3_SESSION_SCOPE_INVALID';
  end if;

  select *
    into v_target
  from public.aba_targets target
  where target.id = p_target_id;

  if not found
     or v_target.patient_id is distinct from p_patient_id
     or v_target.clinic_id is distinct from p_organization_id::text then
    raise exception 'ABA_V3_TARGET_SCOPE_INVALID';
  end if;

  v_program_id := v_target.program_id;
  if v_program_id is null then
    raise exception 'ABA_V3_TARGET_PROGRAM_REQUIRED';
  end if;

  -- An explicit emergency bridge is a separate measurement episode. It does not
  -- mutate the target back to V2 and is intentionally only creatable server-side.
  select *
    into v_bridge
  from public.aba_emergency_legacy_bridges_v3 bridge
  where bridge.organization_id = p_organization_id
    and bridge.patient_id = p_patient_id
    and bridge.target_id = p_target_id
    and bridge.status = 'ACTIVE'
    and bridge.starts_at <= v_session.started_at
    and (bridge.ends_at is null or v_session.started_at < bridge.ends_at)
  order by bridge.starts_at desc
  limit 1;

  if found then
    v_binding_model := 'EMERGENCY_LEGACY_BRIDGE';
    v_binding_reason := 'ACTIVE_EMERGENCY_LEGACY_BRIDGE';
    v_rollout := jsonb_build_object(
      'decision_at', v_session.started_at,
      'emergency_bridge_id', v_bridge.id,
      'emergency_bridge', true
    );
  else
    v_rollout := public.resolve_aba_measurement_rollout_snapshot_v3(
      p_organization_id,
      p_patient_id,
      v_program_id,
      p_target_id,
      v_session.started_at
    );

    if coalesce((v_rollout ->> 'allow_new_v3_sessions')::boolean, false) = false then
      v_binding_model := 'LEGACY_V2';
      v_binding_reason := 'ROLLOUT_NOT_ENABLED_AT_SESSION_START';
    else
      if coalesce((v_rollout ->> 'accept_v3_sync')::boolean, false) = false then
        raise exception 'ABA_V3_SYNC_NOT_READY_FOR_NEW_BINDING';
      end if;

      -- Historical validity: a definition deprecated after session start remains
      -- valid for that late/offline session. An archived/deprecated definition is
      -- not used for a session that starts after deprecated_at.
      select *
        into v_definition
      from public.aba_collection_definition_versions_v3 definition
      where definition.organization_id = p_organization_id
        and definition.patient_id = p_patient_id
        and definition.target_id = p_target_id
        and definition.program_id = v_program_id
        and definition.published_at <= v_session.started_at
        and (
          definition.deprecated_at is null
          or v_session.started_at < definition.deprecated_at
        )
      order by definition.version desc
      limit 1;

      if not found then
        raise exception 'ABA_V3_COLLECTION_DEFINITION_MISSING_AT_SESSION_START';
      end if;

      select *
        into v_phase
      from public.aba_target_phase_assignments_v3 phase
      where phase.organization_id = p_organization_id
        and phase.patient_id = p_patient_id
        and phase.target_id = p_target_id
        and phase.program_id = v_program_id
        and phase.effective_from <= v_session.started_at
        and (
          phase.effective_until is null
          or v_session.started_at < phase.effective_until
        )
      order by phase.effective_from desc
      limit 1;

      if not found then
        raise exception 'ABA_V3_TARGET_PHASE_MISSING_AT_SESSION_START';
      end if;

      v_binding_model := 'V3';
      v_binding_reason := 'ROLLOUT_ENABLED_AT_SESSION_START';
      v_enrollment_state_id := nullif(v_rollout ->> 'enrollment_state_id', '')::uuid;
      v_enrollment_state_version := nullif(v_rollout ->> 'enrollment_state_version', '')::bigint;
    end if;
  end if;

  insert into public.aba_session_target_measurement_bindings (
    organization_id,
    patient_id,
    session_id,
    program_id,
    target_id,
    measurement_model_version,
    collection_definition_version_id,
    target_phase_assignment_id,
    rollout_state_id,
    rollout_state_version,
    binding_source,
    decision_at,
    binding_reason,
    rollout_snapshot,
    bound_at,
    bound_by
  ) values (
    p_organization_id,
    p_patient_id,
    p_session_id,
    v_program_id,
    p_target_id,
    v_binding_model,
    case when v_binding_model = 'V3' then v_definition.id else null end,
    case when v_binding_model = 'V3' then v_phase.id else null end,
    case when v_binding_model = 'V3' then v_enrollment_state_id else null end,
    case when v_binding_model = 'V3' then v_enrollment_state_version else null end,
    'SERVER_RESOLVER',
    v_session.started_at,
    v_binding_reason,
    coalesce(v_rollout, '{}'::jsonb),
    now(),
    p_actor_id
  )
  returning * into v_result;

  return v_result;
exception
  when unique_violation then
    -- Defensive retry safety if an external writer raced before the advisory lock
    -- convention existed. Never mutate whichever immutable binding won.
    select *
      into v_existing
    from public.aba_session_target_measurement_bindings binding
    where binding.session_id = p_session_id
      and binding.target_id = p_target_id;

    if found
       and v_existing.organization_id = p_organization_id
       and v_existing.patient_id = p_patient_id then
      return v_existing;
    end if;
    raise;
end;
$function$;

-- PR2 remains dark/fail-closed from browsers. Only backend service-role may use
-- resolver functions; direct table writes are not opened to authenticated users.
alter table public.aba_emergency_legacy_bridges_v3 enable row level security;
alter table public.aba_emergency_legacy_bridge_events_v3 enable row level security;

revoke all on table public.aba_emergency_legacy_bridges_v3 from public, anon, authenticated;
revoke all on table public.aba_emergency_legacy_bridge_events_v3 from public, anon, authenticated;
grant all on table public.aba_emergency_legacy_bridges_v3 to service_role;
grant all on table public.aba_emergency_legacy_bridge_events_v3 to service_role;

revoke all on function public.guard_aba_measurement_rollout_identity_v3() from public, anon, authenticated;
revoke all on function public.guard_aba_emergency_legacy_bridge_v3() from public, anon, authenticated;
revoke all on function public.audit_aba_emergency_legacy_bridge_v3() from public, anon, authenticated;
revoke all on function public.guard_aba_emergency_legacy_bridge_event_v3() from public, anon, authenticated;
revoke all on function public.get_aba_rollout_scope_state_at_v3(uuid, text, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.resolve_aba_measurement_rollout_snapshot_v3(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.resolve_aba_session_target_measurement_binding_v1(uuid, uuid, text, text, uuid) from public, anon, authenticated;

grant execute on function public.get_aba_rollout_scope_state_at_v3(uuid, text, uuid, text, text, timestamptz) to service_role;
grant execute on function public.resolve_aba_measurement_rollout_snapshot_v3(uuid, uuid, text, text, timestamptz) to service_role;
grant execute on function public.resolve_aba_session_target_measurement_binding_v1(uuid, uuid, text, text, uuid) to service_role;

-- Explicit PR2 invariant: no rollout row is created/enabled here and no V2 table
-- is altered. Existing V2 sessions continue to complete using the legacy routes.

commit;
