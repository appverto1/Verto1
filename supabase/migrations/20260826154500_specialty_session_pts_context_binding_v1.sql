-- Specialty-session binding + PTS collection-context hardening.
--
-- Goals:
-- 1) persist the specialty therapeutic plan selected when a session starts;
-- 2) make that binding immutable for the lifetime of the session;
-- 3) bind the session to the PTS version independently from specialty-plan
--    programs, so PTS supersede never rewrites an already-open context;
-- 4) keep late/offline clinical writes attributable to the server-issued
--    collection context whenever the session was opened on the server.
--
-- Additive/idempotent. No existing clinical rows are deleted or rewritten.

begin;

do $migration_guard$
begin
  if to_regclass('public.aba_sessions') is null
     or to_regclass('public.patient_therapeutic_plans') is null
     or to_regclass('public.patient_pts_documents_v2') is null
     or to_regclass('public.patient_pts_versions_v2') is null
     or to_regclass('public.patient_pts_collection_contexts_v1') is null then
    raise exception 'SPECIALTY_SESSION_PTS_CONTEXT_SCHEMA_PENDING'
      using detail = 'Apply the therapeutic-plan and PTS lineage migrations first';
  end if;
end;
$migration_guard$;

alter table public.aba_sessions
  add column if not exists therapeutic_plan_id uuid;

do $session_plan_fk$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.aba_sessions'::regclass
      and conname = 'aba_sessions_therapeutic_plan_id_fkey'
  ) then
    alter table public.aba_sessions
      add constraint aba_sessions_therapeutic_plan_id_fkey
      foreign key (therapeutic_plan_id)
      references public.patient_therapeutic_plans(id)
      on delete restrict;
  end if;
end;
$session_plan_fk$;

create index if not exists idx_aba_sessions_specialty_plan_patient
  on public.aba_sessions(clinic_id, patient_id, therapeutic_plan_id, started_at desc)
  where therapeutic_plan_id is not null;

alter table public.patient_pts_collection_contexts_v1
  add column if not exists specialty_plan_id uuid;

do $context_specialty_fk$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.patient_pts_collection_contexts_v1'::regclass
      and conname = 'patient_pts_collection_contexts_v1_specialty_plan_fkey'
  ) then
    alter table public.patient_pts_collection_contexts_v1
      add constraint patient_pts_collection_contexts_v1_specialty_plan_fkey
      foreign key (specialty_plan_id)
      references public.patient_therapeutic_plans(id)
      on delete restrict;
  end if;
end;
$context_specialty_fk$;

create index if not exists idx_patient_pts_collection_contexts_v1_specialty_plan
  on public.patient_pts_collection_contexts_v1(
    organization_id,
    patient_id,
    specialty_plan_id,
    context_opened_at desc
  )
  where specialty_plan_id is not null;

-- Cross-row integrity and least-privilege guard for direct authenticated writes.
-- Service-role writes are validated by the API before insertion; authenticated
-- direct writes must also satisfy the ReBAC plan-write contract.
create or replace function public.guard_aba_session_therapeutic_plan_binding_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_plan public.patient_therapeutic_plans%rowtype;
  v_organization_id text;
begin
  if tg_op = 'UPDATE' then
    if old.therapeutic_plan_id is distinct from new.therapeutic_plan_id then
      raise exception 'ABA_SESSION_THERAPEUTIC_PLAN_IMMUTABLE';
    end if;
    if old.organization_id is distinct from new.organization_id
       or old.clinic_id is distinct from new.clinic_id
       or old.patient_id is distinct from new.patient_id then
      raise exception 'ABA_SESSION_CLINICAL_SCOPE_IMMUTABLE';
    end if;

    -- Once a session exists, its historical binding remains valid even if the
    -- specialty plan is later archived/superseded. Normal session updates must
    -- never be re-authorized against the plan's *current* lifecycle state.
    return new;
  end if;

  if new.therapeutic_plan_id is null then
    return new;
  end if;

  v_organization_id := coalesce(nullif(btrim(new.organization_id), ''), nullif(btrim(new.clinic_id), ''));

  select plan.* into v_plan
  from public.patient_therapeutic_plans plan
  where plan.id = new.therapeutic_plan_id
    and plan.patient_id = new.patient_id
    and plan.organization_id = v_organization_id
    and plan.clinic_id = new.clinic_id
    and plan.mode <> 'interdisciplinary'
    and plan.status <> 'archived'
  limit 1;

  if not found then
    raise exception 'ABA_SESSION_SPECIALTY_PLAN_SCOPE_INVALID';
  end if;

  if auth.uid() is not null
     and not public.therapeutic_plan_current_actor_can_access_v2(
       v_plan.patient_id,
       v_plan.organization_id,
       v_plan.clinic_id,
       v_plan.mode,
       v_plan.responsible_professional_id,
       v_plan.participant_professional_ids,
       'write'
     ) then
    raise exception 'ABA_SESSION_SPECIALTY_PLAN_ACCESS_DENIED';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_guard_aba_session_therapeutic_plan_binding_v1 on public.aba_sessions;
