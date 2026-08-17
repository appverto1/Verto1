-- ABA Measurement V3 - PR5 behavior measurement engine.
-- Additive/dark only. Legacy V2 is untouched. No V3 rollout is enabled here.
-- Behavior measurement uses explicit observation time, collector roles and server projections.

begin;

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- Normalized context prevents free-text variants from bypassing overlap protection.
create table if not exists public.aba_behavior_contexts_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  behavior_id text not null references public.aba_behavior_definitions(id) on delete restrict,
  context_key text not null,
  label text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','ARCHIVED')),
  created_by uuid,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint aba_behavior_contexts_v3_key_nonempty check (btrim(context_key) <> ''),
  constraint aba_behavior_contexts_v3_label_nonempty check (btrim(label) <> ''),
  unique (organization_id, patient_id, behavior_id, context_key),
  unique (id, organization_id, patient_id, behavior_id)
);

-- Collector role is frozen per session + behavior + context. A single official PRIMARY
-- exists for each segment; additional RELIABILITY observers are allowed for IOA.
create table if not exists public.aba_behavior_collector_bindings_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id text not null references public.aba_sessions(id) on delete restrict,
  behavior_id text not null references public.aba_behavior_definitions(id) on delete restrict,
  context_id uuid not null,
  collector_user_id uuid not null,
  collector_role text not null check (collector_role in ('PRIMARY','RELIABILITY')),
  bound_at timestamptz not null default now(),
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint aba_behavior_collector_bindings_v3_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint aba_behavior_collector_bindings_v3_time_order check (ended_at is null or ended_at >= bound_at),
  foreign key (context_id, organization_id, patient_id, behavior_id)
    references public.aba_behavior_contexts_v3(id, organization_id, patient_id, behavior_id) on delete restrict,
  unique (session_id, behavior_id, context_id, collector_user_id),
  unique (id, organization_id, patient_id, session_id, behavior_id, context_id, collector_user_id, collector_role)
);

create unique index if not exists uq_aba_behavior_primary_collector_v3
  on public.aba_behavior_collector_bindings_v3(session_id, behavior_id, context_id)
  where collector_role = 'PRIMARY' and ended_at is null;

-- Active observation time is represented by potentially fragmented slices.
create table if not exists public.aba_behavior_observation_slices_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id text not null references public.aba_sessions(id) on delete restrict,
  behavior_id text not null references public.aba_behavior_definitions(id) on delete restrict,
  context_id uuid not null references public.aba_behavior_contexts_v3(id) on delete restrict,
  collector_binding_id uuid not null,
  collector_user_id uuid not null,
  collector_role text not null check (collector_role in ('PRIMARY','RELIABILITY')),
  client_event_id text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  close_reason text check (close_reason is null or close_reason in ('USER_STOP','SESSION_FINALIZATION','AUDIT_CORRECTION')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','VOID')),
  payload_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint aba_behavior_observation_slices_v3_time_order check (ended_at is null or ended_at > started_at),
  constraint aba_behavior_observation_slices_v3_client_event_nonempty check (btrim(client_event_id) <> ''),
  constraint aba_behavior_observation_slices_v3_hash check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint aba_behavior_observation_slices_v3_metadata_object check (jsonb_typeof(metadata) = 'object'),
  foreign key (
    collector_binding_id, organization_id, patient_id, session_id,
    behavior_id, context_id, collector_user_id, collector_role
  ) references public.aba_behavior_collector_bindings_v3(
    id, organization_id, patient_id, session_id,
    behavior_id, context_id, collector_user_id, collector_role
  ) on delete restrict,
  unique (organization_id, client_event_id)
);

-- Same behavior/context/collector cannot accidentally count overlapping observation time.
-- Different behaviors and different IOA observers have distinct bindings and may overlap.
do $ddl$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'aba_behavior_observation_slices_v3_no_overlap'
  ) then
    alter table public.aba_behavior_observation_slices_v3
      add constraint aba_behavior_observation_slices_v3_no_overlap
      exclude using gist (
        collector_binding_id with =,
        tstzrange(started_at, coalesce(ended_at, 'infinity'::timestamptz), '[)') with &&
      ) where (status = 'ACTIVE');
  end if;
