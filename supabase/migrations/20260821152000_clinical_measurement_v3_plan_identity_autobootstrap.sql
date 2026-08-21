-- Clinical Measurement Engine V3 — plan/objective identity autobootstrap.
--
-- Marco 1 of PTS & Specialty convergence:
--   * connects THERAPEUTIC_OBJECTIVE and PLAN_GOAL sources to the universal V3 identity layer;
--   * preserves all existing plans/objectives and their historical payloads;
--   * performs set-based, idempotent backfill for current source rows;
--   * keeps source identities stable across title edits when a PTS goal id exists;
--   * never writes clinical evidence, definitions, phases, sessions, or legacy graph rows;
--   * never deletes V3 identities. Removed/cancelled/draft plan goals are PAUSED, so a later
--     correction/re-activation can safely reuse the same immutable identity.
--
-- This migration deliberately does NOT change the UI or graph readers yet.

begin;

-- Generic safe UUID parser for the universal V3 layer. Historical rows with malformed
-- tenant identifiers are skipped rather than broadening scope or aborting unrelated writes.
create or replace function public.clinical_measurement_try_uuid_v3(p_value text)
returns uuid
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
begin
  if nullif(btrim(coalesce(p_value, '')), '') is null then
    return null;
  end if;
  return btrim(p_value)::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$function$;

revoke all on function public.clinical_measurement_try_uuid_v3(text)
  from public, anon, authenticated;
grant execute on function public.clinical_measurement_try_uuid_v3(text)
  to service_role;

