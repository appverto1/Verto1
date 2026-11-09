-- Production promotion: specialty cycles and legacy programs. Original reviewed SQLs are retained under

-- supabase/operations/promotion_staging_sources and must not be applied separately.

begin;

set local lock_timeout = '5s';

set local statement_timeout = '180s';

do $$ begin
  if to_regclass('public.idx_therapeutic_plan_active_specialty_canonical_v2') is not null
    or to_regprocedure('public.activate_patient_specialty_plan_v1(uuid,text,uuid,integer,jsonb,jsonb,jsonb,date,timestamptz,text,boolean,timestamptz)') is not null then
    raise exception 'PROMOTION_SPECIALTY_SCHEMA_ALREADY_PRESENT';
  end if;
end $$;

-- Source: 20261022130000_specialist_authored_programs_no_approval.sql; sha256 82bfb2928e3701a0e13248c117d9c425be3025755865cca218d9a77d5fccd916

-- P1: specialty programs authored by their responsible specialist do not need a
-- second administrative approval to become usable in sessions.
-- Existing backend already creates new eligible programs directly as 'teaching'.
-- Reconcile ONLY legacy 'awaiting_approval' records that still qualify today.
-- No global status rewrite; all conditions are checked against current DB scope.
-- Use the pre-existing versioned RPC to keep clinical versions, activation
-- metadata and audit events consistent. Does not modify PTS or draft plans.
do $$
declare
  candidate record;
  result jsonb;
begin
  for candidate in
    select
      p.id::text as program_id,
      p.organization_id::text as organization_id,
      p.patient_id::uuid as patient_id,
      p.version::integer as program_version,
      t.responsible_professional_id::text as specialist_id
    from public.aba_programs p
    join public.patient_therapeutic_plans t
      on t.id::text = p.therapeutic_plan_id::text
      and t.organization_id::text = p.organization_id::text
      and t.patient_id::text = p.patient_id::text
    where p.status = 'awaiting_approval'
      and t.mode = 'specialty'
      and t.status = 'active'
      -- This is a specialist-authored program, not a manager's review queue.
      and p.created_by::text = t.responsible_professional_id::text
      and exists (
        select 1 from public.clinic_memberships cm
        where cm.clinic_id::text = t.clinic_id::text
          and cm.user_id::text = t.responsible_professional_id::text
          and cm.role = 'therapist'
          and cm.status = 'active'
          -- Match canonical clinical specialties rather than display labels.
          -- Historical records may store Fonoaudiologia vs Fonoaudiólogo.
          -- A null/unrecognized specialty must fail closed, not authorize.
          and public.clinical_specialty_scope_key_v1(cm.specialty) is not null
          and public.clinical_specialty_scope_key_v1(cm.specialty)
              = public.clinical_specialty_scope_key_v1(t.specialty)
      )
      and exists (
        select 1 from public.patient_professional_links link
        where link.organization_id::text = t.organization_id::text
          and link.patient_id::text = t.patient_id::text
          and link.professional_id::text = t.responsible_professional_id::text
          and link.status = 'active'
          and coalesce((link.permissions->>'write')::boolean,true)
      )
    order by p.id
    for update of p
  loop
    result := public.update_therapeutic_program_status(
      candidate.organization_id,
      candidate.patient_id,
      candidate.program_id,
      'teaching',
      candidate.program_version,
      'Ativação de programa da própria especialidade sem aprovação administrativa',
      'specialist-self-authored-activation:' || candidate.program_id || ':' || candidate.program_version::text,
      candidate.specialist_id
    );
    if coalesce(result->'program'->>'status','') <> 'teaching' then
      raise exception 'SPECIALIST_LEGACY_ACTIVATION_NOT_CONFIRMED';
    end if;
  end loop;
end;
$$;

-- Source: 20261023143000_parallel_specialty_plan_drafts_and_atomic_activation.sql; sha256 035140b4f2e882ef1e0e43ceb52a5e583e902ab93a37352af6a6fd191ff91551

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
    -- Never replace an active cycle while someone is collecting a session.
    -- The session trigger holds a FOR SHARE lock on the parent plan during
    -- INSERT; this FOR UPDATE lock serializes the other side of that race.
    if exists (
      select 1 from public.aba_sessions session
       where session.therapeutic_plan_id = v_old.id
         and session.patient_id = p_patient_id
         and session.organization_id = p_organization_id
         and lower(session.status) in ('active','in_progress','started')
    ) then
      raise exception 'SPECIALTY_PLAN_NOT_ACTIVATABLE';
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
   limit 1
   for share;
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

-- Source: 20261023155000_specialty_cycle_prepared_programs_activation.sql; sha256 8b7743508733f6ccdc0f51ae4cc8d1fefb04cdb6a01015d896256888ef9ae9a8

-- P0-03 follow-up: prepared programs become usable when a new specialty
-- cycle is explicitly published. Replaces only the plan-activation RPC.
-- No patient, session, plan, program, or billing rows are rewritten here.
-- The transaction is rolled back if any program/version/audit step fails.
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
  v_program public.aba_programs%rowtype;
  v_program_activation jsonb;
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
    -- Never replace an active cycle while someone is collecting a session.
    -- The session trigger holds a FOR SHARE lock on the parent plan during
    -- INSERT; this FOR UPDATE lock serializes the other side of that race.
    if exists (
      select 1 from public.aba_sessions session
       where session.therapeutic_plan_id = v_old.id
         and session.patient_id = p_patient_id
         and session.organization_id = p_organization_id
         and lower(session.status) in ('active','in_progress','started')
    ) then
      raise exception 'SPECIALTY_PLAN_NOT_ACTIVATABLE';
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

  -- A future plan may have complete, deliberately prepared draft programs.
  -- Publishing the cycle must make those programs eligible for sessions in
  -- the SAME transaction. Keep the existing version/audit RPC rather than
  -- touching aba_programs.status directly (audit, activated_by, history).
  -- The status RPC acquires the per-program advisory lock BEFORE its row lock.
  -- Do not prelock rows here in the opposite order (deadlock with editors).
  for v_program in
    select program.*
      from public.aba_programs program
     where program.organization_id = v_target.organization_id
       and program.clinic_id = v_target.clinic_id
       and program.patient_id = v_target.patient_id
       and program.therapeutic_plan_id = v_target.id
       and program.status in ('draft','awaiting_approval')
     order by program.id
  loop
    v_program_activation := public.update_therapeutic_program_status(
      v_target.organization_id, v_target.patient_id, v_program.id,
      'teaching', v_program.version,
      'Ativação do programa junto ao novo ciclo clínico do plano por especialidade',
      'specialty-cycle-teaching:' || v_target.id::text || ':' ||
        v_program.id || ':' || v_program.version::text,
      p_actor_id
    );
    if coalesce(v_program_activation->'program'->>'status','') <> 'teaching' then
      raise exception 'SPECIALTY_PLAN_PROGRAM_ACTIVATION_FAILED';
    end if;
  end loop;
  return v_updated;
end;
$$;

-- Keep the privileged RPC callable only from the server; never public.
revoke all on function public.activate_patient_specialty_plan_v1(
  uuid,text,uuid,integer,jsonb,jsonb,jsonb,date,timestamptz,text,boolean,timestamptz
) from public, anon, authenticated;
grant execute on function public.activate_patient_specialty_plan_v1(
  uuid,text,uuid,integer,jsonb,jsonb,jsonb,date,timestamptz,text,boolean,timestamptz
) to service_role;

notify pgrst, 'reload schema';

commit;