end
$ddl$;

create index if not exists idx_aba_behavior_observation_slices_v3_segment
  on public.aba_behavior_observation_slices_v3
  (organization_id, session_id, behavior_id, context_id, collector_binding_id, started_at);

-- Event facts are separate from observation denominator. Frequency is an event count;
-- duration is an episode whose exact ending may be right-censored at session finalization.
create table if not exists public.aba_behavior_events_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id text not null references public.aba_sessions(id) on delete restrict,
  behavior_id text not null references public.aba_behavior_definitions(id) on delete restrict,
  context_id uuid not null references public.aba_behavior_contexts_v3(id) on delete restrict,
  collector_binding_id uuid not null,
  collector_user_id uuid not null,
  collector_role text not null check (collector_role in ('PRIMARY','RELIABILITY')),
  client_event_id text not null,
  measurement_kind text not null check (measurement_kind in ('FREQUENCY','DURATION')),
  count_delta integer,
  occurred_at timestamptz not null,
  started_at timestamptz,
  ended_at timestamptz,
  is_censored boolean not null default false,
  end_reason text check (end_reason is null or end_reason in ('USER_STOP','SESSION_FINALIZATION','AUDIT_CORRECTION')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','VOID')),
  payload_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint aba_behavior_events_v3_client_event_nonempty check (btrim(client_event_id) <> ''),
  constraint aba_behavior_events_v3_hash check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint aba_behavior_events_v3_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint aba_behavior_events_v3_measurement_shape check (
    (measurement_kind = 'FREQUENCY' and count_delta is not null and count_delta > 0 and started_at is null and ended_at is null and not is_censored)
    or
    (measurement_kind = 'DURATION' and count_delta is null and started_at is not null and (ended_at is null or ended_at > started_at))
  ),
  constraint aba_behavior_events_v3_censor_shape check (
    not is_censored or (measurement_kind = 'DURATION' and ended_at is not null and end_reason = 'SESSION_FINALIZATION')
  ),
  foreign key (
    collector_binding_id, organization_id, patient_id, session_id,
    behavior_id, context_id, collector_user_id, collector_role
  ) references public.aba_behavior_collector_bindings_v3(
    id, organization_id, patient_id, session_id,
    behavior_id, context_id, collector_user_id, collector_role
  ) on delete restrict,
  unique (organization_id, client_event_id)
);

create index if not exists idx_aba_behavior_events_v3_segment
  on public.aba_behavior_events_v3
  (organization_id, session_id, behavior_id, context_id, collector_binding_id, occurred_at);

-- Rebuildable projection per collector. Official patient-facing summary is PRIMARY only.
create table if not exists public.aba_session_behavior_summaries_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id text not null references public.aba_sessions(id) on delete restrict,
  behavior_id text not null references public.aba_behavior_definitions(id) on delete restrict,
  context_id uuid not null references public.aba_behavior_contexts_v3(id) on delete restrict,
  collector_binding_id uuid not null,
  collector_user_id uuid not null,
  collector_role text not null check (collector_role in ('PRIMARY','RELIABILITY')),
  summary_definition_version integer not null default 1 check (summary_definition_version > 0),
  active_observation_seconds bigint not null default 0 check (active_observation_seconds >= 0),
  frequency_count bigint not null default 0 check (frequency_count >= 0),
  rate_per_hour numeric(14,6),
  duration_episode_count integer not null default 0 check (duration_episode_count >= 0),
  completed_duration_seconds bigint not null default 0 check (completed_duration_seconds >= 0),
  censored_duration_count integer not null default 0 check (censored_duration_count >= 0),
  open_duration_count integer not null default 0 check (open_duration_count >= 0),
  source_projection_hash text not null,
  source_latest_at timestamptz,
  computed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aba_session_behavior_summaries_v3_rate_shape check (
    (active_observation_seconds = 0 and rate_per_hour is null)
    or (active_observation_seconds > 0 and rate_per_hour is not null and rate_per_hour >= 0)
  ),
  constraint aba_session_behavior_summaries_v3_hash check (source_projection_hash ~ '^[0-9a-f]{64}$'),
  foreign key (
    collector_binding_id, organization_id, patient_id, session_id,
    behavior_id, context_id, collector_user_id, collector_role
  ) references public.aba_behavior_collector_bindings_v3(
    id, organization_id, patient_id, session_id,
    behavior_id, context_id, collector_user_id, collector_role
  ) on delete restrict,
  unique (collector_binding_id)
);