-- Produces the CURRENT stable goal identities for one saved plan without mutating it.
-- PTS goal ids are authoritative when pts_payload.goals exists. Legacy title-only arrays
-- use deterministic hashes as a compatibility fallback, deduplicated across common and
-- specialty projections so the same conceptual goal is not registered twice.
create or replace function public.clinical_measurement_v3_plan_goal_sources_v1(
  p_plan public.patient_therapeutic_plans
)
returns table (
  source_goal_key text,
  specialty text,
  target_status text
)
language sql
stable
set search_path = pg_catalog, public
as $function$
with pts_raw as (
  select goal.value
  from pg_catalog.jsonb_array_elements(
    case
      when pg_catalog.jsonb_typeof(coalesce(p_plan.pts_payload, '{}'::jsonb) -> 'goals') = 'array'
        then coalesce(p_plan.pts_payload, '{}'::jsonb) -> 'goals'
      else '[]'::jsonb
    end
  ) as goal(value)
),
pts_prepared as (
  select
    case
      when nullif(btrim(coalesce(value ->> 'id', '')), '') is not null
           and length(btrim(value ->> 'id')) <= 100
        then 'pts:' || btrim(value ->> 'id')
      else 'pts-legacy:' || pg_catalog.md5(
        'title:' || lower(pg_catalog.regexp_replace(btrim(coalesce(value ->> 'title', '')), '\\s+', ' ', 'g'))
      )
    end as source_goal_key,
    case
      when pg_catalog.jsonb_typeof(value -> 'specialties') = 'array'
           and pg_catalog.jsonb_array_length(value -> 'specialties') = 1
        then nullif(btrim(value -> 'specialties' ->> 0), '')
      when lower(coalesce(p_plan.mode, '')) = 'specialty'
        then nullif(btrim(coalesce(p_plan.specialty, '')), '')
      else null
    end as specialty,
    case
      when lower(coalesce(p_plan.status, '')) <> 'active' then 'PAUSED'
      when lower(coalesce(value ->> 'status', '')) in ('paused', 'cancelled') then 'PAUSED'
      else 'ACTIVE'
    end as target_status
  from pts_raw
  where nullif(btrim(coalesce(value ->> 'title', '')), '') is not null
),
pts_goals as (
  select distinct on (source_goal_key)
    source_goal_key,
    specialty,
    target_status
  from pts_prepared
  where nullif(source_goal_key, '') is not null
  order by source_goal_key, specialty nulls last
),
legacy_common as (
  select
    case when pg_catalog.jsonb_typeof(item.value) = 'object' then item.value ->> 'id' else null end as source_id,
    case pg_catalog.jsonb_typeof(item.value)
      when 'string' then item.value #>> '{}'
      when 'object' then coalesce(item.value ->> 'title', item.value ->> 'description')
      else null
    end as title,
    null::text as specialty
  from pg_catalog.jsonb_array_elements(
    case
      when pg_catalog.jsonb_typeof(coalesce(p_plan.common_objectives, '[]'::jsonb)) = 'array'
        then coalesce(p_plan.common_objectives, '[]'::jsonb)
      else '[]'::jsonb
    end
  ) as item(value)
),
legacy_specialty as (
  select
    case when pg_catalog.jsonb_typeof(item.value) = 'object' then item.value ->> 'id' else null end as source_id,
    case pg_catalog.jsonb_typeof(item.value)
      when 'string' then item.value #>> '{}'
      when 'object' then coalesce(item.value ->> 'title', item.value ->> 'description')
      else null
    end as title,
    nullif(btrim(spec.specialty_key), '') as specialty
  from pg_catalog.jsonb_each(
    case
      when pg_catalog.jsonb_typeof(coalesce(p_plan.specialty_objectives, '{}'::jsonb)) = 'object'
        then coalesce(p_plan.specialty_objectives, '{}'::jsonb)
      else '{}'::jsonb
    end
  ) as spec(specialty_key, objectives)
  cross join lateral pg_catalog.jsonb_array_elements(
    case when pg_catalog.jsonb_typeof(spec.objectives) = 'array' then spec.objectives else '[]'::jsonb end
  ) as item(value)
),
legacy_prepared as (
  select
    'legacy:' || pg_catalog.md5(
      case
        when nullif(btrim(coalesce(source_id, '')), '') is not null
          then 'id:' || btrim(source_id)
        else 'title:' || lower(pg_catalog.regexp_replace(btrim(coalesce(title, '')), '\\s+', ' ', 'g'))
      end
    ) as source_goal_key,
    specialty
  from (
    select * from legacy_common
    union all
    select * from legacy_specialty
  ) source_rows
  where nullif(btrim(coalesce(title, '')), '') is not null
),
legacy_goals as (
  select
    source_goal_key,
    case
      when count(distinct specialty) filter (where specialty is not null) = 1
        then max(specialty) filter (where specialty is not null)
      when lower(coalesce(p_plan.mode, '')) = 'specialty'
        then nullif(btrim(coalesce(p_plan.specialty, '')), '')
      else null
    end as specialty,
    case when lower(coalesce(p_plan.status, '')) = 'active' then 'ACTIVE' else 'PAUSED' end as target_status
  from legacy_prepared
  group by source_goal_key
)
select p.source_goal_key, p.specialty, p.target_status
from pts_goals p
union all
select l.source_goal_key, l.specialty, l.target_status
from legacy_goals l
where not exists (select 1 from pts_goals);
$function$;

revoke all on function public.clinical_measurement_v3_plan_goal_sources_v1(
  public.patient_therapeutic_plans
) from public, anon, authenticated;
grant execute on function public.clinical_measurement_v3_plan_goal_sources_v1(
  public.patient_therapeutic_plans
) to service_role;

create or replace function public.sync_clinical_measurement_v3_therapeutic_objective_identity_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_org uuid;
  v_status text;
