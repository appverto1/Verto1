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