create or replace view public.aba_official_session_behavior_summaries_v3
with (security_invoker = true)
as
select summary.*
from public.aba_session_behavior_summaries_v3 summary
where summary.collector_role = 'PRIMARY';

-- Compute/recompute are the only authority for behavior summaries.
create or replace function public.recompute_aba_session_behavior_summary_v3(
  p_collector_binding_id uuid
)
returns public.aba_session_behavior_summaries_v3
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_binding public.aba_behavior_collector_bindings_v3%rowtype;
  v_observation_seconds bigint := 0;
  v_frequency bigint := 0;
  v_duration_count integer := 0;
  v_duration_seconds bigint := 0;
  v_censored integer := 0;
  v_open integer := 0;
  v_latest timestamptz;
  v_hash text;
  v_rate numeric(14,6);
  v_result public.aba_session_behavior_summaries_v3%rowtype;
begin
  select * into v_binding
  from public.aba_behavior_collector_bindings_v3
  where id = p_collector_binding_id;

  if not found then
    raise exception 'ABA_V3_BEHAVIOR_COLLECTOR_BINDING_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('aba-v3-behavior-summary:' || p_collector_binding_id::text, 0));

  select
    coalesce(sum(greatest(0, floor(extract(epoch from (slice.ended_at - slice.started_at)))::bigint)), 0),
    max(coalesce(slice.ended_at, slice.started_at))
  into v_observation_seconds, v_latest
  from public.aba_behavior_observation_slices_v3 slice
  where slice.collector_binding_id = p_collector_binding_id
    and slice.status = 'ACTIVE'
    and slice.ended_at is not null;

  select
    coalesce(sum(event.count_delta) filter (where event.measurement_kind = 'FREQUENCY'), 0),
    count(*) filter (where event.measurement_kind = 'DURATION'),
    coalesce(sum(greatest(0, floor(extract(epoch from (event.ended_at - event.started_at)))::bigint))
      filter (where event.measurement_kind = 'DURATION' and event.ended_at is not null and not event.is_censored), 0),
    count(*) filter (where event.measurement_kind = 'DURATION' and event.is_censored),
    count(*) filter (where event.measurement_kind = 'DURATION' and event.ended_at is null),
    greatest(v_latest, max(coalesce(event.ended_at, event.occurred_at)))
  into v_frequency, v_duration_count, v_duration_seconds, v_censored, v_open, v_latest
  from public.aba_behavior_events_v3 event
  where event.collector_binding_id = p_collector_binding_id
    and event.status = 'ACTIVE';

  v_rate := case
    when v_observation_seconds > 0 then round((v_frequency::numeric * 3600.0) / v_observation_seconds::numeric, 6)
    else null
  end;

  v_hash := encode(digest(convert_to(concat_ws('|',
    p_collector_binding_id::text,
    v_observation_seconds::text,
    v_frequency::text,
    coalesce(v_rate::text, 'NULL'),
    v_duration_count::text,
    v_duration_seconds::text,
    v_censored::text,
    v_open::text,
    coalesce(v_latest::text, 'NULL')
  ), 'UTF8'), 'sha256'), 'hex');

  insert into public.aba_session_behavior_summaries_v3 (
    organization_id, patient_id, session_id, behavior_id, context_id,
    collector_binding_id, collector_user_id, collector_role,
    active_observation_seconds, frequency_count, rate_per_hour,
    duration_episode_count, completed_duration_seconds,
    censored_duration_count, open_duration_count,
    source_projection_hash, source_latest_at, computed_at, updated_at
  ) values (
    v_binding.organization_id, v_binding.patient_id, v_binding.session_id,
    v_binding.behavior_id, v_binding.context_id, v_binding.id,
    v_binding.collector_user_id, v_binding.collector_role,
    v_observation_seconds, v_frequency, v_rate,
    v_duration_count, v_duration_seconds, v_censored, v_open,
    v_hash, v_latest, now(), now()
  )
  on conflict (collector_binding_id) do update set
    active_observation_seconds = excluded.active_observation_seconds,
    frequency_count = excluded.frequency_count,
    rate_per_hour = excluded.rate_per_hour,
    duration_episode_count = excluded.duration_episode_count,
    completed_duration_seconds = excluded.completed_duration_seconds,
    censored_duration_count = excluded.censored_duration_count,
    open_duration_count = excluded.open_duration_count,
    source_projection_hash = excluded.source_projection_hash,
    source_latest_at = excluded.source_latest_at,
    computed_at = excluded.computed_at,
    updated_at = excluded.updated_at
  returning * into v_result;

  return v_result;