begin
  v_org := public.clinical_measurement_try_uuid_v3(new.organization_id);
  if v_org is null or new.patient_id is null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('CMV3_OBJECTIVE_IDENTITY:' || new.id::text, 0)
  );

  -- A stable source id must never silently migrate between tenants/patients.
  if exists (
    select 1
    from public.clinical_measurement_targets_v3 t
    where t.source_kind = 'THERAPEUTIC_OBJECTIVE'
      and t.therapeutic_objective_id = new.id
      and (t.organization_id is distinct from v_org or t.patient_id is distinct from new.patient_id)
  ) then
    raise exception 'CMV3_THERAPEUTIC_OBJECTIVE_IDENTITY_SCOPE_CONFLICT';
  end if;

  -- Source lifecycle remains reversible in the current product. We therefore use
  -- PAUSED for non-active source states; V3 ARCHIVED is intentionally final.
  v_status := case when upper(coalesce(new.status, '')) = 'ACTIVE' then 'ACTIVE' else 'PAUSED' end;

  insert into public.clinical_measurement_targets_v3 (
    organization_id,
    patient_id,
    target_key,
    source_kind,
    therapeutic_objective_id,
    status,
    archived_at,
    created_by
  ) values (
    v_org,
    new.patient_id,
    'therapeutic_objective:' || new.id::text,
    'THERAPEUTIC_OBJECTIVE',
    new.id,
    v_status,
    null,
    coalesce(nullif(btrim(new.updated_by), ''), nullif(btrim(new.created_by), ''))
  )
  on conflict (organization_id, therapeutic_objective_id)
    where source_kind = 'THERAPEUTIC_OBJECTIVE'
  do update set
    status = case
      when clinical_measurement_targets_v3.status = 'ARCHIVED' then 'ARCHIVED'
      else excluded.status
    end,
    archived_at = case
      when clinical_measurement_targets_v3.status = 'ARCHIVED'
        then clinical_measurement_targets_v3.archived_at
      else null
    end;

  return new;
end;
$function$;

revoke all on function public.sync_clinical_measurement_v3_therapeutic_objective_identity_v1()
  from public, anon, authenticated, service_role;

create or replace function public.sync_clinical_measurement_v3_plan_goal_identities_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_org uuid;
  v_plan public.patient_therapeutic_plans%rowtype;
  v_goal_keys text[] := '{}'::text[];
begin
  v_org := public.clinical_measurement_try_uuid_v3(new.organization_id);
  if v_org is null or new.patient_id is null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('CMV3_PLAN_GOAL_IDENTITIES:' || new.id::text, 0)
  );

  -- A plan source id is globally stable even though the original partial index is
  -- tenant-qualified. Refuse a cross-tenant/patient rebinding rather than duplicating it.
  if exists (
    select 1
    from public.clinical_measurement_targets_v3 t
    where t.source_kind = 'PLAN_GOAL'
      and t.therapeutic_plan_id = new.id
      and (t.organization_id is distinct from v_org or t.patient_id is distinct from new.patient_id)
  ) then
    raise exception 'CMV3_PLAN_GOAL_IDENTITY_SCOPE_CONFLICT';
  end if;

  v_plan := new;

  select coalesce(array_agg(g.source_goal_key order by g.source_goal_key), '{}'::text[])
  into v_goal_keys
  from public.clinical_measurement_v3_plan_goal_sources_v1(v_plan) g;

  insert into public.clinical_measurement_targets_v3 (
    organization_id,
    patient_id,
    target_key,
    source_kind,
    therapeutic_plan_id,
    source_goal_key,
    specialty,
    status,
    archived_at,
    created_by
  )
  select
    v_org,
    new.patient_id,
    'plan_goal:' || new.id::text || ':' || g.source_goal_key,
    'PLAN_GOAL',
    new.id,
    g.source_goal_key,
    nullif(btrim(g.specialty), ''),
    g.target_status,
    null,
    coalesce(nullif(btrim(new.updated_by), ''), nullif(btrim(new.created_by), ''))
  from public.clinical_measurement_v3_plan_goal_sources_v1(v_plan) g
  on conflict (organization_id, therapeutic_plan_id, source_goal_key)
    where source_kind = 'PLAN_GOAL'
  do update set
    status = case
      when clinical_measurement_targets_v3.status = 'ARCHIVED' then 'ARCHIVED'
      else excluded.status
    end,
    archived_at = case
      when clinical_measurement_targets_v3.status = 'ARCHIVED'
        then clinical_measurement_targets_v3.archived_at
      else null
    end;

  -- Removed goals are retained as immutable identities and merely paused. This is
  -- reversible and guarantees that an undo/re-add reuses the exact same target id.
  update public.clinical_measurement_targets_v3 t
  set status = 'PAUSED',
      archived_at = null
  where t.organization_id = v_org
    and t.patient_id = new.patient_id
    and t.source_kind = 'PLAN_GOAL'
    and t.therapeutic_plan_id = new.id
    and t.status <> 'ARCHIVED'
    and not (t.source_goal_key = any(v_goal_keys))
    and (t.status <> 'PAUSED' or t.archived_at is not null);

  return new;
