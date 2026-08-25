-- Clinical plan measurement context linkage + unscheduled ABA session start claim.
--
-- Goals:
--   * preserve immutable CMV3 raw/session evidence while recording the operational ABA
--     session and therapeutic-plan context as an append-only relationship;
--   * keep retries idempotent (the same plan-write CMV3 session can only receive the
--     same context link);
--   * give future unscheduled ABA starts a DB-enforced active-session claim without
--     touching historical rows or the two already-known stale sessions.

begin;

alter table public.aba_sessions
  add column if not exists start_claim_key text;

create unique index if not exists ux_aba_sessions_active_start_claim_v1
  on public.aba_sessions (clinic_id, start_claim_key)
  where start_claim_key is not null
    and lower(status) in ('active', 'in_progress');

create table if not exists public.clinical_measurement_session_context_links_v3 (
  cmv3_session_id uuid primary key
    references public.clinical_measurement_sessions_v3(id) on delete restrict,
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  client_event_id text not null,
  aba_session_id text references public.aba_sessions(id) on delete restrict,
  therapeutic_plan_id uuid references public.patient_therapeutic_plans(id) on delete restrict,
  linked_by_membership_id uuid not null references public.clinic_memberships(id) on delete restrict,
  linked_at timestamptz not null default now(),
  constraint cmv3_context_client_event_nonempty
    check (length(btrim(client_event_id)) between 1 and 180),
  constraint cmv3_context_has_context
    check (aba_session_id is not null or therapeutic_plan_id is not null),
  unique (organization_id, patient_id, client_event_id),
  unique (cmv3_session_id, organization_id, patient_id)
);

create index if not exists idx_cmv3_context_aba_session_v1
  on public.clinical_measurement_session_context_links_v3
  (organization_id, patient_id, aba_session_id, linked_at desc)
  where aba_session_id is not null;

create index if not exists idx_cmv3_context_plan_v1
  on public.clinical_measurement_session_context_links_v3
  (organization_id, patient_id, therapeutic_plan_id, linked_at desc)
  where therapeutic_plan_id is not null;

create or replace function public.guard_clinical_measurement_session_context_link_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'CMV3_SESSION_CONTEXT_LINK_IMMUTABLE';
  end if;
  return new;
end;
$function$;

revoke all on function public.guard_clinical_measurement_session_context_link_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_cmv3_session_context_link_v1
  on public.clinical_measurement_session_context_links_v3;
create trigger guard_cmv3_session_context_link_v1
before update or delete on public.clinical_measurement_session_context_links_v3
for each row execute function public.guard_clinical_measurement_session_context_link_v1();

alter table public.clinical_measurement_session_context_links_v3 enable row level security;
revoke all on public.clinical_measurement_session_context_links_v3 from public, anon, authenticated;
grant select, insert on public.clinical_measurement_session_context_links_v3 to service_role;