end
$function$;

-- Close forgotten timers at the clinical session boundary. Observation time can be
-- safely bounded by the session end; an open duration episode has unknown true end
-- and is therefore explicitly right-censored and reviewable.
create or replace function public.finalize_aba_behavior_timers_v3(
  p_session_id text,
  p_session_ended_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_session public.aba_sessions%rowtype;
  v_slices integer := 0;
  v_duration integer := 0;
  v_binding_id uuid;
begin
  select * into v_session from public.aba_sessions where id = p_session_id for update;
  if not found then raise exception 'ABA_V3_SESSION_NOT_FOUND'; end if;
  if p_session_ended_at < v_session.started_at then raise exception 'ABA_V3_SESSION_END_BEFORE_START'; end if;

  update public.aba_behavior_observation_slices_v3
  set ended_at = greatest(started_at + interval '1 millisecond', p_session_ended_at),
      close_reason = 'SESSION_FINALIZATION'
  where session_id = p_session_id and status = 'ACTIVE' and ended_at is null;
  get diagnostics v_slices = row_count;

  update public.aba_behavior_events_v3
  set ended_at = greatest(started_at + interval '1 millisecond', p_session_ended_at),
      is_censored = true,
      end_reason = 'SESSION_FINALIZATION',
      metadata = metadata || jsonb_build_object('requires_review', true)
  where session_id = p_session_id
    and status = 'ACTIVE'
    and measurement_kind = 'DURATION'
    and ended_at is null;
  get diagnostics v_duration = row_count;

  for v_binding_id in
    select distinct binding_id from (
      select collector_binding_id as binding_id
      from public.aba_behavior_observation_slices_v3 where session_id = p_session_id
      union
      select collector_binding_id
      from public.aba_behavior_events_v3 where session_id = p_session_id
    ) affected
  loop
    perform public.recompute_aba_session_behavior_summary_v3(v_binding_id);
  end loop;

  return jsonb_build_object(
    'closed_observation_slices', v_slices,
    'censored_duration_episodes', v_duration
  );
end
$function$;

-- Generic append-only guard for behavior facts. Session finalization is the only
-- automatic mutation path and is performed by a SECURITY DEFINER RPC.
create or replace function public.guard_aba_behavior_v3_no_delete()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'ABA_V3_BEHAVIOR_HARD_DELETE_FORBIDDEN';
  end if;
  return new;
end
$function$;

drop trigger if exists guard_aba_behavior_observation_slices_v3_no_delete on public.aba_behavior_observation_slices_v3;
create trigger guard_aba_behavior_observation_slices_v3_no_delete
before delete on public.aba_behavior_observation_slices_v3
for each row execute function public.guard_aba_behavior_v3_no_delete();

drop trigger if exists guard_aba_behavior_events_v3_no_delete on public.aba_behavior_events_v3;
create trigger guard_aba_behavior_events_v3_no_delete
before delete on public.aba_behavior_events_v3
for each row execute function public.guard_aba_behavior_v3_no_delete();

-- Reconcile a collector projection after fact writes. Kept row-level while dark;
-- canonical bulk RPCs batch writes and explicitly recompute each affected binding once.
create or replace function public.reconcile_aba_behavior_summary_v3_after_fact()
returns trigger language plpgsql security definer set search_path = pg_catalog, public set row_security = off as $function$
begin
  perform public.recompute_aba_session_behavior_summary_v3(coalesce(new.collector_binding_id, old.collector_binding_id));
  return coalesce(new, old);
end
$function$;

drop trigger if exists reconcile_aba_behavior_slice_v3 on public.aba_behavior_observation_slices_v3;
create trigger reconcile_aba_behavior_slice_v3
after insert or update on public.aba_behavior_observation_slices_v3
for each row execute function public.reconcile_aba_behavior_summary_v3_after_fact();

drop trigger if exists reconcile_aba_behavior_event_v3 on public.aba_behavior_events_v3;
create trigger reconcile_aba_behavior_event_v3
after insert or update on public.aba_behavior_events_v3
for each row execute function public.reconcile_aba_behavior_summary_v3_after_fact();

-- PR5 expands quarantine kinds so a single bad offline slice/event never forces
-- reinterpretation or loss of unrelated valid trial data.
alter table public.aba_sync_quarantine_v3
  add column if not exists behavior_id text,
  add column if not exists behavior_context_id uuid;

alter table public.aba_sync_quarantine_v3
  drop constraint if exists aba_sync_quarantine_v3_event_kind_check;
alter table public.aba_sync_quarantine_v3
  add constraint aba_sync_quarantine_v3_event_kind_check
  check (event_kind in ('TRIAL','BEHAVIOR_OBSERVATION_SLICE','BEHAVIOR_EVENT'));

-- Fail closed in the browser during dark rollout.
alter table public.aba_behavior_contexts_v3 enable row level security;
alter table public.aba_behavior_collector_bindings_v3 enable row level security;
alter table public.aba_behavior_observation_slices_v3 enable row level security;
alter table public.aba_behavior_events_v3 enable row level security;
alter table public.aba_session_behavior_summaries_v3 enable row level security;

revoke all on table public.aba_behavior_contexts_v3 from public, anon, authenticated;
revoke all on table public.aba_behavior_collector_bindings_v3 from public, anon, authenticated;
revoke all on table public.aba_behavior_observation_slices_v3 from public, anon, authenticated;
revoke all on table public.aba_behavior_events_v3 from public, anon, authenticated;
revoke all on table public.aba_session_behavior_summaries_v3 from public, anon, authenticated;
revoke all on public.aba_official_session_behavior_summaries_v3 from public, anon, authenticated;

grant all on table public.aba_behavior_contexts_v3 to service_role;
grant all on table public.aba_behavior_collector_bindings_v3 to service_role;
grant all on table public.aba_behavior_observation_slices_v3 to service_role;
grant all on table public.aba_behavior_events_v3 to service_role;
grant select on table public.aba_session_behavior_summaries_v3 to service_role;
grant select on public.aba_official_session_behavior_summaries_v3 to service_role;

revoke all on function public.recompute_aba_session_behavior_summary_v3(uuid) from public, anon, authenticated;
revoke all on function public.finalize_aba_behavior_timers_v3(text, timestamptz) from public, anon, authenticated;
grant execute on function public.recompute_aba_session_behavior_summary_v3(uuid) to service_role;
grant execute on function public.finalize_aba_behavior_timers_v3(text, timestamptz) to service_role;

-- PR5 deliberately enables no rollout state and alters no Legacy V2 ABA table.
commit;
