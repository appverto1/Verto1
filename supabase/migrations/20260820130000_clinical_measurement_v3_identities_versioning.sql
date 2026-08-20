-- Verto Clinical Measurement Engine V3 - Migration A: identities & versioning.
-- Additive/dark only. Creates the universal semantic identity layer without
-- mutating ABA V2, the existing ABA V3 implementation, routes, or live writers.

begin;

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Stable target identity. This table does not copy clinical content from legacy
-- sources; it binds one universal measurement target to an existing source (or
-- to a standalone V3 target) while preserving tenant/patient scope.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_targets_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_key text not null,
  source_kind text not null
    check (source_kind in (
      'ABA_TARGET',
      'THERAPEUTIC_OBJECTIVE',
      'PLAN_TARGET',
      'PLAN_GOAL',
      'STANDALONE'
    )),
  aba_target_id text references public.aba_targets(id) on delete restrict,
  therapeutic_objective_id uuid
    references public.patient_therapeutic_objectives(id) on delete restrict,
  therapeutic_plan_id uuid
    references public.patient_therapeutic_plans(id) on delete restrict,
  source_goal_key text,
  specialty text,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'PAUSED', 'ARCHIVED')),
  archived_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cmv3_target_key_nonempty
    check (length(trim(target_key)) between 1 and 180),
  constraint cmv3_target_archive_shape
    check ((status = 'ARCHIVED' and archived_at is not null) or (status <> 'ARCHIVED' and archived_at is null)),
  constraint cmv3_target_source_shape check (
    (source_kind = 'ABA_TARGET'
      and aba_target_id is not null
      and therapeutic_objective_id is null
      and therapeutic_plan_id is null
      and source_goal_key is null)
    or
    (source_kind = 'THERAPEUTIC_OBJECTIVE'
      and aba_target_id is null
      and therapeutic_objective_id is not null
      and therapeutic_plan_id is null
      and source_goal_key is null)
    or
    (source_kind = 'PLAN_TARGET'
      and aba_target_id is null
      and therapeutic_objective_id is null
      and therapeutic_plan_id is not null
      and source_goal_key is null)
    or
    (source_kind = 'PLAN_GOAL'
      and aba_target_id is null
      and therapeutic_objective_id is null
      and therapeutic_plan_id is not null
      and nullif(trim(source_goal_key), '') is not null)
    or
    (source_kind = 'STANDALONE'
      and aba_target_id is null
      and therapeutic_objective_id is null
      and therapeutic_plan_id is null
      and source_goal_key is null)
  ),
  unique (organization_id, patient_id, target_key),
  unique (id, organization_id, patient_id)
);

create unique index if not exists ux_cmv3_target_aba_source
  on public.clinical_measurement_targets_v3 (organization_id, aba_target_id)
  where source_kind = 'ABA_TARGET';
create unique index if not exists ux_cmv3_target_objective_source
  on public.clinical_measurement_targets_v3 (organization_id, therapeutic_objective_id)
  where source_kind = 'THERAPEUTIC_OBJECTIVE';
create unique index if not exists ux_cmv3_target_plan_source
  on public.clinical_measurement_targets_v3 (organization_id, therapeutic_plan_id)
  where source_kind = 'PLAN_TARGET';
create unique index if not exists ux_cmv3_target_plan_goal_source
  on public.clinical_measurement_targets_v3 (organization_id, therapeutic_plan_id, source_goal_key)
  where source_kind = 'PLAN_GOAL';
create index if not exists idx_cmv3_targets_patient
  on public.clinical_measurement_targets_v3 (organization_id, patient_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- Stable measurement identity. Mathematical family belongs to the identity and
-- cannot silently change between versions; a family change means a new identity.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_definitions_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  definition_key text not null,
  semantic_family text not null
    check (semantic_family in (
      'PROPORTION', 'RATE', 'COUNT', 'DURATION', 'LATENCY', 'IRT',
      'INTERVAL', 'ORDINAL', 'CONTINUOUS', 'TASK_ANALYSIS', 'CATEGORICAL'
    )),
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'ARCHIVED')),
  archived_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cmv3_definition_key_nonempty
    check (length(trim(definition_key)) between 1 and 180),
  constraint cmv3_definition_archive_shape
    check ((status = 'ARCHIVED' and archived_at is not null) or (status <> 'ARCHIVED' and archived_at is null)),
  foreign key (target_id, organization_id, patient_id)
    references public.clinical_measurement_targets_v3(id, organization_id, patient_id)
    on delete restrict,
  unique (target_id, definition_key),
  unique (id, organization_id, patient_id, target_id)
);