create or replace function public.link_clinical_plan_measurement_context_v1(
  p_organization_id uuid,
  p_patient_id uuid,
  p_actor_membership_id uuid,
  p_cmv3_session_id uuid,
  p_client_event_id text,
  p_aba_session_id text default null,
  p_therapeutic_plan_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_client_event_id text := btrim(coalesce(p_client_event_id, ''));
  v_existing public.clinical_measurement_session_context_links_v3%rowtype;
  v_cmv3 public.clinical_measurement_sessions_v3%rowtype;
  v_membership public.clinic_memberships%rowtype;
  v_aba public.aba_sessions%rowtype;
  v_plan public.patient_therapeutic_plans%rowtype;
begin
  if p_organization_id is null or p_patient_id is null or p_actor_membership_id is null
     or p_cmv3_session_id is null or length(v_client_event_id) < 1 then
    raise exception 'CMV3_CONTEXT_LINK_SCOPE_REQUIRED';
  end if;
  if p_aba_session_id is null and p_therapeutic_plan_id is null then
    raise exception 'CMV3_CONTEXT_LINK_CONTEXT_REQUIRED';
  end if;

  select * into v_membership
  from public.clinic_memberships membership
  where membership.id = p_actor_membership_id;
  if not found
     or v_membership.clinic_id is distinct from p_organization_id
     or lower(coalesce(v_membership.status, '')) <> 'active' then
    raise exception 'CMV3_CONTEXT_LINK_ACTOR_SCOPE_INVALID';
  end if;

  select * into v_cmv3
  from public.clinical_measurement_sessions_v3 session_row
  where session_row.id = p_cmv3_session_id
    and session_row.organization_id = p_organization_id
    and session_row.patient_id = p_patient_id;
  if not found then
    raise exception 'CMV3_CONTEXT_LINK_SESSION_SCOPE_INVALID';
  end if;
  if v_cmv3.session_key is distinct from ('plan-write:' || v_client_event_id) then
    raise exception 'CMV3_CONTEXT_LINK_EVENT_SESSION_MISMATCH';
  end if;

  if p_aba_session_id is not null then
    select * into v_aba
    from public.aba_sessions aba
    where aba.id = p_aba_session_id
      and aba.patient_id = p_patient_id
      and aba.clinic_id = p_organization_id::text;
    if not found then
      raise exception 'CMV3_CONTEXT_LINK_ABA_SESSION_SCOPE_INVALID';
    end if;
    if v_cmv3.started_at < v_aba.started_at - interval '5 minutes' then
      raise exception 'CMV3_CONTEXT_LINK_OCCURRED_BEFORE_ABA_SESSION';
    end if;
    if coalesce(v_aba.ended_at, v_aba.actual_end_at) is not null
       and v_cmv3.started_at > coalesce(v_aba.ended_at, v_aba.actual_end_at) + interval '5 minutes' then
      raise exception 'CMV3_CONTEXT_LINK_OCCURRED_AFTER_ABA_SESSION';
    end if;
  end if;

  if p_therapeutic_plan_id is not null then
    select * into v_plan
    from public.patient_therapeutic_plans plan
    where plan.id = p_therapeutic_plan_id
      and plan.patient_id = p_patient_id
      and plan.organization_id = p_organization_id::text;
    if not found then
      raise exception 'CMV3_CONTEXT_LINK_PLAN_SCOPE_INVALID';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'CMV3_PLAN_CONTEXT:' || p_organization_id::text || ':' || p_patient_id::text || ':' || v_client_event_id,
      0
    )
  );

  select * into v_existing
  from public.clinical_measurement_session_context_links_v3 link
  where link.cmv3_session_id = p_cmv3_session_id
     or (
       link.organization_id = p_organization_id
       and link.patient_id = p_patient_id
       and link.client_event_id = v_client_event_id
     )
  limit 1;

  if found then
    if v_existing.cmv3_session_id is distinct from p_cmv3_session_id
       or v_existing.organization_id is distinct from p_organization_id
       or v_existing.patient_id is distinct from p_patient_id
       or v_existing.client_event_id is distinct from v_client_event_id
       or v_existing.aba_session_id is distinct from p_aba_session_id
       or v_existing.therapeutic_plan_id is distinct from p_therapeutic_plan_id then
      raise exception 'CMV3_CONTEXT_LINK_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object(
      'status', 'IDEMPOTENT_REPLAY',
      'cmv3_session_id', v_existing.cmv3_session_id,
      'aba_session_id', v_existing.aba_session_id,
      'therapeutic_plan_id', v_existing.therapeutic_plan_id
    );
  end if;

  insert into public.clinical_measurement_session_context_links_v3(
    cmv3_session_id,
    organization_id,
    patient_id,
    client_event_id,
    aba_session_id,
    therapeutic_plan_id,
    linked_by_membership_id
  ) values (
    p_cmv3_session_id,
    p_organization_id,
    p_patient_id,
    v_client_event_id,
    p_aba_session_id,
    p_therapeutic_plan_id,
    p_actor_membership_id
  ) returning * into v_existing;

  return jsonb_build_object(
    'status', 'LINKED',
    'cmv3_session_id', v_existing.cmv3_session_id,
    'aba_session_id', v_existing.aba_session_id,
    'therapeutic_plan_id', v_existing.therapeutic_plan_id
  );
end;
$function$;

revoke all on function public.link_clinical_plan_measurement_context_v1(
  uuid, uuid, uuid, uuid, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.link_clinical_plan_measurement_context_v1(
  uuid, uuid, uuid, uuid, text, text, uuid
) to service_role;

commit;
