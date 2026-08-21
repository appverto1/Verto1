-- Verto Clinical Measurement Engine V3 - Migration B: sessions & expectations.
-- Additive/dark only. Creates the universal clinical-session identity, the frozen
-- expected measurement set for each session, and logical collection streams.
-- Does not mutate ABA V2, the existing ABA V3 implementation, routes, or writers.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Universal clinical measurement session.
-- clinical_date is derived exactly once from started_at + timezone_snapshot and
-- is then immutable. It is intentionally distinct from event occurrence dates.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_sessions_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_key text not null,
  source_kind text not null default 'NATIVE_V3'
    check (source_kind in ('NATIVE_V3', 'ABA_SESSION')),
  aba_session_id text references public.aba_sessions(id) on delete restrict,
  status text not null default 'PREPARING'
    check (status in ('PREPARING', 'OPEN', 'FINALIZED', 'CANCELED')),
  started_at timestamptz not null,
  ended_at timestamptz,
  clinical_date date not null,
  clinical_date_policy text not null default 'SESSION_START_LOCAL_DATE'
    check (clinical_date_policy = 'SESSION_START_LOCAL_DATE'),
  timezone_snapshot text not null,
  timezone_offset_minutes integer not null
    check (timezone_offset_minutes between -900 and 900),
  recorded_at timestamptz not null default now(),
  expectations_sealed_at timestamptz,
  finalized_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cmv3_session_key_nonempty
    check (length(trim(session_key)) between 1 and 180),
  constraint cmv3_session_time_window
    check (ended_at is null or ended_at >= started_at),
  constraint cmv3_session_finalize_shape
    check (
      (status = 'FINALIZED' and ended_at is not null and finalized_at is not null)
      or (status <> 'FINALIZED' and finalized_at is null)
    ),
  constraint cmv3_session_expectation_seal_shape
    check (
      (status = 'PREPARING' and expectations_sealed_at is null)
      or (status in ('OPEN', 'FINALIZED') and expectations_sealed_at is not null)
      or status = 'CANCELED'
    ),
  constraint cmv3_session_source_shape check (
    (source_kind = 'NATIVE_V3' and aba_session_id is null)
    or (source_kind = 'ABA_SESSION' and aba_session_id is not null)
  ),
  unique (organization_id, patient_id, session_key),
  unique (id, organization_id, patient_id)
);

create unique index if not exists ux_cmv3_session_aba_source
  on public.clinical_measurement_sessions_v3 (organization_id, aba_session_id)
  where source_kind = 'ABA_SESSION';
create index if not exists idx_cmv3_sessions_patient_timeline
  on public.clinical_measurement_sessions_v3
  (organization_id, patient_id, clinical_date desc, started_at desc);
create index if not exists idx_cmv3_sessions_status
  on public.clinical_measurement_sessions_v3
  (organization_id, status, started_at desc);

-- ---------------------------------------------------------------------------
-- Frozen expected measurement set for a session.
-- A row means this measurement was explicitly expected for this session. We do
-- not materialize NOT_COLLECTED/NOT_SCHEDULED rows. Missingness is derived later
-- by comparing these expectations with accepted raw observations.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_session_expectations_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id uuid not null,
  target_id uuid not null,
  protocol_snapshot_id uuid not null,
  expectation_key text not null,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cmv3_expectation_key_nonempty
    check (length(trim(expectation_key)) between 1 and 180),
  foreign key (session_id, organization_id, patient_id)
    references public.clinical_measurement_sessions_v3(id, organization_id, patient_id)
    on delete restrict,
  foreign key (target_id, organization_id, patient_id)
    references public.clinical_measurement_targets_v3(id, organization_id, patient_id)
    on delete restrict,
  foreign key (protocol_snapshot_id, organization_id, patient_id, target_id)
    references public.clinical_collection_protocol_snapshots_v3(
      id, organization_id, patient_id, target_id
    ) on delete restrict,
  unique (session_id, expectation_key),
  unique (session_id, protocol_snapshot_id),
  unique (id, organization_id, patient_id, session_id, target_id)
);

create index if not exists idx_cmv3_expectations_session
  on public.clinical_measurement_session_expectations_v3
  (organization_id, patient_id, session_id, target_id);
