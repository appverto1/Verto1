-- Multiple independent specialty plans per patient, with only one clinically active.
-- No clinical rows are rewritten during migration. Existing session IDs remain immutable.
-- Clinicians may prepare many draft plans before atomically replacing the active plan.
--
-- The canonical specialty key is IMMUTABLE and maps historical display aliases.
create unique index idx_therapeutic_plan_active_specialty_canonical_v2
  on public.patient_therapeutic_plans (
    organization_id, patient_id,
    coalesce(public.clinical_specialty_scope_key_v1(specialty), lower(btrim(specialty)))
  )
  where mode = 'specialty' and status = 'active';

drop index if exists public.idx_therapeutic_plan_active_specialty;
alter index public.idx_therapeutic_plan_active_specialty_canonical_v2
  rename to idx_therapeutic_plan_active_specialty;

-- Race-safe, versioned transition. Both plans are changed in ONE database transaction.
-- No endpoint grants this function directly: only the server's service_role can call it.
create or replace function public.activate_patient_specialty_plan_v1(
  p_plan_id uuid,
  p_organization_id text,
  p_patient_id uuid,
  p_expected_version integer,
  p_common_objectives jsonb,
  p_specialty_objectives jsonb,
  p_pts_payload jsonb,
  p_review_due_date date,
  p_last_reviewed_at timestamptz,
  p_actor_id text,
  p_actor_can_manage_all boolean default false,
  p_now timestamptz default now()
)
returns public.patient_therapeutic_plans
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_target public.patient_therapeutic_plans%rowtype;
  v_old public.patient_therapeutic_plans%rowtype;
  v_closed public.patient_therapeutic_plans%rowtype;
  v_updated public.patient_therapeutic_plans%rowtype;
  v_key text;
begin
  -- All replacements for the same patient/specialty serialize across API replicas.
  select * into v_target
    from public.patient_therapeutic_plans
   where id = p_plan_id and organization_id = p_organization_id
     and patient_id = p_patient_id and mode = 'specialty'
   limit 1;
  if not found then raise exception 'SPECIALTY_PLAN_NOT_FOUND'; end if;
  v_key := coalesce(public.clinical_specialty_scope_key_v1(v_target.specialty),
                    lower(btrim(v_target.specialty)));
  if nullif(v_key,'') is null then raise exception 'SPECIALTY_PLAN_SPECIALTY_INVALID'; end if;

  perform pg_advisory_xact_lock(hashtext(p_organization_id),
    hashtext(p_patient_id::text || ':' || v_key));

  -- Reread after taking the serialization lock.
  select * into v_target from public.patient_therapeutic_plans
   where id = p_plan_id and organization_id = p_organization_id
     and patient_id = p_patient_id and mode = 'specialty'
   for update;
  if not found or v_target.status not in ('draft','paused','active') then
    raise exception 'SPECIALTY_PLAN_NOT_ACTIVATABLE';
  end if;
  if v_target.edit_version <> p_expected_version then
    raise exception 'THERAPEUTIC_PLAN_VERSION_CONFLICT';
  end if;
  if not coalesce(p_actor_can_manage_all,false)
     and v_target.responsible_professional_id is distinct from p_actor_id then
    raise exception 'SPECIALTY_PLAN_SCOPE_DENIED';
  end if;
  if v_target.status = 'active' then return v_target; end if;

  select * into v_old from public.patient_therapeutic_plans old_plan
   where old_plan.organization_id = p_organization_id
     and old_plan.patient_id = p_patient_id
     and old_plan.mode = 'specialty'
     and old_plan.status = 'active'
     and old_plan.id <> v_target.id
     and coalesce(public.clinical_specialty_scope_key_v1(old_plan.specialty),
                  lower(btrim(old_plan.specialty))) = v_key
   for update;
  if found then
    if v_old.clinic_id <> v_target.clinic_id
       or (not coalesce(p_actor_can_manage_all,false)
           and v_old.responsible_professional_id is distinct from p_actor_id) then
      raise exception 'SPECIALTY_PLAN_SCOPE_DENIED';
    end if;
    -- Existing versioned RPC writes historical snapshot and increments version.
    select * into v_closed
      from public.update_patient_therapeutic_plan_v3(
        v_old.id, v_old.organization_id, v_old.patient_id, v_old.edit_version,
        v_old.common_objectives, v_old.specialty_objectives, v_old.pts_payload,
        v_old.review_due_date, v_old.last_reviewed_at,
        'completed', p_actor_id, p_now);
    if v_closed.id is null then raise exception 'SPECIALTY_PLAN_TRANSITION_FAILED'; end if;
  end if;

  select * into v_updated
    from public.update_patient_therapeutic_plan_v3(
      v_target.id, v_target.organization_id, v_target.patient_id, v_target.edit_version,
      p_common_objectives, p_specialty_objectives, p_pts_payload,
      p_review_due_date, p_last_reviewed_at, 'active', p_actor_id, p_now);
  if v_updated.id is null then raise exception 'SPECIALTY_PLAN_TRANSITION_FAILED'; end if;
  return v_updated;
end;
$$;
revoke all on function public.activate_patient_specialty_plan_v1(
  uuid,text,uuid,integer,jsonb,jsonb,jsonb,date,timestamptz,text,boolean,timestamptz
) from public, anon, authenticated;
grant execute on function public.activate_patient_specialty_plan_v1(
  uuid,text,uuid,integer,jsonb,jsonb,jsonb,date,timestamptz,text,boolean,timestamptz
) to service_role;

-- New sessions must never bind to a future draft, paused or completed plan.
-- Updates to EXISTING sessions retain their historical plan ID unmodified.
create or replace function public.guard_aba_session_therapeutic_plan_binding_v1()
returns trigger language plpgsql security definer
set search_path to 'pg_catalog','public' set row_security to 'off'
as $$
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
    return new;
  end if;
  if new.therapeutic_plan_id is null then return new; end if;
  v_organization_id := coalesce(nullif(btrim(new.organization_id),''),
                                nullif(btrim(new.clinic_id),''));
  select plan.* into v_plan
    from public.patient_therapeutic_plans plan
   where plan.id = new.therapeutic_plan_id
     and plan.patient_id = new.patient_id
     and plan.organization_id = v_organization_id
     and plan.clinic_id = new.clinic_id
     and plan.mode = 'specialty'
     and plan.status = 'active'
   limit 1;
  if not found then raise exception 'ABA_SESSION_SPECIALTY_PLAN_NOT_ACTIVE'; end if;
  if auth.uid() is not null
    and not public.therapeutic_plan_current_actor_can_access_v2(
      v_plan.patient_id, v_plan.organization_id, v_plan.clinic_id,
      v_plan.mode, v_plan.responsible_professional_id,
      v_plan.participant_professional_ids, 'write'
    ) then
    raise exception 'ABA_SESSION_SPECIALTY_PLAN_ACCESS_DENIED';
  end if;
  return new;
end;
$$;