create index if not exists idx_cmv3_definitions_target
  on public.clinical_measurement_definitions_v3
  (organization_id, patient_id, target_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- Immutable semantic versions. Common semantics stay relational; family-specific
-- configuration is versioned in content JSON and remains server-hashed.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_definition_versions_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  definition_id uuid not null,
  version integer not null check (version > 0),
  schema_version integer not null default 3 check (schema_version = 3),
  unit_code text,
  unit_label text,
  directionality text not null default 'NO_DIRECTIONAL_JUDGMENT'
    check (directionality in (
      'INCREASE_IS_BETTER',
      'DECREASE_IS_BETTER',
      'TARGET_RANGE_IS_BETTER',
      'NO_DIRECTIONAL_JUDGMENT'
    )),
  content jsonb not null,
  aggregation_policy jsonb not null default '{}'::jsonb,
  definition_hash text not null,
  status text not null default 'PUBLISHED'
    check (status in ('PUBLISHED', 'DEPRECATED', 'ARCHIVED')),
  published_at timestamptz not null default now(),
  deprecated_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cmv3_definition_version_content_object
    check (jsonb_typeof(content) = 'object'),
  constraint cmv3_definition_version_aggregation_object
    check (jsonb_typeof(aggregation_policy) = 'object'),
  constraint cmv3_definition_version_hash_shape
    check (definition_hash ~ '^[0-9a-f]{64}$'),
  constraint cmv3_definition_version_lifecycle check (
    (status = 'PUBLISHED' and deprecated_at is null)
    or (status in ('DEPRECATED', 'ARCHIVED') and deprecated_at is not null)
  ),
  foreign key (definition_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_definitions_v3(id, organization_id, patient_id, target_id)
    on delete restrict,
  unique (definition_id, version),
  unique (id, organization_id, patient_id, target_id),
  unique (id, organization_id, patient_id, target_id, definition_id)
);

create index if not exists idx_cmv3_definition_versions_lookup
  on public.clinical_measurement_definition_versions_v3
  (organization_id, patient_id, target_id, definition_id, version desc);

-- ---------------------------------------------------------------------------
-- Bitemporal activation of semantic versions. Rows are immutable facts except
-- for the single lifecycle annotation superseded_at. A retrospective correction
-- creates a replacement row and annotates the old knowledge row as superseded.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_definition_activations_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  definition_id uuid not null,
  definition_version_id uuid not null,
  effective_from timestamptz not null,
  effective_until timestamptz,
  recorded_at timestamptz not null default now(),
  activation_mode text not null default 'PROSPECTIVE'
    check (activation_mode in ('PROSPECTIVE', 'RETROSPECTIVE_CORRECTION')),
  supersedes_activation_id uuid,
  superseded_at timestamptz,
  reason text,
  created_by text,
  constraint cmv3_definition_activation_window
    check (effective_until is null or effective_until > effective_from),
  constraint cmv3_definition_activation_supersession_time
    check (superseded_at is null or superseded_at >= recorded_at),
  constraint cmv3_definition_activation_not_self
    check (supersedes_activation_id is null or supersedes_activation_id <> id),
  foreign key (definition_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_definitions_v3(id, organization_id, patient_id, target_id)
    on delete restrict,
  foreign key (definition_version_id, organization_id, patient_id, target_id, definition_id)
    references public.clinical_measurement_definition_versions_v3(
      id, organization_id, patient_id, target_id, definition_id
    ) on delete restrict,
  unique (id, organization_id, patient_id, target_id, definition_id),
  unique (id, organization_id, patient_id, target_id, definition_version_id),
  foreign key (
    supersedes_activation_id, organization_id, patient_id, target_id, definition_id
  ) references public.clinical_measurement_definition_activations_v3(
    id, organization_id, patient_id, target_id, definition_id
  ) on delete restrict
);

create index if not exists idx_cmv3_definition_activations_timeline
  on public.clinical_measurement_definition_activations_v3
  (organization_id, patient_id, target_id, definition_id, effective_from desc, recorded_at desc);
create index if not exists idx_cmv3_definition_activations_current
  on public.clinical_measurement_definition_activations_v3
  (organization_id, definition_id, effective_from desc)
  where superseded_at is null;

do $cmv3_definition_activation_overlap$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_definition_activations_v3'::regclass
      and conname = 'cmv3_definition_activation_no_overlap'
  ) then
    alter table public.clinical_measurement_definition_activations_v3
      add constraint cmv3_definition_activation_no_overlap
      exclude using gist (
        organization_id with =,
        definition_id with =,
        tstzrange(
          effective_from,
          coalesce(effective_until, 'infinity'::timestamptz),
          '[)'
        ) with &&
      ) where (superseded_at is null);
  end if;
