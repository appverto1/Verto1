-- Structured Projecto Terapêutico Singular workspace.
-- Additive, idempotent and non-destructive. Existing plans and versions remain intact.

begin;

alter table public.patient_therapeutic_plans
  add column if not exists pts_payload jsonb not null default '{}'::jsonb,
  add column if not exists pts_schema_version smallint not null default 1,
  add column if not exists review_due_date date,
  add column if not exists last_reviewed_at timestamptz;

do $constraints$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.patient_therapeutic_plans'::regclass
      and conname = 'patient_therapeutic_plans_pts_payload_object_v1'
  ) then
    alter table public.patient_therapeutic_plans
      add constraint patient_therapeutic_plans_pts_payload_object_v1
      check (jsonb_typeof(pts_payload) = 'object');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.patient_therapeutic_plans'::regclass
      and conname = 'patient_therapeutic_plans_pts_schema_version_v1'
  ) then
    alter table public.patient_therapeutic_plans
      add constraint patient_therapeutic_plans_pts_schema_version_v1
      check (pts_schema_version = 1);
  end if;
end;
$constraints$;

create index if not exists idx_patient_pts_review_due_v1
  on public.patient_therapeutic_plans (
    organization_id,
    review_due_date,
    patient_id
  )
  where mode = 'interdisciplinary'
    and status in ('draft', 'active', 'paused')
    and review_due_date is not null;

create or replace function public.update_patient_therapeutic_plan_v3(
  p_plan_id uuid,
  p_organization_id text,
  p_patient_id uuid,
  p_expected_version integer,
  p_common_objectives jsonb,
  p_specialty_objectives jsonb,
  p_pts_payload jsonb,
  p_review_due_date date,
  p_last_reviewed_at timestamptz,
  p_status text,
  p_actor_id text,
  p_now timestamptz default now()
)
returns setof public.patient_therapeutic_plans
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_plan public.patient_therapeutic_plans%rowtype;
  v_authorized_reader_ids text[];
begin
  if p_status not in ('draft', 'active', 'paused', 'completed', 'archived') then
    raise exception 'THERAPEUTIC_PLAN_STATUS_INVALID';
  end if;
  if jsonb_typeof(coalesce(p_common_objectives, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_specialty_objectives, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_pts_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'THERAPEUTIC_PLAN_PAYLOAD_INVALID';
  end if;

  select plan.*
  into v_plan
  from public.patient_therapeutic_plans plan
  where plan.id = p_plan_id
    and plan.organization_id = p_organization_id
    and plan.patient_id = p_patient_id
  for update;

  if not found then
    raise exception 'THERAPEUTIC_PLAN_NOT_FOUND';
  end if;

  if v_plan.edit_version <> p_expected_version then
    raise exception 'THERAPEUTIC_PLAN_VERSION_CONFLICT';
  end if;

  v_authorized_reader_ids := array(
    select distinct reader_id
    from unnest(
      array[v_plan.responsible_professional_id]
      || coalesce(v_plan.participant_professional_ids, '{}'::text[])
    ) as reader_id
    where nullif(trim(reader_id), '') is not null
  );

  insert into public.patient_therapeutic_plan_versions (
    plan_id,
    organization_id,
    patient_id,
    version,
    snapshot,
    authored_by,
    authorized_reader_ids,
    created_at
  ) values (
    v_plan.id,
    v_plan.organization_id,
    v_plan.patient_id,
    v_plan.edit_version,
    to_jsonb(v_plan),
    p_actor_id,
    v_authorized_reader_ids,
    p_now
  )
  on conflict (plan_id, version) do nothing;

  return query
  update public.patient_therapeutic_plans plan
  set
    common_objectives = coalesce(p_common_objectives, '[]'::jsonb),
    specialty_objectives = coalesce(p_specialty_objectives, '{}'::jsonb),
    pts_payload = coalesce(p_pts_payload, '{}'::jsonb),
    pts_schema_version = 1,
    review_due_date = p_review_due_date,
    last_reviewed_at = p_last_reviewed_at,
    status = p_status,
    edit_version = v_plan.edit_version + 1,
    updated_by = p_actor_id,
    updated_at = p_now
  where plan.id = v_plan.id
    and plan.organization_id = v_plan.organization_id
    and plan.patient_id = v_plan.patient_id
    and plan.edit_version = v_plan.edit_version
  returning plan.*;

  if not found then
    raise exception 'THERAPEUTIC_PLAN_VERSION_CONFLICT';
  end if;
end;
$function$;

revoke all on function public.update_patient_therapeutic_plan_v3(
  uuid,
  text,
  uuid,
  integer,
  jsonb,
  jsonb,
  jsonb,
  date,
  timestamptz,
  text,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.update_patient_therapeutic_plan_v3(
  uuid,
  text,
  uuid,
  integer,
  jsonb,
  jsonb,
  jsonb,
  date,
  timestamptz,
  text,
  text,
  timestamptz
) to service_role;

commit;