create trigger trg_guard_aba_session_therapeutic_plan_binding_v1
before insert or update of therapeutic_plan_id, organization_id, clinic_id, patient_id
on public.aba_sessions
for each row execute function public.guard_aba_session_therapeutic_plan_binding_v1();

-- PTS binding no longer discovers the PTS through program.therapeutic_plan_id.
-- Programs belong to specialty plans; the shared PTS is resolved independently
-- for the patient and frozen using the server-created ABA session timestamp.
create or replace function public.bind_patient_pts_collection_contexts_v1(
  p_organization_id uuid,
  p_patient_id uuid,
  p_source_session_id text,
  p_target_ids text[] default '{}'::text[],
  p_actor_id text default null,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_session public.aba_sessions%rowtype;
  v_anchor_at timestamptz;
  v_specialty_plan_id uuid;
  v_target_plan_id uuid;
  v_target_plan_count integer := 0;
  v_context record;
  v_rows jsonb := '[]'::jsonb;
begin
  select * into v_session
  from public.aba_sessions session_row
  where session_row.id = p_source_session_id
    and session_row.patient_id = p_patient_id
    and session_row.clinic_id = p_organization_id::text
  limit 1;
  if not found then raise exception 'PTS_COLLECTION_SESSION_SCOPE_INVALID'; end if;

  -- created_at is database/server generated and is therefore the authority for
  -- the moment this persisted session context came into existence. The client
  -- clock is never used to reinterpret a context after a PTS supersede.
  v_anchor_at := coalesce(v_session.created_at, p_now);
  v_specialty_plan_id := v_session.therapeutic_plan_id;

  -- Backward-compatible inference for old sessions that predate the explicit
  -- session column. Only accept an unambiguous single specialty plan.
  if v_specialty_plan_id is null and cardinality(coalesce(p_target_ids, '{}'::text[])) > 0 then
    with requested_targets as (
      select distinct btrim(value) as target_id
      from unnest(coalesce(p_target_ids, '{}'::text[])) value
      where nullif(btrim(value), '') is not null
    ), target_plans as (
      select distinct program.therapeutic_plan_id as plan_id
      from public.aba_targets target
      join public.aba_programs program
        on program.id = target.program_id
       and program.patient_id = target.patient_id
       and program.clinic_id = target.clinic_id
      join public.patient_therapeutic_plans plan
        on plan.id = program.therapeutic_plan_id
       and plan.patient_id = program.patient_id
       and plan.organization_id = p_organization_id::text
       and plan.clinic_id = p_organization_id::text
       and plan.mode <> 'interdisciplinary'
       and plan.status <> 'archived'
      join requested_targets requested on requested.target_id = target.id
      where target.patient_id = p_patient_id
        and target.clinic_id = p_organization_id::text
        and program.therapeutic_plan_id is not null
    )
    select min(plan_id), count(*)::integer
    into v_target_plan_id, v_target_plan_count
    from target_plans;

    if v_target_plan_count = 1 then
      v_specialty_plan_id := v_target_plan_id;
    end if;
  end if;

  select
    plan.id as plan_id,
    document.id as document_id,
    version.id as pts_version_id,
    version.version_number
  into v_context
  from public.patient_therapeutic_plans plan
  join public.patient_pts_documents_v2 document
    on document.plan_id = plan.id
   and document.organization_id = p_organization_id::text
   and document.patient_id = p_patient_id
  join lateral (
    select candidate.*
    from public.patient_pts_versions_v2 candidate
    where candidate.document_id = document.id
      and candidate.lifecycle_status in ('ACTIVE','SUPERSEDED')
      and candidate.effective_from is not null
      and candidate.effective_from <= v_anchor_at
      and (candidate.superseded_at is null or candidate.superseded_at > v_anchor_at)
    order by candidate.effective_from desc, candidate.version_number desc
    limit 1
  ) version on true
  where plan.organization_id = p_organization_id::text
    and plan.clinic_id = p_organization_id::text
    and plan.patient_id = p_patient_id
    and plan.mode = 'interdisciplinary'
  order by version.effective_from desc, version.version_number desc, document.created_at desc
  limit 1;

  if found then
    insert into public.patient_pts_collection_contexts_v1(
      organization_id, patient_id, source_session_id,
      plan_id, specialty_plan_id, document_id, pts_version_id, version_number,
      context_opened_at, server_issued_at, created_by, created_at
    ) values (
      p_organization_id,
      p_patient_id,
      p_source_session_id,
      v_context.plan_id,
      v_specialty_plan_id,
      v_context.document_id,
      v_context.pts_version_id,
      v_context.version_number,
      v_anchor_at,
      p_now,
      p_actor_id,
      p_now
    )
    on conflict (organization_id, source_session_id, plan_id) do update
      set specialty_plan_id = coalesce(
        public.patient_pts_collection_contexts_v1.specialty_plan_id,
        excluded.specialty_plan_id
      );
  end if;

  select coalesce(jsonb_agg(to_jsonb(context_row) order by context_row.plan_id), '[]'::jsonb)
  into v_rows
  from public.patient_pts_collection_contexts_v1 context_row
  where context_row.organization_id = p_organization_id
    and context_row.patient_id = p_patient_id
    and context_row.source_session_id = p_source_session_id;

  return v_rows;
end;
$function$;

-- Preserve the PTS-version resolver API used by append-only events while
-- switching its session anchor from the device-supplied started_at to the
-- persisted server-created session timestamp.
create or replace function public.resolve_patient_pts_plan_version_v1(
  p_organization_id uuid,
  p_patient_id uuid,
  p_plan_id uuid,
  p_source_session_id text default null,
  p_actor_id text default null,
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_document public.patient_pts_documents_v2%rowtype;
  v_version public.patient_pts_versions_v2%rowtype;
  v_session public.aba_sessions%rowtype;
  v_existing public.patient_pts_collection_contexts_v1%rowtype;
  v_anchor_at timestamptz;
begin
  select document.* into v_document
  from public.patient_pts_documents_v2 document
  join public.patient_therapeutic_plans plan on plan.id = document.plan_id
  where document.plan_id = p_plan_id
    and document.organization_id = p_organization_id::text
    and document.patient_id = p_patient_id
    and plan.mode = 'interdisciplinary'
  limit 1;
  if not found then raise exception 'PTS_DOCUMENT_NOT_FOUND'; end if;

  if nullif(btrim(coalesce(p_source_session_id, '')), '') is not null then
    select * into v_existing
    from public.patient_pts_collection_contexts_v1 context_row
    where context_row.organization_id = p_organization_id
      and context_row.patient_id = p_patient_id
      and context_row.source_session_id = p_source_session_id
      and context_row.plan_id = p_plan_id
    limit 1;
    if found then return v_existing.version_number; end if;

    select * into v_session
    from public.aba_sessions session_row
    where session_row.id = p_source_session_id
      and session_row.patient_id = p_patient_id
      and session_row.clinic_id = p_organization_id::text
    limit 1;
    if not found then raise exception 'PTS_COLLECTION_SESSION_SCOPE_INVALID'; end if;

    v_anchor_at := coalesce(v_session.created_at, p_now);

    select * into v_version
    from public.patient_pts_versions_v2 candidate
    where candidate.document_id = v_document.id
      and candidate.lifecycle_status in ('ACTIVE','SUPERSEDED')
      and candidate.effective_from is not null
      and candidate.effective_from <= v_anchor_at
      and (candidate.superseded_at is null or candidate.superseded_at > v_anchor_at)
    order by candidate.effective_from desc, candidate.version_number desc
    limit 1;
    if not found then raise exception 'PTS_COLLECTION_VERSION_NOT_FOUND'; end if;

    insert into public.patient_pts_collection_contexts_v1(
      organization_id, patient_id, source_session_id,
      plan_id, specialty_plan_id, document_id, pts_version_id, version_number,
      context_opened_at, server_issued_at, created_by, created_at
    ) values (
      p_organization_id,
      p_patient_id,
      p_source_session_id,
      p_plan_id,
      v_session.therapeutic_plan_id,
      v_document.id,
      v_version.id,
      v_version.version_number,
      v_anchor_at,
      p_now,
      p_actor_id,
      p_now
    ) on conflict (organization_id, source_session_id, plan_id) do update
      set specialty_plan_id = coalesce(
        public.patient_pts_collection_contexts_v1.specialty_plan_id,
        excluded.specialty_plan_id
      );

    select * into v_existing
    from public.patient_pts_collection_contexts_v1 context_row
    where context_row.organization_id = p_organization_id
      and context_row.patient_id = p_patient_id
      and context_row.source_session_id = p_source_session_id
      and context_row.plan_id = p_plan_id
    limit 1;
    if not found then raise exception 'PTS_COLLECTION_CONTEXT_BIND_FAILED'; end if;
    return v_existing.version_number;
  end if;

  select * into v_version
  from public.patient_pts_versions_v2 version_row
  where version_row.id = v_document.active_version_id
    and version_row.document_id = v_document.id
    and version_row.lifecycle_status = 'ACTIVE'
  limit 1;
  if not found then raise exception 'PTS_EVENT_ACTIVE_VERSION_REQUIRED'; end if;
  return v_version.version_number;
end;
$function$;

-- Binding on INSERT makes the server-side session creation and the immutable
-- PTS context part of the same database transaction. Subsequent collection-plan
-- reads only reuse/enrich that already-issued context.
create or replace function public.bind_aba_session_pts_context_after_insert_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  if new.patient_id is null
     or nullif(btrim(coalesce(new.clinic_id, '')), '') is null
     or new.clinic_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return new;
  end if;

  perform public.bind_patient_pts_collection_contexts_v1(
    new.clinic_id::uuid,
    new.patient_id,
    new.id,
    '{}'::text[],
    new.created_by,
    now()
  );
  return new;
end;
$function$;

drop trigger if exists trg_bind_aba_session_pts_context_after_insert_v1 on public.aba_sessions;
create trigger trg_bind_aba_session_pts_context_after_insert_v1
after insert on public.aba_sessions
for each row execute function public.bind_aba_session_pts_context_after_insert_v1();

notify pgrst, 'reload schema';

commit;