end;
$cmv3_definition_activation_overlap$;

-- ---------------------------------------------------------------------------
-- Stable phase identity and immutable phase versions. Definition version changes
-- remain orthogonal to phase changes; neither dimension fabricates the other.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_phases_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  phase_key text not null,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'ARCHIVED')),
  archived_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cmv3_phase_key_nonempty
    check (length(trim(phase_key)) between 1 and 180),
  constraint cmv3_phase_archive_shape
    check ((status = 'ARCHIVED' and archived_at is not null) or (status <> 'ARCHIVED' and archived_at is null)),
  foreign key (target_id, organization_id, patient_id)
    references public.clinical_measurement_targets_v3(id, organization_id, patient_id)
    on delete restrict,
  unique (target_id, phase_key),
  unique (id, organization_id, patient_id, target_id)
);

create index if not exists idx_cmv3_phases_target
  on public.clinical_measurement_phases_v3
  (organization_id, patient_id, target_id, status, created_at desc);

create table if not exists public.clinical_measurement_phase_versions_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  phase_id uuid not null,
  version integer not null check (version > 0),
  phase_type text not null
    check (phase_type in (
      'BASELINE', 'INTERVENTION', 'PROCEDURE_CHANGE', 'MAINTENANCE',
      'GENERALIZATION', 'PAUSE', 'GOAL_CHANGE', 'INSTRUMENT_CHANGE',
      'CONTEXT_EVENT'
    )),
  label text not null,
  content jsonb not null default '{}'::jsonb,
  phase_hash text not null,
  status text not null default 'PUBLISHED'
    check (status in ('PUBLISHED', 'DEPRECATED', 'ARCHIVED')),
  published_at timestamptz not null default now(),
  deprecated_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cmv3_phase_version_label_nonempty
    check (length(trim(label)) between 1 and 240),
  constraint cmv3_phase_version_content_object
    check (jsonb_typeof(content) = 'object'),
  constraint cmv3_phase_version_hash_shape
    check (phase_hash ~ '^[0-9a-f]{64}$'),
  constraint cmv3_phase_version_lifecycle check (
    (status = 'PUBLISHED' and deprecated_at is null)
    or (status in ('DEPRECATED', 'ARCHIVED') and deprecated_at is not null)
  ),
  foreign key (phase_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_phases_v3(id, organization_id, patient_id, target_id)
    on delete restrict,
  unique (phase_id, version),
  unique (id, organization_id, patient_id, target_id),
  unique (id, organization_id, patient_id, target_id, phase_id)
);

create index if not exists idx_cmv3_phase_versions_lookup
  on public.clinical_measurement_phase_versions_v3
  (organization_id, patient_id, target_id, phase_id, version desc);

-- ---------------------------------------------------------------------------
-- Bitemporal phase epochs. Current-truth epochs for one target cannot overlap.
-- Retrospective correction is represented by a new row that supersedes a prior
-- knowledge row; the original remains available for AS RECORDED reconstruction.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_phase_epochs_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  phase_id uuid not null,
  phase_version_id uuid not null,
  effective_from timestamptz not null,
  effective_until timestamptz,
  recorded_at timestamptz not null default now(),
  epoch_mode text not null default 'PROSPECTIVE'
    check (epoch_mode in ('PROSPECTIVE', 'RETROSPECTIVE_CORRECTION')),
  supersedes_epoch_id uuid,
  superseded_at timestamptz,
  reason text,
  created_by text,
  constraint cmv3_phase_epoch_window
    check (effective_until is null or effective_until > effective_from),
  constraint cmv3_phase_epoch_supersession_time
    check (superseded_at is null or superseded_at >= recorded_at),
  constraint cmv3_phase_epoch_not_self
    check (supersedes_epoch_id is null or supersedes_epoch_id <> id),
  foreign key (phase_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_phases_v3(id, organization_id, patient_id, target_id)
    on delete restrict,
  foreign key (phase_version_id, organization_id, patient_id, target_id, phase_id)
    references public.clinical_measurement_phase_versions_v3(
      id, organization_id, patient_id, target_id, phase_id
    ) on delete restrict,
  unique (id, organization_id, patient_id, target_id, phase_id),
  unique (id, organization_id, patient_id, target_id, phase_version_id),
  foreign key (supersedes_epoch_id, organization_id, patient_id, target_id, phase_id)
    references public.clinical_measurement_phase_epochs_v3(
      id, organization_id, patient_id, target_id, phase_id
    ) on delete restrict
);