create index if not exists idx_cmv3_expectations_target
  on public.clinical_measurement_session_expectations_v3
  (organization_id, patient_id, target_id, session_id);

-- ---------------------------------------------------------------------------
-- Logical collection stream. Device changes do not create a new PRIMARY stream.
-- Observation slices and raw events added later will bind to this stable identity.
-- One PRIMARY stream exists per expectation; RELIABILITY streams may be multiple
-- but must point to that expectation's PRIMARY stream.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_collection_streams_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id uuid not null,
  expectation_id uuid not null,
  target_id uuid not null,
  stream_key text not null,
  stream_role text not null
    check (stream_role in ('PRIMARY', 'RELIABILITY')),
  observer_membership_id uuid not null references public.clinic_memberships(id) on delete restrict,
  paired_primary_stream_id uuid,
  status text not null default 'OPEN'
    check (status in ('OPEN', 'CLOSED')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cmv3_stream_key_nonempty
    check (length(trim(stream_key)) between 1 and 180),
  constraint cmv3_stream_close_shape
    check ((status = 'OPEN' and closed_at is null) or (status = 'CLOSED' and closed_at is not null)),
  constraint cmv3_stream_pair_shape check (
    (stream_role = 'PRIMARY' and paired_primary_stream_id is null)
    or (stream_role = 'RELIABILITY' and paired_primary_stream_id is not null)
  ),
  foreign key (session_id, organization_id, patient_id)
    references public.clinical_measurement_sessions_v3(id, organization_id, patient_id)
    on delete restrict,
  foreign key (expectation_id, organization_id, patient_id, session_id, target_id)
    references public.clinical_measurement_session_expectations_v3(
      id, organization_id, patient_id, session_id, target_id
    ) on delete restrict,
  unique (session_id, expectation_id, stream_key),
  unique (id, organization_id, patient_id, session_id, expectation_id, target_id)
);

create unique index if not exists ux_cmv3_primary_stream_per_expectation
  on public.clinical_measurement_collection_streams_v3 (expectation_id)
  where stream_role = 'PRIMARY';
create unique index if not exists ux_cmv3_reliability_stream_per_observer
  on public.clinical_measurement_collection_streams_v3 (expectation_id, observer_membership_id)
  where stream_role = 'RELIABILITY';
create index if not exists idx_cmv3_streams_session
  on public.clinical_measurement_collection_streams_v3
  (organization_id, patient_id, session_id, expectation_id, stream_role);

-- Self-reference is added after table creation so RELIABILITY can point only to a
-- stream identity in the same tenant/session/expectation/target scope. Role is
-- additionally validated by trigger below.
do $cmv3_stream_pair_fk$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_collection_streams_v3'::regclass
      and conname = 'cmv3_stream_paired_primary_scope_fkey'
  ) then
    alter table public.clinical_measurement_collection_streams_v3
      add constraint cmv3_stream_paired_primary_scope_fkey
      foreign key (
        paired_primary_stream_id,
        organization_id,
        patient_id,
        session_id,
        expectation_id,
        target_id
      ) references public.clinical_measurement_collection_streams_v3 (
        id,
        organization_id,
        patient_id,
        session_id,
        expectation_id,
        target_id
      ) on delete restrict;
  end if;
end;
$cmv3_stream_pair_fk$;

-- ---------------------------------------------------------------------------
-- Server-owned temporal normalization and scope validation.
-- ---------------------------------------------------------------------------
create or replace function public.prepare_clinical_measurement_session_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_timezone text;
begin
  select zone.name
    into v_timezone
  from pg_catalog.pg_timezone_names zone
  where zone.name = nullif(trim(new.timezone_snapshot), '')
  limit 1;

  if v_timezone is null then
    raise exception 'CMV3_SESSION_TIMEZONE_INVALID';
  end if;

  new.timezone_snapshot := v_timezone;
  new.clinical_date := timezone(v_timezone, new.started_at)::date;
  new.timezone_offset_minutes := round(
    extract(epoch from (
      timezone(v_timezone, new.started_at)
      - timezone('UTC', new.started_at)
    )) / 60.0
  )::integer;
  new.recorded_at := clock_timestamp();
  new.created_at := new.recorded_at;

  if new.status <> 'PREPARING' then
    raise exception 'CMV3_SESSION_INSERT_MUST_PREPARE';
  end if;

  if new.ended_at is not null then
    raise exception 'CMV3_SESSION_PREPARING_END_FORBIDDEN';
  end if;

  new.expectations_sealed_at := null;
  new.finalized_at := null;

  return new;