end;
$function$;

revoke all on function public.sync_clinical_measurement_v3_plan_goal_identities_v1()
  from public, anon, authenticated, service_role;

-- Install triggers BEFORE the set-based backfill so concurrent future writes cannot
-- escape the identity layer while the migration is being applied.
drop trigger if exists trg_sync_cmv3_therapeutic_objective_identity_v1
  on public.patient_therapeutic_objectives;
create trigger trg_sync_cmv3_therapeutic_objective_identity_v1
after insert or update of organization_id, patient_id, status
on public.patient_therapeutic_objectives
for each row
execute function public.sync_clinical_measurement_v3_therapeutic_objective_identity_v1();

drop trigger if exists trg_sync_cmv3_plan_goal_identities_v1
  on public.patient_therapeutic_plans;
create trigger trg_sync_cmv3_plan_goal_identities_v1
after insert or update of
  organization_id,
  patient_id,
  mode,
  specialty,
  participant_specialties,
  common_objectives,
  specialty_objectives,
  pts_payload,
  status
on public.patient_therapeutic_plans
for each row
execute function public.sync_clinical_measurement_v3_plan_goal_identities_v1();

-- Existing therapeutic objectives: one set-based, idempotent registration pass.
insert into public.clinical_measurement_targets_v3 (
  organization_id,
  patient_id,
  target_key,
  source_kind,
  therapeutic_objective_id,
  status,
  archived_at,
  created_by
)
select
  parsed.organization_id,
  objective.patient_id,
  'therapeutic_objective:' || objective.id::text,
  'THERAPEUTIC_OBJECTIVE',
  objective.id,
  case when upper(coalesce(objective.status, '')) = 'ACTIVE' then 'ACTIVE' else 'PAUSED' end,
  null,
  coalesce(nullif(btrim(objective.updated_by), ''), nullif(btrim(objective.created_by), ''))
from public.patient_therapeutic_objectives objective
cross join lateral (
  select public.clinical_measurement_try_uuid_v3(objective.organization_id) as organization_id
) parsed
where parsed.organization_id is not null
  and exists (
    select 1
    from public.patients patient
    where patient.id = objective.patient_id
      and patient.clinic_id = parsed.organization_id
  )
on conflict (organization_id, therapeutic_objective_id)
  where source_kind = 'THERAPEUTIC_OBJECTIVE'
do update set
  status = case
    when clinical_measurement_targets_v3.status = 'ARCHIVED' then 'ARCHIVED'
    else excluded.status
  end,
  archived_at = case
    when clinical_measurement_targets_v3.status = 'ARCHIVED'
      then clinical_measurement_targets_v3.archived_at
    else null
  end;

-- Existing specialty/PTS goals: one set-based pass, reading only each plan's current
-- compact goal payload. No N+1 server requests and no raw evidence scan are introduced.
insert into public.clinical_measurement_targets_v3 (
  organization_id,
  patient_id,
  target_key,
  source_kind,
  therapeutic_plan_id,
  source_goal_key,
  specialty,
  status,
  archived_at,
  created_by
)
select
  parsed.organization_id,
  plan.patient_id,
  'plan_goal:' || plan.id::text || ':' || goal.source_goal_key,
  'PLAN_GOAL',
  plan.id,
  goal.source_goal_key,
  nullif(btrim(goal.specialty), ''),
  goal.target_status,
  null,
  coalesce(nullif(btrim(plan.updated_by), ''), nullif(btrim(plan.created_by), ''))