create index if not exists idx_cmv3_phase_epochs_timeline
  on public.clinical_measurement_phase_epochs_v3
  (organization_id, patient_id, target_id, effective_from desc, recorded_at desc);
create index if not exists idx_cmv3_phase_epochs_current
  on public.clinical_measurement_phase_epochs_v3
  (organization_id, target_id, effective_from desc)
  where superseded_at is null;

do $cmv3_phase_epoch_overlap$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_phase_epochs_v3'::regclass
      and conname = 'cmv3_phase_epoch_no_overlap'
  ) then
    alter table public.clinical_measurement_phase_epochs_v3
      add constraint cmv3_phase_epoch_no_overlap
      exclude using gist (
        organization_id with =,
        target_id with =,
        tstzrange(
          effective_from,
          coalesce(effective_until, 'infinity'::timestamptz),
          '[)'
        ) with &&
      ) where (superseded_at is null);
  end if;
end;
$cmv3_phase_epoch_overlap$;

-- ---------------------------------------------------------------------------
-- Immutable server-side collection contract snapshot. Session binding arrives in
-- Migration B; this table only establishes the versioned identity needed by it.
-- phase_epoch_id is nullable because not every specialty metric requires phases.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_collection_protocol_snapshots_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  definition_activation_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  phase_version_id uuid,
  schema_version integer not null default 3 check (schema_version = 3),
  snapshot jsonb not null,
  snapshot_hash text not null,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cmv3_protocol_snapshot_object
    check (jsonb_typeof(snapshot) = 'object'),
  constraint cmv3_protocol_snapshot_hash_shape
    check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  constraint cmv3_protocol_snapshot_phase_shape
    check ((phase_epoch_id is null and phase_version_id is null) or (phase_epoch_id is not null and phase_version_id is not null)),
  foreign key (definition_activation_id, organization_id, patient_id, target_id, definition_version_id)
    references public.clinical_measurement_definition_activations_v3(
      id, organization_id, patient_id, target_id, definition_version_id
    ) on delete restrict,
  foreign key (definition_version_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_definition_versions_v3(
      id, organization_id, patient_id, target_id
    ) on delete restrict,
  foreign key (phase_epoch_id, organization_id, patient_id, target_id, phase_version_id)
    references public.clinical_measurement_phase_epochs_v3(
      id, organization_id, patient_id, target_id, phase_version_id
    ) on delete restrict,
  unique (id, organization_id, patient_id, target_id)
);

