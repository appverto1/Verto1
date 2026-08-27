begin;

-- Draft persistence and activation must have different blocking semantics:
-- incomplete clinical content may block ACTIVE publication, but must never make
-- the user's draft disappear. This patch keeps save + valid activation atomic,
-- while committing the draft when activation-only validation fails.

do $migration_guard$
begin
  if to_regclass('public.patient_therapeutic_plans') is null
     or to_regclass('public.patient_pts_documents_v2') is null
     or to_regclass('public.patient_pts_versions_v2') is null
     or to_regclass('public.patient_pts_events_v2') is null then
    raise exception 'PTS_DRAFT_PERSISTENCE_SCHEMA_PENDING'
      using detail = 'Apply 20260826143000_pts_document_lineage_events_v2.sql first';
  end if;

  if not exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'save_patient_pts_draft_v2'
  ) then
    raise exception 'PTS_DRAFT_SAVE_FUNCTION_PENDING'
      using detail = 'save_patient_pts_draft_v2 must exist before applying this patch';
  end if;
end;
$migration_guard$;

-- Use an escape-free date expression. The previous double-backslash pattern in
-- a dollar-quoted SQL string could reject valid YYYY-MM-DD values.
create or replace function public.patient_pts_snapshot_ready_for_activation_v3(p_snapshot jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $function$
  select
    jsonb_typeof(coalesce(p_snapshot, '{}'::jsonb)) = 'object'
    and jsonb_typeof(coalesce(p_snapshot->'pts_payload', '{}'::jsonb)) = 'object'
    and nullif(btrim(coalesce(p_snapshot#>>'{pts_payload,caseManagerId}', '')), '') is not null
    and coalesce(p_snapshot#>>'{pts_payload,startedAt}', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
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

revoke all on function public.patient_pts_snapshot_ready_for_activation_v3(jsonb) from public, anon, authenticated;
grant execute on function public.patient_pts_snapshot_ready_for_activation_v3(jsonb) to service_role;

create or replace function public.activate_patient_pts_draft_v3(
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

  -- The draft save happens first in the same transaction. If activation is
  -- valid, the transaction continues atomically. If activation-only validation
  -- fails, we RETURN instead of RAISE so the saved draft commits.
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
  if not public.patient_pts_snapshot_ready_for_activation_v3(v_snapshot) then
    return jsonb_build_object(
      'validationFailed', true,
      'draftPreserved', true,
      'version', to_jsonb(v_draft),
      'documentId', v_draft.document_id
    );
  end if;

  select * into v_plan
  from public.patient_therapeutic_plans
  where id = p_plan_id
    and organization_id = p_organization_id
    and patient_id = p_patient_id
  for update;
  if not found then raise exception 'PTS_DOCUMENT_NOT_FOUND'; end if;

  select * into v_document
  from public.patient_pts_documents_v2
  where plan_id = v_plan.id
  for update;
  if not found then raise exception 'PTS_DOCUMENT_LINEAGE_MISSING'; end if;

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
    'validationFailed', false,
    'draftPreserved', true,
    'plan', to_jsonb(v_updated_plan),
    'version', to_jsonb(v_draft),
    'documentId', v_document.id
  );
end;
$function$;

revoke all on function public.activate_patient_pts_draft_v3(
  uuid,text,uuid,uuid,integer,jsonb,jsonb,jsonb,date,text,timestamptz
) from public, anon, authenticated;
grant execute on function public.activate_patient_pts_draft_v3(
  uuid,text,uuid,uuid,integer,jsonb,jsonb,jsonb,date,text,timestamptz
) to service_role;

notify pgrst, 'reload schema';

commit;