from public.patient_therapeutic_plans plan
cross join lateral (
  select public.clinical_measurement_try_uuid_v3(plan.organization_id) as organization_id
) parsed
cross join lateral public.clinical_measurement_v3_plan_goal_sources_v1(plan) goal
where parsed.organization_id is not null
  and exists (
    select 1
    from public.patients patient
    where patient.id = plan.patient_id
      and patient.clinic_id = parsed.organization_id
  )
on conflict (organization_id, therapeutic_plan_id, source_goal_key)
  where source_kind = 'PLAN_GOAL'
do update set
  status = case
    when clinical_measurement_targets_v3.status = 'ARCHIVED' then 'ARCHIVED'
    else excluded.status
  end,
  archived_at = case
    when clinical_measurement_targets_v3.status = 'ARCHIVED'
      then clinical_measurement_targets_v3.archived_at
    else null
  end;

-- Installation attestation: fail the migration if a trigger is absent or a privileged
-- sync trigger became directly executable by browser roles.
do $attest$
begin
  if to_regprocedure('public.clinical_measurement_v3_plan_goal_sources_v1(public.patient_therapeutic_plans)') is null then
    raise exception 'CMV3_PLAN_GOAL_SOURCE_EXTRACTOR_MISSING';
  end if;
  if to_regprocedure('public.sync_clinical_measurement_v3_therapeutic_objective_identity_v1()') is null then
    raise exception 'CMV3_THERAPEUTIC_OBJECTIVE_SYNC_MISSING';
  end if;
  if to_regprocedure('public.sync_clinical_measurement_v3_plan_goal_identities_v1()') is null then
    raise exception 'CMV3_PLAN_GOAL_SYNC_MISSING';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.patient_therapeutic_objectives'::regclass
      and trigger_row.tgname = 'trg_sync_cmv3_therapeutic_objective_identity_v1'
      and not trigger_row.tgisinternal
      and trigger_row.tgenabled <> 'D'
  ) then
    raise exception 'CMV3_THERAPEUTIC_OBJECTIVE_TRIGGER_MISSING';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.patient_therapeutic_plans'::regclass
      and trigger_row.tgname = 'trg_sync_cmv3_plan_goal_identities_v1'
      and not trigger_row.tgisinternal
      and trigger_row.tgenabled <> 'D'
  ) then
    raise exception 'CMV3_PLAN_GOAL_TRIGGER_MISSING';
  end if;

  if coalesce(pg_catalog.has_function_privilege(
      'anon',
      pg_catalog.to_regprocedure('public.sync_clinical_measurement_v3_therapeutic_objective_identity_v1()'),
      'EXECUTE'
    ), false)
    or coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      pg_catalog.to_regprocedure('public.sync_clinical_measurement_v3_therapeutic_objective_identity_v1()'),
      'EXECUTE'
    ), false)
    or coalesce(pg_catalog.has_function_privilege(
      'anon',
      pg_catalog.to_regprocedure('public.sync_clinical_measurement_v3_plan_goal_identities_v1()'),
      'EXECUTE'
    ), false)
    or coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      pg_catalog.to_regprocedure('public.sync_clinical_measurement_v3_plan_goal_identities_v1()'),
      'EXECUTE'
    ), false) then
    raise exception 'CMV3_PLAN_IDENTITY_BROWSER_EXECUTE_OPEN';
  end if;
end;
$attest$;

commit;

select jsonb_build_object(
  'gate', 'CMV3_PLAN_OBJECTIVE_IDENTITY_AUTObootstrap_INSTALLED',
  'therapeutic_objective_identities', (
    select count(*) from public.clinical_measurement_targets_v3 where source_kind = 'THERAPEUTIC_OBJECTIVE'
  ),
  'plan_goal_identities', (
    select count(*) from public.clinical_measurement_targets_v3 where source_kind = 'PLAN_GOAL'
  ),
  'existing_source_rows_mutated', false,
  'clinical_evidence_written', false,
  'browser_sync_execute', false,
  'next', 'GENERIC_V3_PLAN_WRITER'
) as clinical_measurement_v3_plan_identity_autobootstrap;