create index if not exists idx_cmv3_protocol_snapshots_target
  on public.clinical_collection_protocol_snapshots_v3
  (organization_id, patient_id, target_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Scope validation: polymorphic source references are checked against the tenant
-- and patient explicitly. IDs never confer authority or valid clinical scope.
-- ---------------------------------------------------------------------------
create or replace function public.validate_clinical_measurement_target_scope_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_patient_clinic_id uuid;
  v_source_patient_id uuid;
  v_source_org_text text;
  v_source_clinic_text text;
begin
  select patient.clinic_id
    into v_patient_clinic_id
  from public.patients patient
  where patient.id = new.patient_id;

  if not found or v_patient_clinic_id is distinct from new.organization_id then
    raise exception 'CMV3_PATIENT_SCOPE_INVALID';
  end if;

  if new.source_kind = 'ABA_TARGET' then
    select target.patient_id, target.clinic_id
      into v_source_patient_id, v_source_clinic_text
    from public.aba_targets target
    where target.id = new.aba_target_id;

    if not found
       or v_source_patient_id is distinct from new.patient_id
       or v_source_clinic_text is distinct from new.organization_id::text then
      raise exception 'CMV3_ABA_TARGET_SCOPE_INVALID';
    end if;
  elsif new.source_kind = 'THERAPEUTIC_OBJECTIVE' then
    select objective.patient_id, objective.organization_id
      into v_source_patient_id, v_source_org_text
    from public.patient_therapeutic_objectives objective
    where objective.id = new.therapeutic_objective_id;

    if not found
       or v_source_patient_id is distinct from new.patient_id
       or v_source_org_text is distinct from new.organization_id::text then
      raise exception 'CMV3_THERAPEUTIC_OBJECTIVE_SCOPE_INVALID';
    end if;
  elsif new.source_kind in ('PLAN_TARGET', 'PLAN_GOAL') then
    select plan.patient_id, plan.organization_id
      into v_source_patient_id, v_source_org_text
    from public.patient_therapeutic_plans plan
    where plan.id = new.therapeutic_plan_id;

    if not found
       or v_source_patient_id is distinct from new.patient_id
       or v_source_org_text is distinct from new.organization_id::text then
      raise exception 'CMV3_THERAPEUTIC_PLAN_SCOPE_INVALID';
    end if;
  end if;

  return new;
end;
$function$;

-- The server owns hashes and the semantic-family discriminator embedded in the
-- family-specific content object. Clients cannot forge either value.
create or replace function public.prepare_clinical_measurement_definition_version_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_family text;
begin
  select definition.semantic_family
    into v_family
  from public.clinical_measurement_definitions_v3 definition
  where definition.id = new.definition_id
    and definition.organization_id = new.organization_id
    and definition.patient_id = new.patient_id
    and definition.target_id = new.target_id;

  if not found then
    raise exception 'CMV3_DEFINITION_SCOPE_INVALID';
  end if;

  if upper(coalesce(new.content->>'kind', '')) is distinct from v_family then
    raise exception 'CMV3_DEFINITION_CONTENT_KIND_MISMATCH';
  end if;

  new.definition_hash := encode(
    digest(
      convert_to(
        jsonb_build_object(
          'semantic_family', v_family,
          'unit_code', new.unit_code,
          'unit_label', new.unit_label,
          'directionality', new.directionality,
          'content', new.content,
          'aggregation_policy', new.aggregation_policy
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$function$;

create or replace function public.prepare_clinical_measurement_phase_version_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
begin
  new.phase_hash := encode(
    digest(
      convert_to(
        jsonb_build_object(
          'phase_type', new.phase_type,
          'label', new.label,
          'content', new.content
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$function$;

create or replace function public.prepare_clinical_collection_protocol_snapshot_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
begin
  new.snapshot_hash := encode(
    digest(convert_to(new.snapshot::text, 'UTF8'), 'sha256'),
    'hex'
  );
  return new;
end;
$function$;

create or replace function public.prepare_clinical_measurement_bitemporal_record_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  -- recorded_at is system knowledge time. It is never accepted from a client.
  new.recorded_at := clock_timestamp();
  return new;
end;
$function$;

-- Stable identities may only be archived/paused through lifecycle fields; source,
-- scope, mathematical family and identity keys are immutable.
create or replace function public.guard_clinical_measurement_identity_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'CMV3_IDENTITY_DELETE_FORBIDDEN';
  end if;

  if (to_jsonb(old) - array['status', 'archived_at']::text[])
     is distinct from
     (to_jsonb(new) - array['status', 'archived_at']::text[]) then
    raise exception 'CMV3_IDENTITY_IMMUTABLE';
  end if;

  if old.status = 'ARCHIVED' and new.status <> 'ARCHIVED' then
    raise exception 'CMV3_IDENTITY_ARCHIVED_FINAL';
  end if;

  return new;
end;
$function$;

create or replace function public.guard_clinical_measurement_version_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'CMV3_VERSION_DELETE_FORBIDDEN';
  end if;

  if (to_jsonb(old) - array['status', 'deprecated_at']::text[])
     is distinct from
     (to_jsonb(new) - array['status', 'deprecated_at']::text[]) then
    raise exception 'CMV3_VERSION_IMMUTABLE';
  end if;

  if old.status = 'ARCHIVED' and new.status <> 'ARCHIVED' then
    raise exception 'CMV3_VERSION_ARCHIVED_FINAL';
  end if;

  if old.status = 'DEPRECATED' and new.status = 'PUBLISHED' then
    raise exception 'CMV3_VERSION_REACTIVATION_FORBIDDEN';
  end if;

  return new;
end;
$function$;

-- Bitemporal activation/epoch semantic fields are immutable. Only superseded_at
-- may be annotated once to close the knowledge interval of the old row.
create or replace function public.guard_clinical_measurement_bitemporal_record_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'CMV3_BITEMPORAL_DELETE_FORBIDDEN';
  end if;

  if (to_jsonb(old) - 'superseded_at')
     is distinct from
     (to_jsonb(new) - 'superseded_at') then
    raise exception 'CMV3_BITEMPORAL_RECORD_IMMUTABLE';
  end if;

  if old.superseded_at is not null then
    raise exception 'CMV3_BITEMPORAL_SUPERSESSION_FINAL';
  end if;

  if new.superseded_at is null or new.superseded_at < old.recorded_at then
    raise exception 'CMV3_BITEMPORAL_SUPERSESSION_INVALID';
  end if;

  return new;
end;
$function$;

create or replace function public.guard_clinical_collection_protocol_snapshot_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'CMV3_PROTOCOL_SNAPSHOT_IMMUTABLE';
end;
$function$;

-- Triggers ------------------------------------------------------------------
drop trigger if exists validate_clinical_measurement_target_scope_v3
  on public.clinical_measurement_targets_v3;
create trigger validate_clinical_measurement_target_scope_v3
before insert or update on public.clinical_measurement_targets_v3
for each row execute function public.validate_clinical_measurement_target_scope_v3();

drop trigger if exists prepare_clinical_measurement_definition_version_v3
  on public.clinical_measurement_definition_versions_v3;
create trigger prepare_clinical_measurement_definition_version_v3
before insert on public.clinical_measurement_definition_versions_v3
for each row execute function public.prepare_clinical_measurement_definition_version_v3();

drop trigger if exists prepare_clinical_measurement_phase_version_v3
  on public.clinical_measurement_phase_versions_v3;
create trigger prepare_clinical_measurement_phase_version_v3
before insert on public.clinical_measurement_phase_versions_v3
for each row execute function public.prepare_clinical_measurement_phase_version_v3();

drop trigger if exists prepare_clinical_collection_protocol_snapshot_v3
  on public.clinical_collection_protocol_snapshots_v3;
create trigger prepare_clinical_collection_protocol_snapshot_v3
before insert on public.clinical_collection_protocol_snapshots_v3
for each row execute function public.prepare_clinical_collection_protocol_snapshot_v3();

drop trigger if exists prepare_cmv3_definition_activation_recorded_at
  on public.clinical_measurement_definition_activations_v3;
create trigger prepare_cmv3_definition_activation_recorded_at
before insert on public.clinical_measurement_definition_activations_v3
for each row execute function public.prepare_clinical_measurement_bitemporal_record_v3();

drop trigger if exists prepare_cmv3_phase_epoch_recorded_at
  on public.clinical_measurement_phase_epochs_v3;
create trigger prepare_cmv3_phase_epoch_recorded_at
before insert on public.clinical_measurement_phase_epochs_v3
for each row execute function public.prepare_clinical_measurement_bitemporal_record_v3();


-- Identity immutability guards.
drop trigger if exists guard_cmv3_target_identity
  on public.clinical_measurement_targets_v3;
create trigger guard_cmv3_target_identity
before update or delete on public.clinical_measurement_targets_v3
for each row execute function public.guard_clinical_measurement_identity_v3();

drop trigger if exists guard_cmv3_definition_identity
  on public.clinical_measurement_definitions_v3;
create trigger guard_cmv3_definition_identity
before update or delete on public.clinical_measurement_definitions_v3
for each row execute function public.guard_clinical_measurement_identity_v3();

drop trigger if exists guard_cmv3_phase_identity
  on public.clinical_measurement_phases_v3;
create trigger guard_cmv3_phase_identity
before update or delete on public.clinical_measurement_phases_v3
for each row execute function public.guard_clinical_measurement_identity_v3();

-- Version immutability guards.
drop trigger if exists guard_cmv3_definition_version
  on public.clinical_measurement_definition_versions_v3;
create trigger guard_cmv3_definition_version
before update or delete on public.clinical_measurement_definition_versions_v3
for each row execute function public.guard_clinical_measurement_version_v3();

drop trigger if exists guard_cmv3_phase_version
  on public.clinical_measurement_phase_versions_v3;
create trigger guard_cmv3_phase_version
before update or delete on public.clinical_measurement_phase_versions_v3
for each row execute function public.guard_clinical_measurement_version_v3();

-- Bitemporal knowledge guards.
drop trigger if exists guard_cmv3_definition_activation
  on public.clinical_measurement_definition_activations_v3;
create trigger guard_cmv3_definition_activation
before update or delete on public.clinical_measurement_definition_activations_v3
for each row execute function public.guard_clinical_measurement_bitemporal_record_v3();

drop trigger if exists guard_cmv3_phase_epoch
  on public.clinical_measurement_phase_epochs_v3;
create trigger guard_cmv3_phase_epoch
before update or delete on public.clinical_measurement_phase_epochs_v3
for each row execute function public.guard_clinical_measurement_bitemporal_record_v3();

drop trigger if exists guard_cmv3_protocol_snapshot
  on public.clinical_collection_protocol_snapshots_v3;
create trigger guard_cmv3_protocol_snapshot
before update or delete on public.clinical_collection_protocol_snapshots_v3
for each row execute function public.guard_clinical_collection_protocol_snapshot_v3();

-- Dark-deploy security: Migration A intentionally exposes no browser table and
-- no browser RPC. RLS + revoked privileges fail closed; later migrations may
-- expose narrowly authorized server/RPC surfaces without reopening these tables.
alter table public.clinical_measurement_targets_v3 enable row level security;
alter table public.clinical_measurement_definitions_v3 enable row level security;
alter table public.clinical_measurement_definition_versions_v3 enable row level security;
alter table public.clinical_measurement_definition_activations_v3 enable row level security;
alter table public.clinical_measurement_phases_v3 enable row level security;
alter table public.clinical_measurement_phase_versions_v3 enable row level security;
alter table public.clinical_measurement_phase_epochs_v3 enable row level security;
alter table public.clinical_collection_protocol_snapshots_v3 enable row level security;

revoke all on table public.clinical_measurement_targets_v3 from public, anon, authenticated;
revoke all on table public.clinical_measurement_definitions_v3 from public, anon, authenticated;
revoke all on table public.clinical_measurement_definition_versions_v3 from public, anon, authenticated;
revoke all on table public.clinical_measurement_definition_activations_v3 from public, anon, authenticated;
revoke all on table public.clinical_measurement_phases_v3 from public, anon, authenticated;
revoke all on table public.clinical_measurement_phase_versions_v3 from public, anon, authenticated;
revoke all on table public.clinical_measurement_phase_epochs_v3 from public, anon, authenticated;
revoke all on table public.clinical_collection_protocol_snapshots_v3 from public, anon, authenticated;

grant all on table public.clinical_measurement_targets_v3 to service_role;
grant all on table public.clinical_measurement_definitions_v3 to service_role;
grant all on table public.clinical_measurement_definition_versions_v3 to service_role;
grant all on table public.clinical_measurement_definition_activations_v3 to service_role;
grant all on table public.clinical_measurement_phases_v3 to service_role;
grant all on table public.clinical_measurement_phase_versions_v3 to service_role;
grant all on table public.clinical_measurement_phase_epochs_v3 to service_role;
grant all on table public.clinical_collection_protocol_snapshots_v3 to service_role;

revoke all on function public.validate_clinical_measurement_target_scope_v3() from public, anon, authenticated;
revoke all on function public.prepare_clinical_measurement_definition_version_v3() from public, anon, authenticated;
revoke all on function public.prepare_clinical_measurement_phase_version_v3() from public, anon, authenticated;
revoke all on function public.prepare_clinical_collection_protocol_snapshot_v3() from public, anon, authenticated;
revoke all on function public.prepare_clinical_measurement_bitemporal_record_v3() from public, anon, authenticated;
revoke all on function public.guard_clinical_measurement_identity_v3() from public, anon, authenticated;
revoke all on function public.guard_clinical_measurement_version_v3() from public, anon, authenticated;
revoke all on function public.guard_clinical_measurement_bitemporal_record_v3() from public, anon, authenticated;
revoke all on function public.guard_clinical_collection_protocol_snapshot_v3() from public, anon, authenticated;

-- Explicit preservation invariant: no existing V2/ABA V3 row is inserted,
-- updated, deleted, backfilled, reinterpreted or exposed by this migration.

commit;
