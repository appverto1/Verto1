begin;

do $migration_guard$
begin
  if to_regclass('public.patients') is null
     or to_regclass('public.patient_professional_links') is null
     or to_regclass('public.clinic_memberships') is null
     or to_regclass('public.clinical_supervision_links') is null then
    raise exception 'PATIENT_CASE_TEAM_SCHEMA_PENDING'
      using detail = 'Apply patient, clinic membership and supervision migrations first';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clinic_memberships'
      and column_name = 'can_supervise'
  ) then
    raise exception 'PATIENT_CASE_TEAM_SUPERVISION_SCHEMA_PENDING'
      using detail = 'Apply professional supervision capability migration first';
  end if;
end;
$migration_guard$;

-- Re-declare the authority helper so this corrective migration does not rely
-- on a manually applied intermediate function version. Clinic managers are
-- always authoritative for patients inside their own clinic; supervisors stay
-- relationship-scoped.
create or replace function public.patient_case_team_actor_can_manage_v1(
  p_actor_id uuid,
  p_patient_id uuid,
  p_clinic_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
  select
    p_actor_id is not null
    and p_patient_id is not null
    and p_clinic_id is not null
    and exists (
      select 1
      from public.patients patient
      where patient.id = p_patient_id
        and patient.clinic_id = p_clinic_id
        and patient.is_active is distinct from false
        and patient.deleted_at is null
    )
    and (
      exists (
        select 1
        from public.clinic_memberships membership
        where membership.user_id = p_actor_id
          and membership.clinic_id = p_clinic_id
          and membership.status = 'active'
          and membership.role in ('director', 'coordinator')
      )
      or exists (
        select 1
        from public.clinic_memberships membership
        join public.patient_professional_links link
          on link.professional_id = membership.user_id::text
         and link.patient_id = p_patient_id
         and link.organization_id = p_clinic_id::text
         and link.clinic_id = p_clinic_id::text
         and link.status = 'active'
        where membership.user_id = p_actor_id
          and membership.clinic_id = p_clinic_id
          and membership.status = 'active'
          and (membership.role = 'supervisor' or membership.can_supervise is true)
      )
      or exists (
        select 1
        from public.clinic_memberships membership
        join public.clinical_supervision_links supervision
          on supervision.clinic_id = membership.clinic_id
         and supervision.supervisor_user_id = membership.user_id
         and supervision.status = 'active'
        where membership.user_id = p_actor_id
          and membership.clinic_id = p_clinic_id
          and membership.status = 'active'
          and (membership.role = 'supervisor' or membership.can_supervise is true)
          and (
            supervision.patient_id = p_patient_id
            or (
              supervision.patient_id is null
              and supervision.supervised_user_id is not null
              and exists (
                select 1
                from public.patient_professional_links supervised_link
                where supervised_link.patient_id = p_patient_id
                  and supervised_link.organization_id = p_clinic_id::text
                  and supervised_link.clinic_id = p_clinic_id::text
                  and supervised_link.professional_id = supervision.supervised_user_id::text
                  and supervised_link.status = 'active'
              )
            )
          )
      )
    );
$function$;

revoke all on function public.patient_case_team_actor_can_manage_v1(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.patient_case_team_actor_can_manage_v1(uuid, uuid, uuid)
  to authenticated, service_role;

-- Case-team removal must never be blocked by optional historical snapshot
-- maintenance. The canonical history is the ended relationship row itself.
-- Active clinic Directors/Coordinators are protected from case-level removal;
-- once their clinic membership is changed to another role, a clinic manager
-- may end their patient relationship normally.
create or replace function public.end_patient_professional_link_v1(
  p_actor_id uuid,
  p_link_id uuid,
  p_patient_id uuid,
  p_ends_at date default current_date
)
returns public.patient_professional_links
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  patient_clinic_id uuid;
  target_link public.patient_professional_links%rowtype;
  ended_row public.patient_professional_links%rowtype;
  target_professional_uuid uuid;
  target_membership_role text;
begin
  if p_actor_id is null or p_link_id is null or p_patient_id is null then
    raise exception using errcode = '22023', message = 'PATIENT_PROFESSIONAL_LINK_INVALID';
  end if;

  if auth.uid() is not null and auth.uid() is distinct from p_actor_id then
    raise exception using errcode = '42501', message = 'PATIENT_PROFESSIONAL_LINK_ACCESS_DENIED';
  end if;

  select patient.clinic_id
    into patient_clinic_id
  from public.patients patient
  where patient.id = p_patient_id
    and patient.is_active is distinct from false
    and patient.deleted_at is null
  for update;

  if not found or patient_clinic_id is null then
    raise exception using errcode = 'P0001', message = 'PATIENT_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(patient_clinic_id::text || ':' || p_patient_id::text, 0)
  );

  if not public.patient_case_team_actor_can_manage_v1(
    p_actor_id,
    p_patient_id,
    patient_clinic_id
  ) then
    raise exception using errcode = '42501', message = 'PATIENT_PROFESSIONAL_LINK_ACCESS_DENIED';
  end if;

  select link.*
    into target_link
  from public.patient_professional_links link
  where link.id = p_link_id
    and link.patient_id = p_patient_id
    and link.organization_id = patient_clinic_id::text
    and link.clinic_id = patient_clinic_id::text
    and link.status = 'active'
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PATIENT_PROFESSIONAL_LINK_NOT_FOUND';
  end if;

  -- Protect only the target's CURRENT active clinic-level authority. Stale
  -- case_role labels never block cleanup after a coordinator/supervisor role
  -- has already been removed at clinic level.
  if coalesce(target_link.professional_id, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    target_professional_uuid := target_link.professional_id::uuid;

    select lower(membership.role)
      into target_membership_role
    from public.clinic_memberships membership
    where membership.user_id = target_professional_uuid
      and membership.clinic_id = patient_clinic_id
      and membership.status = 'active'
    limit 1;

    if target_membership_role in ('director', 'coordinator') then
      raise exception using
        errcode = '42501',
        message = 'PATIENT_PROFESSIONAL_LINK_PROTECTED_CLINIC_MANAGER';
    end if;
  end if;

  update public.patient_professional_links link
     set status = 'ended',
         ends_at = greatest(coalesce(p_ends_at, current_date), link.starts_at),
         ended_by = p_actor_id::text,
         updated_at = clock_timestamp()
   where link.id = target_link.id
  returning * into ended_row;

  -- The primary pointer is only a denormalized compatibility pointer. Ending
  -- the relationship clears it without deleting clinical history.
  if ended_row.relationship_type = 'primary' then
    update public.patients patient
       set therapist_id = null
     where patient.id = p_patient_id
       and patient.clinic_id = patient_clinic_id
       and patient.therapist_id::text = ended_row.professional_id;
  end if;

  -- Close any direct case supervision record that still references this
  -- professional. This is idempotent and does not delete historical rows.
  if to_regclass('public.clinical_supervision_links') is not null
     and target_professional_uuid is not null then
    update public.clinical_supervision_links supervision
       set status = 'ended',
           ended_at = coalesce(supervision.ended_at, clock_timestamp()),
           updated_at = clock_timestamp()
     where supervision.clinic_id = patient_clinic_id
       and supervision.patient_id = p_patient_id
       and supervision.supervisor_user_id = target_professional_uuid
       and supervision.status = 'active';
  end if;

  -- Compatibility snapshot is non-canonical and MUST NOT rollback removal.
  -- The ended patient_professional_links row remains the authoritative access
  -- history even when an older installation has a drifted version table.
  if to_regclass('public.patient_therapeutic_plan_versions') is not null
     and coalesce(ended_row.permissions->>'historicalRead', 'false') = 'true' then
    begin
      insert into public.patient_therapeutic_plan_versions (
        plan_id,
        organization_id,
        patient_id,
        version,
        snapshot,
        authored_by,
        authorized_reader_ids
      )
      select
        plan.id,
        plan.organization_id,
        plan.patient_id,
        plan.edit_version,
        to_jsonb(plan) || jsonb_build_object(
          'historicalAccessEndedAt', clock_timestamp(),
          'historicalProfessionalId', ended_row.professional_id
        ),
        p_actor_id::text,
        array(
          select distinct reader_id
          from unnest(
            array[plan.responsible_professional_id, ended_row.professional_id]
            || coalesce(plan.participant_professional_ids, '{}'::text[])
          ) as readers(reader_id)
          where nullif(readers.reader_id, '') is not null
        )
      from public.patient_therapeutic_plans plan
      where plan.organization_id = patient_clinic_id::text
        and plan.patient_id = p_patient_id
        and (
          plan.responsible_professional_id = ended_row.professional_id
          or ended_row.professional_id = any(coalesce(plan.participant_professional_ids, '{}'::text[]))
        )
      on conflict (plan_id, version) do nothing;
    exception
      when others then
        raise warning 'PATIENT_CASE_TEAM_HISTORICAL_SNAPSHOT_SKIPPED: %', sqlerrm;
    end;
  end if;

  return ended_row;
end;
$function$;

revoke all on function public.end_patient_professional_link_v1(uuid, uuid, uuid, date)
  from public, anon, authenticated;
grant execute on function public.end_patient_professional_link_v1(uuid, uuid, uuid, date)
  to service_role;

notify pgrst, 'reload schema';

commit;
