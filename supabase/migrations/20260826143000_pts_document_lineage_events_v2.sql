-- Verto PTS v2 — document lineage, immutable published versions, append-only events
-- and session-bound plan context.
--
-- Additive/idempotent. Existing patient_therapeutic_plans and their legacy
-- patient_therapeutic_plan_versions snapshots remain intact and readable.
-- The legacy plan row continues to be the compatibility HEAD for the currently
-- active definition; published PTS versions live immutably in the tables below.

begin;

create extension if not exists pgcrypto;

create table if not exists public.patient_pts_documents_v2 (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null unique references public.patient_therapeutic_plans(id) on delete restrict,
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete restrict,
  active_version_id uuid,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.patient_pts_versions_v2 (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.patient_pts_documents_v2(id) on delete restrict,
  plan_id uuid not null references public.patient_therapeutic_plans(id) on delete restrict,
  organization_id text not null,
  patient_id uuid not null references public.patients(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  lifecycle_status text not null check (lifecycle_status in ('DRAFT','ACTIVE','SUPERSEDED','ARCHIVED')),
  draft_revision integer not null default 1 check (draft_revision > 0),
  snapshot jsonb not null,
  replaces_version_id uuid references public.patient_pts_versions_v2(id) on delete restrict,
  effective_from timestamptz,
  activated_at timestamptz,
  superseded_at timestamptz,
  authored_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_pts_versions_v2_snapshot_object check (jsonb_typeof(snapshot) = 'object'),
  constraint patient_pts_versions_v2_activation_shape check (
    (lifecycle_status = 'DRAFT' and activated_at is null and effective_from is null and superseded_at is null)
    or (lifecycle_status = 'ACTIVE' and activated_at is not null and effective_from is not null and superseded_at is null)
    or (lifecycle_status = 'SUPERSEDED' and activated_at is not null and effective_from is not null and superseded_at is not null)
    or lifecycle_status = 'ARCHIVED'
  ),
  unique (document_id, version_number)
);

-- Add the FK after both tables exist. The constraint is idempotent.
do $fk$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.patient_pts_documents_v2'::regclass
      and conname = 'patient_pts_documents_v2_active_version_fkey'
  ) then
    alter table public.patient_pts_documents_v2
      add constraint patient_pts_documents_v2_active_version_fkey
      foreign key (active_version_id)
      references public.patient_pts_versions_v2(id)
      on delete restrict;
  end if;
end;
$fk$;

create unique index if not exists ux_patient_pts_versions_v2_one_active
  on public.patient_pts_versions_v2(document_id)
  where lifecycle_status = 'ACTIVE';

create unique index if not exists ux_patient_pts_versions_v2_one_draft
  on public.patient_pts_versions_v2(document_id)
  where lifecycle_status = 'DRAFT';

create index if not exists idx_patient_pts_versions_v2_timeline
  on public.patient_pts_versions_v2(document_id, version_number desc, created_at desc);

create table if not exists public.patient_pts_events_v2 (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.patient_pts_documents_v2(id) on delete restrict,
  plan_id uuid not null references public.patient_therapeutic_plans(id) on delete restrict,
  organization_id text not null,
  patient_id uuid not null references public.patients(id) on delete restrict,
  occurred_under_version_id uuid not null references public.patient_pts_versions_v2(id) on delete restrict,
  event_type text not null check (event_type in (
    'VERSION_ACTIVATED',
    'REVIEW_RECORDED',
    'TEAM_DECISION_RECORDED',
    'RISK_OPENED',
    'RISK_STATUS_UPDATED',
    'RISK_RESOLVED',
    'GOAL_STATUS_UPDATED'
  )),
  entity_id text,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  created_by text not null,
  idempotency_key text,
  constraint patient_pts_events_v2_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint patient_pts_events_v2_entity_id_length check (entity_id is null or length(entity_id) between 1 and 120),
  constraint patient_pts_events_v2_idempotency_length check (idempotency_key is null or length(idempotency_key) between 16 and 180)
);

create unique index if not exists ux_patient_pts_events_v2_idempotency
  on public.patient_pts_events_v2(organization_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_patient_pts_events_v2_timeline
  on public.patient_pts_events_v2(document_id, occurred_at desc, recorded_at desc);

-- One immutable plan-version binding per ABA session + therapeutic plan. This is
-- deliberately separate from raw measurements: it is the collection-context
-- authority used by readers and late/offline sync.
create table if not exists public.patient_pts_collection_contexts_v1 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  source_session_id text not null references public.aba_sessions(id) on delete restrict,
  plan_id uuid not null references public.patient_therapeutic_plans(id) on delete restrict,
  document_id uuid not null references public.patient_pts_documents_v2(id) on delete restrict,
  pts_version_id uuid not null references public.patient_pts_versions_v2(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  context_opened_at timestamptz not null,
  server_issued_at timestamptz not null default now(),
  created_by text,
  created_at timestamptz not null default now(),
  unique (organization_id, source_session_id, plan_id)
);

create index if not exists idx_patient_pts_collection_contexts_v1_patient
  on public.patient_pts_collection_contexts_v1(
    organization_id,
    patient_id,
    context_opened_at desc,
    source_session_id
  );

-- Published versions and clinical events are append-only. DRAFT is the only
-- mutable version state, and only its snapshot/revision metadata may change.
create or replace function public.guard_patient_pts_version_v2()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'PTS_VERSION_DELETE_FORBIDDEN';
  end if;

  if old.lifecycle_status <> 'DRAFT' then
    if current_setting('verto.pts_version_transition', true) <> '1' then
      raise exception 'PTS_VERSION_IMMUTABLE';
    end if;

    -- Even inside the privileged atomic transition path, a published snapshot
    -- remains immutable. The only permitted published transition is
    -- ACTIVE -> SUPERSEDED, changing lifecycle timestamps only.
    if old.lifecycle_status <> 'ACTIVE'
       or new.lifecycle_status <> 'SUPERSEDED'
       or new.superseded_at is null
       or (to_jsonb(new) - array['lifecycle_status','superseded_at','updated_at']::text[])
          is distinct from
          (to_jsonb(old) - array['lifecycle_status','superseded_at','updated_at']::text[]) then
      raise exception 'PTS_PUBLISHED_VERSION_MUTATION_FORBIDDEN';
    end if;
    return new;
  end if;

  if new.document_id <> old.document_id
     or new.plan_id <> old.plan_id
     or new.organization_id <> old.organization_id
     or new.patient_id <> old.patient_id
     or new.version_number <> old.version_number
     or new.replaces_version_id is distinct from old.replaces_version_id
     or new.created_at <> old.created_at then
    raise exception 'PTS_VERSION_IDENTITY_IMMUTABLE';
  end if;

  if new.lifecycle_status = 'DRAFT' then
    if new.effective_from is not null or new.activated_at is not null or new.superseded_at is not null then
      raise exception 'PTS_DRAFT_ACTIVATION_FIELDS_INVALID';
    end if;
    return new;
  end if;

  if current_setting('verto.pts_version_transition', true) <> '1' then
    raise exception 'PTS_VERSION_TRANSITION_REQUIRES_ATOMIC_RPC';
  end if;

  return new;
end;
$function$;

drop trigger if exists guard_patient_pts_version_v2 on public.patient_pts_versions_v2;
create trigger guard_patient_pts_version_v2
before update or delete on public.patient_pts_versions_v2
for each row execute function public.guard_patient_pts_version_v2();

create or replace function public.guard_patient_pts_event_v2()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'PTS_EVENT_APPEND_ONLY';
end;
$function$;

drop trigger if exists guard_patient_pts_event_v2 on public.patient_pts_events_v2;
create trigger guard_patient_pts_event_v2
before update or delete on public.patient_pts_events_v2
for each row execute function public.guard_patient_pts_event_v2();

create or replace function public.guard_patient_pts_collection_context_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'PTS_COLLECTION_CONTEXT_IMMUTABLE';
end;
$function$;

drop trigger if exists guard_patient_pts_collection_context_v1 on public.patient_pts_collection_contexts_v1;
create trigger guard_patient_pts_collection_context_v1
before update or delete on public.patient_pts_collection_contexts_v1
for each row execute function public.guard_patient_pts_collection_context_v1();

-- Helper to create one longitudinal document identity for a legacy PTS plan.
create or replace function public.ensure_patient_pts_document_v2(
  p_plan_id uuid,
  p_actor_id text,
  p_now timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_plan public.patient_therapeutic_plans%rowtype;
  v_document public.patient_pts_documents_v2%rowtype;
  v_initial_status text;
  v_initial_version public.patient_pts_versions_v2%rowtype;
begin
  select * into v_plan
  from public.patient_therapeutic_plans
  where id = p_plan_id
  for update;

  if not found or v_plan.mode <> 'interdisciplinary' then
    raise exception 'PTS_DOCUMENT_SCOPE_INVALID';
  end if;

  select * into v_document
  from public.patient_pts_documents_v2
  where plan_id = v_plan.id
  for update;

  if not found then
    insert into public.patient_pts_documents_v2(
      plan_id, organization_id, clinic_id, patient_id, created_by, created_at, updated_at
    ) values (
      v_plan.id,
      v_plan.organization_id,
      v_plan.clinic_id,
      v_plan.patient_id,
      coalesce(nullif(btrim(p_actor_id), ''), v_plan.created_by),
      p_now,
      p_now
    )
    returning * into v_document;
  end if;

  if not exists (
    select 1 from public.patient_pts_versions_v2
    where document_id = v_document.id
  ) then
    v_initial_status := case
      when v_plan.status = 'draft' then 'DRAFT'
      when v_plan.status in ('completed', 'archived') then 'ARCHIVED'
      else 'ACTIVE'
    end;

    insert into public.patient_pts_versions_v2(
      document_id,
      plan_id,
      organization_id,
      patient_id,
      version_number,
      lifecycle_status,
      draft_revision,
      snapshot,
      replaces_version_id,
      effective_from,
      activated_at,
      superseded_at,
      authored_by,
      created_at,
      updated_at
    ) values (
      v_document.id,
      v_plan.id,
      v_plan.organization_id,
      v_plan.patient_id,
      1,
      v_initial_status,
      greatest(1, v_plan.edit_version),
      to_jsonb(v_plan),
      null,
      case when v_initial_status = 'ACTIVE' then coalesce(v_plan.updated_at, v_plan.created_at, p_now) else null end,
      case when v_initial_status = 'ACTIVE' then coalesce(v_plan.updated_at, v_plan.created_at, p_now) else null end,
      null,
      coalesce(nullif(btrim(v_plan.updated_by), ''), v_plan.created_by),
      coalesce(v_plan.created_at, p_now),
      coalesce(v_plan.updated_at, p_now)
    ) returning * into v_initial_version;

    if v_initial_status = 'ACTIVE' then
      update public.patient_pts_documents_v2
      set active_version_id = v_initial_version.id,
          updated_at = p_now
      where id = v_document.id;
    end if;
  end if;

  return v_document.id;
end;
$function$;

-- Existing PTS rows are backfilled without rewriting their clinical content.
do $backfill$
declare
  v_plan record;
begin
  for v_plan in
    select id, coalesce(nullif(updated_by, ''), created_by) as actor_id
    from public.patient_therapeutic_plans
    where mode = 'interdisciplinary'
  loop
    perform public.ensure_patient_pts_document_v2(v_plan.id, v_plan.actor_id, now());
  end loop;
end;
$backfill$;

-- Future PTS inserts receive lineage automatically. It intentionally runs only
-- on INSERT; draft edits are handled by explicit RPCs below.
create or replace function public.bootstrap_patient_pts_document_v2()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  if new.mode = 'interdisciplinary' then
    perform public.ensure_patient_pts_document_v2(
      new.id,
      coalesce(nullif(btrim(new.updated_by), ''), new.created_by),
      coalesce(new.updated_at, now())
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists bootstrap_patient_pts_document_v2 on public.patient_therapeutic_plans;
create trigger bootstrap_patient_pts_document_v2
after insert on public.patient_therapeutic_plans
for each row execute function public.bootstrap_patient_pts_document_v2();

-- Defense in depth: once a PTS has a published HEAD, its legacy compatibility
-- row is read-only for plan-definition fields. Only explicit atomic version
-- transitions may rewrite the HEAD. Review summary columns remain projections
-- of append-only events and may be refreshed without mutating the version.
create or replace function public.guard_published_patient_pts_head_v2()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_has_published_head boolean := false;
begin
  if old.mode <> 'interdisciplinary' then
    return new;
  end if;

  select exists(
    select 1
    from public.patient_pts_documents_v2 document
    where document.plan_id = old.id
      and document.active_version_id is not null
  ) into v_has_published_head;

  if not v_has_published_head then
    return new;
  end if;

  if current_setting('verto.pts_version_transition', true) = '1' then
    return new;
  end if;

  if (
    to_jsonb(new) - array['last_reviewed_at','review_due_date','updated_at']::text[]
  ) is distinct from (
    to_jsonb(old) - array['last_reviewed_at','review_due_date','updated_at']::text[]
  ) then
    raise exception 'PTS_PUBLISHED_HEAD_IMMUTABLE';
  end if;

  return new;
end;
$function$;

drop trigger if exists guard_published_patient_pts_head_v2 on public.patient_therapeutic_plans;
create trigger guard_published_patient_pts_head_v2
before update on public.patient_therapeutic_plans
for each row execute function public.guard_published_patient_pts_head_v2();

-- Create (or return) the single draft that descends from the active HEAD.
create or replace function public.create_patient_pts_draft_v2(
  p_plan_id uuid,
  p_organization_id text,
  p_patient_id uuid,
  p_actor_id text,
  p_now timestamptz default now()
)
returns public.patient_pts_versions_v2
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_plan public.patient_therapeutic_plans%rowtype;
  v_document public.patient_pts_documents_v2%rowtype;
  v_active public.patient_pts_versions_v2%rowtype;
  v_draft public.patient_pts_versions_v2%rowtype;
  v_next_version integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('pts-document:' || p_plan_id::text, 0));

  select * into v_plan
  from public.patient_therapeutic_plans
  where id = p_plan_id
    and organization_id = p_organization_id
    and patient_id = p_patient_id
    and mode = 'interdisciplinary'
  for update;
  if not found then raise exception 'PTS_DOCUMENT_NOT_FOUND'; end if;

  perform public.ensure_patient_pts_document_v2(v_plan.id, p_actor_id, p_now);

  select * into v_document
  from public.patient_pts_documents_v2
  where plan_id = v_plan.id
  for update;

  select * into v_draft
  from public.patient_pts_versions_v2
  where document_id = v_document.id
    and lifecycle_status = 'DRAFT'
  limit 1
  for update;
  if found then return v_draft; end if;

  select * into v_active
  from public.patient_pts_versions_v2
  where document_id = v_document.id
    and lifecycle_status = 'ACTIVE'
  limit 1
  for update;

  if not found then
    -- Initial plans are born as DRAFT by the bootstrap. Reaching this branch
    -- means lineage was repaired from an archived plan and no editable draft is valid.
    raise exception 'PTS_ACTIVE_VERSION_REQUIRED_FOR_NEW_DRAFT';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next_version
  from public.patient_pts_versions_v2
  where document_id = v_document.id;

  insert into public.patient_pts_versions_v2(
    document_id, plan_id, organization_id, patient_id,
    version_number, lifecycle_status, draft_revision, snapshot,
    replaces_version_id, authored_by, created_at, updated_at
  ) values (
    v_document.id,
    v_plan.id,
    v_plan.organization_id,
    v_plan.patient_id,
    v_next_version,
    'DRAFT',
    1,
    v_active.snapshot,
    v_active.id,
    p_actor_id,
    p_now,
    p_now
  ) returning * into v_draft;

  update public.patient_pts_documents_v2
  set updated_at = p_now
  where id = v_document.id;

  return v_draft;
end;
$function$;

-- Save draft content without touching an already active legacy HEAD.
create or replace function public.save_patient_pts_draft_v2(
  p_plan_id uuid,
  p_organization_id text,
  p_patient_id uuid,
  p_version_id uuid,
  p_expected_draft_revision integer,
  p_common_objectives jsonb,
  p_specialty_objectives jsonb,
  p_pts_payload jsonb,
  p_review_due_date date,
  p_actor_id text,
  p_now timestamptz default now()
)
returns public.patient_pts_versions_v2
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_plan public.patient_therapeutic_plans%rowtype;
  v_document public.patient_pts_documents_v2%rowtype;
  v_draft public.patient_pts_versions_v2%rowtype;
  v_has_active boolean;
  v_snapshot jsonb;
begin
  if jsonb_typeof(coalesce(p_common_objectives, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_specialty_objectives, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_pts_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'PTS_DRAFT_PAYLOAD_INVALID';
  end if;

  select * into v_plan
  from public.patient_therapeutic_plans
  where id = p_plan_id
    and organization_id = p_organization_id
    and patient_id = p_patient_id
    and mode = 'interdisciplinary'
  for update;
  if not found then raise exception 'PTS_DOCUMENT_NOT_FOUND'; end if;

  select * into v_document
  from public.patient_pts_documents_v2
  where plan_id = v_plan.id
  for update;
  if not found then raise exception 'PTS_DOCUMENT_LINEAGE_MISSING'; end if;

  select * into v_draft
  from public.patient_pts_versions_v2
  where id = p_version_id
    and document_id = v_document.id
    and lifecycle_status = 'DRAFT'
  for update;
  if not found then raise exception 'PTS_DRAFT_NOT_FOUND'; end if;
  if v_draft.draft_revision <> p_expected_draft_revision then
    raise exception 'PTS_DRAFT_VERSION_CONFLICT';
  end if;

  v_snapshot := jsonb_build_object(
    'id', v_plan.id,
    'organization_id', v_plan.organization_id,
    'clinic_id', v_plan.clinic_id,
    'patient_id', v_plan.patient_id,
    'mode', v_plan.mode,
    'specialty', v_plan.specialty,
    'responsible_professional_id', v_plan.responsible_professional_id,
    'participant_professional_ids', to_jsonb(v_plan.participant_professional_ids),
    'participant_specialties', to_jsonb(v_plan.participant_specialties),
    'common_objectives', coalesce(p_common_objectives, '[]'::jsonb),
    'specialty_objectives', coalesce(p_specialty_objectives, '{}'::jsonb),
    'pts_payload', coalesce(p_pts_payload, '{}'::jsonb),
    'pts_schema_version', 1,
    'review_due_date', p_review_due_date,
    'scope_snapshot', v_plan.scope_snapshot,
    'source_template_id', v_plan.source_template_id,
    'source_template_version', v_plan.source_template_version,
    'status', 'draft',
    'created_by', v_plan.created_by,
    'updated_by', p_actor_id,
    'created_at', v_plan.created_at,
    'updated_at', p_now
  );

  update public.patient_pts_versions_v2
  set snapshot = v_snapshot,
      draft_revision = draft_revision + 1,
      authored_by = p_actor_id,
      updated_at = p_now
  where id = v_draft.id
  returning * into v_draft;

  select exists(
    select 1 from public.patient_pts_versions_v2
    where document_id = v_document.id
      and lifecycle_status = 'ACTIVE'
  ) into v_has_active;

  -- Before the first activation the legacy plan row remains the compatibility
  -- representation of the draft. Once an ACTIVE version exists, draft edits are
  -- isolated exclusively in patient_pts_versions_v2.
  if not v_has_active
     and current_setting('verto.pts_version_transition', true) <> '1' then
    update public.patient_therapeutic_plans
    set common_objectives = coalesce(p_common_objectives, '[]'::jsonb),
        specialty_objectives = coalesce(p_specialty_objectives, '{}'::jsonb),
        pts_payload = coalesce(p_pts_payload, '{}'::jsonb),
        pts_schema_version = 1,
        review_due_date = p_review_due_date,
        status = 'draft',
        edit_version = edit_version + 1,
        updated_by = p_actor_id,
        updated_at = p_now
    where id = v_plan.id;
  end if;

  update public.patient_pts_documents_v2 set updated_at = p_now where id = v_document.id;
  return v_draft;
end;
$function$;

create or replace function public.patient_pts_snapshot_ready_for_activation_v2(p_snapshot jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $function$
  select
    jsonb_typeof(coalesce(p_snapshot, '{}'::jsonb)) = 'object'
    and jsonb_typeof(coalesce(p_snapshot->'pts_payload', '{}'::jsonb)) = 'object'
    and nullif(btrim(coalesce(p_snapshot#>>'{pts_payload,caseManagerId}', '')), '') is not null
    and coalesce(p_snapshot#>>'{pts_payload,startedAt}', '') ~ '^\\d{4}-\\d{2}-\\d{2}$'
    and jsonb_typeof(coalesce(p_snapshot#>'{pts_payload,goals}', '[]'::jsonb)) = 'array'
    and jsonb_array_length(coalesce(p_snapshot#>'{pts_payload,goals}', '[]'::jsonb)) > 0
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_snapshot#>'{pts_payload,needs}', '[]'::jsonb)) item
      where nullif(btrim(coalesce(item->>'title', '')), '') is null
         or nullif(btrim(coalesce(item->>'domain', '')), '') is null
    )
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_snapshot#>'{pts_payload,goals}', '[]'::jsonb)) item
      where nullif(btrim(coalesce(item->>'title', '')), '') is null
         or nullif(btrim(coalesce(item->>'target', '')), '') is null
         or jsonb_typeof(coalesce(item->'responsibleProfessionalIds', '[]'::jsonb)) <> 'array'
         or case
              when jsonb_typeof(coalesce(item->'responsibleProfessionalIds', '[]'::jsonb)) = 'array'
                then jsonb_array_length(coalesce(item->'responsibleProfessionalIds', '[]'::jsonb)) = 0
              else true
            end
    );
$function$;

-- Save + activate is one transaction. Old ACTIVE becomes SUPERSEDED and the
-- draft becomes ACTIVE before the compatibility HEAD is rewritten.
create or replace function public.activate_patient_pts_draft_v2(
  p_plan_id uuid,
  p_organization_id text,
  p_patient_id uuid,
  p_version_id uuid,
  p_expected_draft_revision integer,
  p_common_objectives jsonb,
  p_specialty_objectives jsonb,
  p_pts_payload jsonb,
  p_review_due_date date,
  p_actor_id text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_plan public.patient_therapeutic_plans%rowtype;
  v_document public.patient_pts_documents_v2%rowtype;
  v_draft public.patient_pts_versions_v2%rowtype;
  v_old_active public.patient_pts_versions_v2%rowtype;
  v_updated_plan public.patient_therapeutic_plans%rowtype;
  v_snapshot jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('pts-document:' || p_plan_id::text, 0));
  perform set_config('verto.pts_version_transition', '1', true);

  -- Reuse the draft writer inside this transaction so optimistic concurrency and
  -- payload normalization have one authority.
  select * into v_draft
  from public.save_patient_pts_draft_v2(
    p_plan_id,
    p_organization_id,
    p_patient_id,
    p_version_id,
    p_expected_draft_revision,
    p_common_objectives,
    p_specialty_objectives,
    p_pts_payload,
    p_review_due_date,
    p_actor_id,
    p_now
  );

  v_snapshot := v_draft.snapshot;
  if not public.patient_pts_snapshot_ready_for_activation_v2(v_snapshot) then
    raise exception 'PTS_DRAFT_VALIDATION_FAILED';
  end if;

  select * into v_plan
  from public.patient_therapeutic_plans
  where id = p_plan_id
    and organization_id = p_organization_id
    and patient_id = p_patient_id
  for update;

  select * into v_document
  from public.patient_pts_documents_v2
  where plan_id = v_plan.id
  for update;

  select * into v_old_active
  from public.patient_pts_versions_v2
  where document_id = v_document.id
    and lifecycle_status = 'ACTIVE'
  limit 1
  for update;

  if found then
    update public.patient_pts_versions_v2
    set lifecycle_status = 'SUPERSEDED',
        superseded_at = p_now,
        updated_at = p_now
    where id = v_old_active.id;
  end if;

  update public.patient_pts_versions_v2
  set lifecycle_status = 'ACTIVE',
      activated_at = p_now,
      effective_from = p_now,
      superseded_at = null,
      authored_by = p_actor_id,
      updated_at = p_now
  where id = v_draft.id
    and lifecycle_status = 'DRAFT'
  returning * into v_draft;
  if not found then raise exception 'PTS_DRAFT_ACTIVATION_CONFLICT'; end if;

  update public.patient_pts_documents_v2
  set active_version_id = v_draft.id,
      updated_at = p_now
  where id = v_document.id;

  -- This is the only place a published PTS definition rewrites the compatibility
  -- HEAD. Historical versions/events remain immutable.
  update public.patient_therapeutic_plans
  set common_objectives = coalesce(v_snapshot->'common_objectives', '[]'::jsonb),
      specialty_objectives = coalesce(v_snapshot->'specialty_objectives', '{}'::jsonb),
      pts_payload = coalesce(v_snapshot->'pts_payload', '{}'::jsonb),
      pts_schema_version = 1,
      review_due_date = nullif(v_snapshot->>'review_due_date', '')::date,
      status = 'active',
      edit_version = edit_version + 1,
      updated_by = p_actor_id,
      updated_at = p_now
  where id = v_plan.id
  returning * into v_updated_plan;

  insert into public.patient_pts_events_v2(
    document_id, plan_id, organization_id, patient_id,
    occurred_under_version_id, event_type, entity_id,
    occurred_at, recorded_at, payload, created_by
  ) values (
    v_document.id,
    v_plan.id,
    v_plan.organization_id,
    v_plan.patient_id,
    v_draft.id,
    'VERSION_ACTIVATED',
    v_draft.id::text,
    p_now,
    p_now,
    jsonb_build_object(
      'versionNumber', v_draft.version_number,
      'replacesVersionId', v_draft.replaces_version_id,
      'previousActiveVersionId', case when v_old_active.id is null then null else v_old_active.id end
    ),
    p_actor_id
  );

  return jsonb_build_object(
    'plan', to_jsonb(v_updated_plan),
    'version', to_jsonb(v_draft),
    'documentId', v_document.id
  );
end;
$function$;

-- Append-only clinical event. Version is resolved by the server-authoritative
-- document HEAD unless an immutable session binding is provided explicitly.
create or replace function public.append_patient_pts_event_v2(
  p_plan_id uuid,
  p_organization_id text,
  p_patient_id uuid,
  p_event_type text,
  p_entity_id text,
  p_occurred_at timestamptz,
  p_payload jsonb,
  p_actor_id text,
  p_idempotency_key text,
  p_bound_version_id uuid default null,
  p_now timestamptz default now()
)
returns public.patient_pts_events_v2
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_document public.patient_pts_documents_v2%rowtype;
  v_version public.patient_pts_versions_v2%rowtype;
  v_existing public.patient_pts_events_v2%rowtype;
  v_result public.patient_pts_events_v2%rowtype;
  v_next_review_date date;
begin
  if p_event_type not in (
    'REVIEW_RECORDED', 'TEAM_DECISION_RECORDED', 'RISK_OPENED',
    'RISK_STATUS_UPDATED', 'RISK_RESOLVED', 'GOAL_STATUS_UPDATED'
  ) then raise exception 'PTS_EVENT_TYPE_INVALID'; end if;
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'PTS_EVENT_PAYLOAD_INVALID';
  end if;
  if char_length(coalesce(p_idempotency_key, '')) < 16 then
    raise exception 'PTS_EVENT_IDEMPOTENCY_REQUIRED';
  end if;

  select * into v_existing
  from public.patient_pts_events_v2
  where organization_id = p_organization_id
    and idempotency_key = p_idempotency_key
  limit 1;
  if found then
    if v_existing.plan_id <> p_plan_id
       or v_existing.event_type <> p_event_type
       or v_existing.payload is distinct from coalesce(p_payload, '{}'::jsonb) then
      raise exception 'PTS_EVENT_IDEMPOTENCY_CONFLICT';
    end if;
    return v_existing;
  end if;

  select document.* into v_document
  from public.patient_pts_documents_v2 document
  join public.patient_therapeutic_plans plan on plan.id = document.plan_id
  where document.plan_id = p_plan_id
    and document.organization_id = p_organization_id
    and document.patient_id = p_patient_id
    and plan.mode = 'interdisciplinary'
  for update;
  if not found then raise exception 'PTS_DOCUMENT_NOT_FOUND'; end if;

  if p_bound_version_id is not null then
    select * into v_version
    from public.patient_pts_versions_v2
    where id = p_bound_version_id
      and document_id = v_document.id
      and lifecycle_status in ('ACTIVE','SUPERSEDED')
    limit 1;
  else
    select * into v_version
    from public.patient_pts_versions_v2
    where id = v_document.active_version_id
      and document_id = v_document.id
      and lifecycle_status = 'ACTIVE'
    limit 1;
  end if;
  if not found then raise exception 'PTS_EVENT_ACTIVE_VERSION_REQUIRED'; end if;

  insert into public.patient_pts_events_v2(
    document_id, plan_id, organization_id, patient_id,
    occurred_under_version_id, event_type, entity_id,
    occurred_at, recorded_at, payload, created_by, idempotency_key
  ) values (
    v_document.id,
    p_plan_id,
    p_organization_id,
    p_patient_id,
    v_version.id,
    p_event_type,
    nullif(btrim(p_entity_id), ''),
    coalesce(p_occurred_at, p_now),
    p_now,
    coalesce(p_payload, '{}'::jsonb),
    p_actor_id,
    p_idempotency_key
  ) returning * into v_result;

  -- Keep legacy summary columns as projections only. The published version
  -- snapshot remains immutable.
  if p_event_type = 'REVIEW_RECORDED' then
    begin
      v_next_review_date := nullif(p_payload->>'nextReviewDate', '')::date;
    exception when others then
      v_next_review_date := null;
    end;
    update public.patient_therapeutic_plans
    set last_reviewed_at = coalesce(p_occurred_at, p_now),
        review_due_date = coalesce(v_next_review_date, review_due_date),
        updated_at = greatest(updated_at, p_now)
    where id = p_plan_id;
  end if;

  return v_result;
end;
$function$;

-- Bind a session to the version that was effective when the server-side ABA
-- session opened. This does not trust a client timestamp and stays correct even
-- if the first sync happens after a supersede.
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
  v_context record;
  v_rows jsonb := '[]'::jsonb;
begin
  select * into v_session
  from public.aba_sessions session_row
  where session_row.id = p_source_session_id
    and session_row.patient_id = p_patient_id
    and session_row.clinic_id = p_organization_id::text;
  if not found then raise exception 'PTS_COLLECTION_SESSION_SCOPE_INVALID'; end if;

  for v_context in
    with requested_targets as (
      select distinct btrim(value) as target_id
      from unnest(coalesce(p_target_ids, '{}'::text[])) value
      where nullif(btrim(value), '') is not null
    ), plan_ids as (
      select distinct program.therapeutic_plan_id as plan_id
      from public.aba_targets target
      join public.aba_programs program
        on program.id = target.program_id
       and program.patient_id = target.patient_id
       and program.clinic_id = target.clinic_id
      join requested_targets requested on requested.target_id = target.id
      where target.patient_id = p_patient_id
        and target.clinic_id = p_organization_id::text
        and program.therapeutic_plan_id is not null
    )
    select
      plan.id as plan_id,
      document.id as document_id,
      version.id as pts_version_id,
      version.version_number
    from plan_ids requested_plan
    join public.patient_therapeutic_plans plan
      on plan.id = requested_plan.plan_id
     and plan.organization_id = p_organization_id::text
     and plan.patient_id = p_patient_id
    join public.patient_pts_documents_v2 document
      on document.plan_id = plan.id
    join lateral (
      select candidate.*
      from public.patient_pts_versions_v2 candidate
      where candidate.document_id = document.id
        and candidate.lifecycle_status in ('ACTIVE','SUPERSEDED')
        and candidate.effective_from is not null
        and candidate.effective_from <= v_session.started_at
        and (candidate.superseded_at is null or candidate.superseded_at > v_session.started_at)
      order by candidate.effective_from desc, candidate.version_number desc
      limit 1
    ) version on true
  loop
    insert into public.patient_pts_collection_contexts_v1(
      organization_id, patient_id, source_session_id,
      plan_id, document_id, pts_version_id, version_number,
      context_opened_at, server_issued_at, created_by, created_at
    ) values (
      p_organization_id,
      p_patient_id,
      p_source_session_id,
      v_context.plan_id,
      v_context.document_id,
      v_context.pts_version_id,
      v_context.version_number,
      v_session.started_at,
      p_now,
      p_actor_id,
      p_now
    ) on conflict (organization_id, source_session_id, plan_id) do nothing;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(context_row) order by context_row.plan_id), '[]'::jsonb)
  into v_rows
  from public.patient_pts_collection_contexts_v1 context_row
  where context_row.organization_id = p_organization_id
    and context_row.patient_id = p_patient_id
    and context_row.source_session_id = p_source_session_id;

  return v_rows;
end;
$function$;

-- Resolve the authoritative PTS version for a clinical write. If a server-side
-- ABA session is supplied, bind the plan to the version that was effective when
-- that session opened. The device clock and the current HEAD are never used to
-- reinterpret an already-open collection context.
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

    select * into v_version
    from public.patient_pts_versions_v2 candidate
    where candidate.document_id = v_document.id
      and candidate.lifecycle_status in ('ACTIVE','SUPERSEDED')
      and candidate.effective_from is not null
      and candidate.effective_from <= v_session.started_at
      and (candidate.superseded_at is null or candidate.superseded_at > v_session.started_at)
    order by candidate.effective_from desc, candidate.version_number desc
    limit 1;
    if not found then raise exception 'PTS_COLLECTION_VERSION_NOT_FOUND'; end if;

    insert into public.patient_pts_collection_contexts_v1(
      organization_id, patient_id, source_session_id,
      plan_id, document_id, pts_version_id, version_number,
      context_opened_at, server_issued_at, created_by, created_at
    ) values (
      p_organization_id, p_patient_id, p_source_session_id,
      p_plan_id, v_document.id, v_version.id, v_version.version_number,
      v_session.started_at, p_now, p_actor_id, p_now
    ) on conflict (organization_id, source_session_id, plan_id) do nothing;

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

-- One batched reader for the PTS workspace: document heads, immutable versions,
-- and append-only events. The server already applies patient/plan authorization.
create or replace function public.read_patient_pts_workspace_v2(
  p_organization_id text,
  p_patient_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
  select jsonb_build_object(
    'documents', coalesce((
      select jsonb_agg(to_jsonb(document_row) order by document_row.created_at)
      from public.patient_pts_documents_v2 document_row
      where document_row.organization_id = p_organization_id
        and document_row.patient_id = p_patient_id
    ), '[]'::jsonb),
    'versions', coalesce((
      select jsonb_agg(to_jsonb(version_row) order by version_row.version_number desc, version_row.created_at desc)
      from public.patient_pts_versions_v2 version_row
      where version_row.organization_id = p_organization_id
        and version_row.patient_id = p_patient_id
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(to_jsonb(event_row) order by event_row.occurred_at desc, event_row.recorded_at desc)
      from (
        select event.*
        from public.patient_pts_events_v2 event
        where event.organization_id = p_organization_id
          and event.patient_id = p_patient_id
        order by event.occurred_at desc, event.recorded_at desc
        limit 500
      ) event_row
    ), '[]'::jsonb)
  );
$function$;

-- Explicit RLS: authenticated clients may read only through the existing plan
-- access contract. Mutations are service-side RPC only.
alter table public.patient_pts_documents_v2 enable row level security;
alter table public.patient_pts_versions_v2 enable row level security;
alter table public.patient_pts_events_v2 enable row level security;
alter table public.patient_pts_collection_contexts_v1 enable row level security;

drop policy if exists patient_pts_documents_v2_select on public.patient_pts_documents_v2;
create policy patient_pts_documents_v2_select
on public.patient_pts_documents_v2 for select to authenticated
using (
  exists (
    select 1
    from public.patient_therapeutic_plans plan
    where plan.id = patient_pts_documents_v2.plan_id
      and public.therapeutic_plan_current_actor_can_access_v1(
        plan.patient_id,
        plan.organization_id,
        plan.clinic_id,
        plan.responsible_professional_id,
        plan.participant_professional_ids,
        'read'
      )
  )
);

drop policy if exists patient_pts_versions_v2_select on public.patient_pts_versions_v2;
create policy patient_pts_versions_v2_select
on public.patient_pts_versions_v2 for select to authenticated
using (
  exists (
    select 1
    from public.patient_therapeutic_plans plan
    where plan.id = patient_pts_versions_v2.plan_id
      and public.therapeutic_plan_current_actor_can_access_v1(
        plan.patient_id,
        plan.organization_id,
        plan.clinic_id,
        plan.responsible_professional_id,
        plan.participant_professional_ids,
        'read'
      )
  )
);

drop policy if exists patient_pts_events_v2_select on public.patient_pts_events_v2;
create policy patient_pts_events_v2_select
on public.patient_pts_events_v2 for select to authenticated
using (
  exists (
    select 1
    from public.patient_therapeutic_plans plan
    where plan.id = patient_pts_events_v2.plan_id
      and public.therapeutic_plan_current_actor_can_access_v1(
        plan.patient_id,
        plan.organization_id,
        plan.clinic_id,
        plan.responsible_professional_id,
        plan.participant_professional_ids,
        'read'
      )
  )
);

-- Session bindings are intentionally service-side only. They are returned via
-- authorized read models, never written by the browser.
revoke all on public.patient_pts_documents_v2 from public, anon;
revoke all on public.patient_pts_versions_v2 from public, anon;
revoke all on public.patient_pts_events_v2 from public, anon;
revoke all on public.patient_pts_collection_contexts_v1 from public, anon, authenticated;

grant select on public.patient_pts_documents_v2 to authenticated;
grant select on public.patient_pts_versions_v2 to authenticated;
grant select on public.patient_pts_events_v2 to authenticated;
grant all on public.patient_pts_documents_v2 to service_role;
grant all on public.patient_pts_versions_v2 to service_role;
grant all on public.patient_pts_events_v2 to service_role;
grant all on public.patient_pts_collection_contexts_v1 to service_role;

revoke all on function public.ensure_patient_pts_document_v2(uuid,text,timestamptz) from public, anon, authenticated;
revoke all on function public.create_patient_pts_draft_v2(uuid,text,uuid,text,timestamptz) from public, anon, authenticated;
revoke all on function public.save_patient_pts_draft_v2(uuid,text,uuid,uuid,integer,jsonb,jsonb,jsonb,date,text,timestamptz) from public, anon, authenticated;
revoke all on function public.activate_patient_pts_draft_v2(uuid,text,uuid,uuid,integer,jsonb,jsonb,jsonb,date,text,timestamptz) from public, anon, authenticated;
revoke all on function public.append_patient_pts_event_v2(uuid,text,uuid,text,text,timestamptz,jsonb,text,text,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.bind_patient_pts_collection_contexts_v1(uuid,uuid,text,text[],text,timestamptz) from public, anon, authenticated;
revoke all on function public.resolve_patient_pts_plan_version_v1(uuid,uuid,uuid,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.read_patient_pts_workspace_v2(text,uuid) from public, anon, authenticated;

grant execute on function public.ensure_patient_pts_document_v2(uuid,text,timestamptz) to service_role;
grant execute on function public.create_patient_pts_draft_v2(uuid,text,uuid,text,timestamptz) to service_role;
grant execute on function public.save_patient_pts_draft_v2(uuid,text,uuid,uuid,integer,jsonb,jsonb,jsonb,date,text,timestamptz) to service_role;
grant execute on function public.activate_patient_pts_draft_v2(uuid,text,uuid,uuid,integer,jsonb,jsonb,jsonb,date,text,timestamptz) to service_role;
grant execute on function public.append_patient_pts_event_v2(uuid,text,uuid,text,text,timestamptz,jsonb,text,text,uuid,timestamptz) to service_role;
grant execute on function public.bind_patient_pts_collection_contexts_v1(uuid,uuid,text,text[],text,timestamptz) to service_role;
grant execute on function public.resolve_patient_pts_plan_version_v1(uuid,uuid,uuid,text,text,timestamptz) to service_role;
grant execute on function public.read_patient_pts_workspace_v2(text,uuid) to service_role;

commit;
