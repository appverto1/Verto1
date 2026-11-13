-- ABA V3 / PTS collection context: preserve the existing immutable first binding.
-- A retry after the session INSERT trigger had already bound the context used
-- ON CONFLICT DO UPDATE; the BEFORE UPDATE immutability trigger then raised
-- PTS_COLLECTION_CONTEXT_IMMUTABLE, yielding an HTTP 500 from collection-plan.
-- Do not rewrite frozen PTS versions or specialty snapshots on any retry.
-- No schema, grants, RLS, row migration, triggers or API changes.

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
    on conflict (organization_id, source_session_id, plan_id) do nothing;
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