end;
$function$;

create or replace function public.validate_clinical_measurement_session_scope_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_patient_clinic_id uuid;
  v_legacy_patient_id uuid;
  v_legacy_clinic_id text;
begin
  select patient.clinic_id
    into v_patient_clinic_id
  from public.patients patient
  where patient.id = new.patient_id;

  if not found or v_patient_clinic_id is distinct from new.organization_id then
    raise exception 'CMV3_SESSION_PATIENT_SCOPE_INVALID';
  end if;

  if new.source_kind = 'ABA_SESSION' then
    select session_row.patient_id, session_row.clinic_id
      into v_legacy_patient_id, v_legacy_clinic_id
    from public.aba_sessions session_row
    where session_row.id = new.aba_session_id;

    if not found
       or v_legacy_patient_id is distinct from new.patient_id
       or v_legacy_clinic_id is distinct from new.organization_id::text then
      raise exception 'CMV3_ABA_SESSION_SCOPE_INVALID';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.guard_clinical_measurement_session_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'CMV3_SESSION_DELETE_FORBIDDEN';
  end if;

  if (to_jsonb(old) - array['status', 'ended_at', 'expectations_sealed_at', 'finalized_at']::text[])
     is distinct from
     (to_jsonb(new) - array['status', 'ended_at', 'expectations_sealed_at', 'finalized_at']::text[]) then
    raise exception 'CMV3_SESSION_IDENTITY_IMMUTABLE';
  end if;

  if old.status in ('FINALIZED', 'CANCELED') then
    raise exception 'CMV3_SESSION_TERMINAL_STATE_IMMUTABLE';
  end if;

  if old.status = 'PREPARING' then
    if new.status = 'PREPARING' then
      if new.ended_at is not null
         or new.expectations_sealed_at is not null
         or new.finalized_at is not null then
        raise exception 'CMV3_SESSION_PREPARING_TEMPORAL_MUTATION_FORBIDDEN';
      end if;
      return new;
    end if;

    if new.status = 'OPEN' then
      if new.ended_at is not null or new.finalized_at is not null then
        raise exception 'CMV3_SESSION_OPEN_SHAPE_INVALID';
      end if;
      if not exists (
        select 1
        from public.clinical_measurement_session_expectations_v3 expectation
        where expectation.session_id = old.id
      ) then
        raise exception 'CMV3_SESSION_EXPECTATION_SET_EMPTY';
      end if;
      new.expectations_sealed_at := clock_timestamp();
      return new;
    end if;

    if new.status = 'CANCELED' then
      if exists (
        select 1
        from public.clinical_measurement_collection_streams_v3 stream
        where stream.session_id = old.id
          and stream.status = 'OPEN'
      ) then
        raise exception 'CMV3_SESSION_OPEN_STREAMS_EXIST';
      end if;
      new.expectations_sealed_at := old.expectations_sealed_at;
      new.finalized_at := null;
      return new;
    end if;

    raise exception 'CMV3_SESSION_STATUS_TRANSITION_INVALID';
  end if;

  if old.status = 'OPEN' then
    if new.status = 'OPEN' then
      if new.ended_at is distinct from old.ended_at
         or new.expectations_sealed_at is distinct from old.expectations_sealed_at
         or new.finalized_at is distinct from old.finalized_at then
        raise exception 'CMV3_SESSION_OPEN_TEMPORAL_MUTATION_FORBIDDEN';
      end if;
      return new;
    end if;

    if new.status in ('FINALIZED', 'CANCELED') and exists (
      select 1
      from public.clinical_measurement_collection_streams_v3 stream
      where stream.session_id = old.id
        and stream.status = 'OPEN'
    ) then
      raise exception 'CMV3_SESSION_OPEN_STREAMS_EXIST';
    end if;

    if new.status = 'FINALIZED' then
      if new.ended_at is null or new.ended_at < old.started_at then
        raise exception 'CMV3_SESSION_FINALIZED_END_INVALID';
      end if;
      new.expectations_sealed_at := old.expectations_sealed_at;
      new.finalized_at := clock_timestamp();
      return new;
    end if;

    if new.status = 'CANCELED' then
      new.expectations_sealed_at := old.expectations_sealed_at;
      new.finalized_at := null;
      return new;
    end if;

    raise exception 'CMV3_SESSION_STATUS_TRANSITION_INVALID';
  end if;

  raise exception 'CMV3_SESSION_STATUS_TRANSITION_INVALID';
end;
$function$;

create or replace function public.guard_clinical_measurement_expectation_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'CMV3_SESSION_EXPECTATION_IMMUTABLE';
end;
$function$;

create or replace function public.validate_clinical_measurement_expectation_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_session_status text;
begin
  select session_row.status
    into v_session_status
  from public.clinical_measurement_sessions_v3 session_row
  where session_row.id = new.session_id
    and session_row.organization_id = new.organization_id
    and session_row.patient_id = new.patient_id;

  if not found then
    raise exception 'CMV3_EXPECTATION_SESSION_SCOPE_INVALID';
  end if;

  if v_session_status <> 'PREPARING' then
    raise exception 'CMV3_EXPECTATION_SET_SEALED';
  end if;

  new.created_at := clock_timestamp();
  return new;
end;
$function$;

create or replace function public.validate_clinical_measurement_stream_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_session_status text;
  v_membership_clinic_id uuid;
  v_membership_status text;
  v_primary_role text;
  v_primary_observer_membership_id uuid;
begin
  select session_row.status
    into v_session_status
  from public.clinical_measurement_sessions_v3 session_row
  where session_row.id = new.session_id
    and session_row.organization_id = new.organization_id
    and session_row.patient_id = new.patient_id;

  if not found then
    raise exception 'CMV3_STREAM_SESSION_SCOPE_INVALID';
  end if;

  if tg_op = 'INSERT' and v_session_status not in ('PREPARING', 'OPEN') then
    raise exception 'CMV3_STREAM_SESSION_NOT_COLLECTABLE';
  end if;

  if new.status <> 'OPEN' then
    raise exception 'CMV3_STREAM_INSERT_MUST_OPEN';
  end if;

  new.opened_at := clock_timestamp();
  new.closed_at := null;
  new.created_at := new.opened_at;

  select membership.clinic_id, membership.status
    into v_membership_clinic_id, v_membership_status
  from public.clinic_memberships membership
  where membership.id = new.observer_membership_id;

  if not found
     or v_membership_clinic_id is distinct from new.organization_id
     or lower(coalesce(v_membership_status, '')) <> 'active' then
    raise exception 'CMV3_STREAM_OBSERVER_SCOPE_INVALID';
  end if;

  if new.stream_role = 'RELIABILITY' then
    select paired.stream_role, paired.observer_membership_id
      into v_primary_role, v_primary_observer_membership_id
    from public.clinical_measurement_collection_streams_v3 paired
    where paired.id = new.paired_primary_stream_id
      and paired.organization_id = new.organization_id
      and paired.patient_id = new.patient_id
      and paired.session_id = new.session_id
      and paired.expectation_id = new.expectation_id
      and paired.target_id = new.target_id;

    if not found or v_primary_role <> 'PRIMARY' then
      raise exception 'CMV3_STREAM_PRIMARY_PAIR_INVALID';
    end if;

    if v_primary_observer_membership_id is not distinct from new.observer_membership_id then
      raise exception 'CMV3_RELIABILITY_OBSERVER_MUST_DIFFER';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.guard_clinical_measurement_stream_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'CMV3_STREAM_DELETE_FORBIDDEN';
  end if;

  if (to_jsonb(old) - array['status', 'closed_at']::text[])
     is distinct from
     (to_jsonb(new) - array['status', 'closed_at']::text[]) then
    raise exception 'CMV3_STREAM_IDENTITY_IMMUTABLE';
  end if;

  if old.status = 'CLOSED' then
    raise exception 'CMV3_STREAM_CLOSED_FINAL';
  end if;

  if new.status = 'OPEN' then
    if new.closed_at is not null then
      raise exception 'CMV3_STREAM_OPEN_CLOSE_SHAPE_INVALID';
    end if;
    return new;
  end if;

  if new.status = 'CLOSED' then
    new.closed_at := clock_timestamp();
    return new;
  end if;

  raise exception 'CMV3_STREAM_STATUS_TRANSITION_INVALID';
end;
$function$;

-- Triggers ------------------------------------------------------------------
drop trigger if exists prepare_clinical_measurement_session_v3
  on public.clinical_measurement_sessions_v3;
create trigger prepare_clinical_measurement_session_v3
before insert on public.clinical_measurement_sessions_v3
for each row execute function public.prepare_clinical_measurement_session_v3();

drop trigger if exists validate_clinical_measurement_session_scope_v3
  on public.clinical_measurement_sessions_v3;
create trigger validate_clinical_measurement_session_scope_v3
before insert on public.clinical_measurement_sessions_v3
for each row execute function public.validate_clinical_measurement_session_scope_v3();

drop trigger if exists guard_clinical_measurement_session_v3
  on public.clinical_measurement_sessions_v3;
create trigger guard_clinical_measurement_session_v3
before update or delete on public.clinical_measurement_sessions_v3
for each row execute function public.guard_clinical_measurement_session_v3();

drop trigger if exists validate_clinical_measurement_expectation_v3
  on public.clinical_measurement_session_expectations_v3;
create trigger validate_clinical_measurement_expectation_v3
before insert on public.clinical_measurement_session_expectations_v3
for each row execute function public.validate_clinical_measurement_expectation_v3();

drop trigger if exists guard_clinical_measurement_expectation_v3
  on public.clinical_measurement_session_expectations_v3;
create trigger guard_clinical_measurement_expectation_v3
before update or delete on public.clinical_measurement_session_expectations_v3
for each row execute function public.guard_clinical_measurement_expectation_v3();

drop trigger if exists validate_clinical_measurement_stream_v3
  on public.clinical_measurement_collection_streams_v3;
create trigger validate_clinical_measurement_stream_v3
before insert on public.clinical_measurement_collection_streams_v3
for each row execute function public.validate_clinical_measurement_stream_v3();

drop trigger if exists guard_clinical_measurement_stream_v3
  on public.clinical_measurement_collection_streams_v3;
create trigger guard_clinical_measurement_stream_v3
before update or delete on public.clinical_measurement_collection_streams_v3
for each row execute function public.guard_clinical_measurement_stream_v3();

-- Dark-deploy security: no browser table or RPC is opened by Migration B.
alter table public.clinical_measurement_sessions_v3 enable row level security;
alter table public.clinical_measurement_session_expectations_v3 enable row level security;
alter table public.clinical_measurement_collection_streams_v3 enable row level security;

revoke all on table public.clinical_measurement_sessions_v3 from public, anon, authenticated;
revoke all on table public.clinical_measurement_session_expectations_v3 from public, anon, authenticated;
revoke all on table public.clinical_measurement_collection_streams_v3 from public, anon, authenticated;

grant all on table public.clinical_measurement_sessions_v3 to service_role;
grant all on table public.clinical_measurement_session_expectations_v3 to service_role;
grant all on table public.clinical_measurement_collection_streams_v3 to service_role;

revoke all on function public.prepare_clinical_measurement_session_v3() from public, anon, authenticated;
revoke all on function public.validate_clinical_measurement_session_scope_v3() from public, anon, authenticated;
revoke all on function public.guard_clinical_measurement_session_v3() from public, anon, authenticated;
revoke all on function public.validate_clinical_measurement_expectation_v3() from public, anon, authenticated;
revoke all on function public.guard_clinical_measurement_expectation_v3() from public, anon, authenticated;
revoke all on function public.validate_clinical_measurement_stream_v3() from public, anon, authenticated;
revoke all on function public.guard_clinical_measurement_stream_v3() from public, anon, authenticated;

-- Explicit preservation invariant: this migration creates no expectations,
-- sessions, streams, backfills, browser writers, or mutations in V2/ABA V3.

commit;
