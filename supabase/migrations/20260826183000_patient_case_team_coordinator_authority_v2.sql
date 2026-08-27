-- Coordinator case-team management authority v2.
--
-- Repairs two production-facing invariants:
-- 1) active clinic coordinators/directors can atomically change the patient's
--    primary professional and end any active case-team link in their clinic;
-- 2) removing/changing a professional never deletes historical relationship
--    rows and never rewrites published clinical documents.
--
-- Supervisors remain relationship-scoped. Specialty alone never grants access.
-- Additive/idempotent: CREATE OR REPLACE only; no clinical rows are rewritten.

begin;

do $migration_guard$
begin
  if to_regclass('public.patients') is null
     or to_regclass('public.patient_professional_links') is null
     or to_regclass('public.clinic_memberships') is null
     or to_regclass('public.clinical_supervision_links') is null
     or to_regclass('public.users') is null
     or to_regclass('public.professional_profiles') is null
     or to_regclass('public.patient_therapeutic_plans') is null then
    raise exception 'PATIENT_CASE_TEAM_SCHEMA_PENDING'
      using detail = 'Apply patient, membership and multidisciplinary case-team migrations first';
  end if;
end;
$migration_guard$;

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
      -- Unit-level authority: coordinator/director of THIS clinic only.
      exists (
        select 1
        from public.clinic_memberships membership
        where membership.user_id = p_actor_id
          and membership.clinic_id = p_clinic_id
          and membership.status = 'active'
          and membership.role in ('director', 'coordinator')
      )
      or
      -- Supervisor already linked directly to this case.
      exists (
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
          and (
            membership.role = 'supervisor'
            or membership.can_supervise is true
          )
      )
      or
      -- Explicit active supervision relation scoped to this patient/case.
      (
        to_regclass('public.clinical_supervision_links') is not null
        and exists (
          select 1
          from public.clinic_memberships membership
          join public.clinical_supervision_links supervision
            on supervision.clinic_id = membership.clinic_id
           and supervision.supervisor_user_id = membership.user_id
           and supervision.status = 'active'
          where membership.user_id = p_actor_id
            and membership.clinic_id = p_clinic_id
            and membership.status = 'active'
            and (
              membership.role = 'supervisor'
              or membership.can_supervise is true
            )
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
      )
    );
$function$;

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
  ended_row public.patient_professional_links%rowtype;
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

  update public.patient_professional_links link
     set status = 'ended',
         ends_at = greatest(coalesce(p_ends_at, current_date), link.starts_at),
         ended_by = p_actor_id::text,
         updated_at = clock_timestamp()
   where link.id = p_link_id
     and link.patient_id = p_patient_id
     and link.organization_id = patient_clinic_id::text
     and link.clinic_id = patient_clinic_id::text
     and link.status = 'active'
  returning * into ended_row;

  if not found then
    raise exception using errcode = 'P0001', message = 'PATIENT_PROFESSIONAL_LINK_NOT_FOUND';
  end if;

  -- Primary pointer is denormalized for legacy/list compatibility. Ending the
  -- primary relationship clears only that pointer; the ended link remains as
  -- immutable relationship history.
  if ended_row.relationship_type = 'primary' then
    update public.patients patient
       set therapist_id = null
     where patient.id = p_patient_id
       and patient.clinic_id = patient_clinic_id
       and patient.therapist_id::text = ended_row.professional_id;
  end if;

  -- Preserve the legacy historical-reader snapshot when that table is present.
  -- This is deliberately best-effort only for schema-compatibility errors: the
  -- canonical relationship history is the ended link itself and must not be
  -- blocked by an optional legacy snapshot table.
  if to_regclass('public.patient_therapeutic_plan_versions') is not null
     and ended_row.permissions->'historicalRead' = 'true'::jsonb then
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
      when undefined_table or undefined_column then
        null;
    end;
  end if;

  return ended_row;
end;
$function$;

create or replace function public.set_patient_primary_professional_v1(
  p_actor_id uuid,
  p_patient_id uuid,
  p_professional_id uuid default null,
  p_starts_at date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  patient_clinic_id uuid;
  current_primary public.patient_professional_links%rowtype;
  target_link public.patient_professional_links%rowtype;
  persisted_link public.patient_professional_links%rowtype;
  has_current_primary boolean := false;
  has_target_link boolean := false;
  resolved_specialty text;
  active_link_count integer := 0;
begin
  if p_actor_id is null or p_patient_id is null then
    raise exception using errcode = '22023', message = 'PATIENT_PRIMARY_PROFESSIONAL_INVALID';
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
    into current_primary
  from public.patient_professional_links link
  where link.patient_id = p_patient_id
    and link.organization_id = patient_clinic_id::text
    and link.clinic_id = patient_clinic_id::text
    and link.status = 'active'
    and link.relationship_type = 'primary'
  order by link.created_at, link.id
  limit 1
  for update;
  has_current_primary := found;

  -- Clearing primary responsibility does not remove the professional from the
  -- team. It demotes the relationship and preserves the complete case history.
  if p_professional_id is null then
    if has_current_primary then
      update public.patient_professional_links link
         set relationship_type = 'collaborator',
             case_role = case
               when link.case_role = 'primary_therapist' then 'therapist'
               else link.case_role
             end,
             updated_at = clock_timestamp()
       where link.id = current_primary.id;
    end if;

    update public.patients patient
       set therapist_id = null
     where patient.id = p_patient_id
       and patient.clinic_id = patient_clinic_id;

    return jsonb_build_object(
      'success', true,
      'patientId', p_patient_id,
      'professionalId', null,
      'linkId', case when has_current_primary then current_primary.id else null end,
      'idempotent', not has_current_primary
    );
  end if;

  perform 1
  from public.users professional
  where professional.id = p_professional_id
  for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'PATIENT_PROFESSIONAL_NOT_FOUND';
  end if;

  perform 1
  from public.clinic_memberships membership
  where membership.user_id = p_professional_id
    and membership.clinic_id = patient_clinic_id
    and membership.status = 'active'
    and membership.role in ('therapist', 'supervisor', 'coordinator', 'director')
  for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'PATIENT_PROFESSIONAL_MEMBERSHIP_INACTIVE';
  end if;

  select nullif(trim(profile.specialty), '')
    into resolved_specialty
  from public.professional_profiles profile
  where profile.user_id = p_professional_id
  for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'PATIENT_PROFESSIONAL_PROFILE_REQUIRED';
  end if;
  if resolved_specialty is null or char_length(resolved_specialty) < 2 then
    raise exception using errcode = 'P0001', message = 'PATIENT_PROFESSIONAL_SPECIALTY_REQUIRED';
  end if;

  select link.*
    into target_link
  from public.patient_professional_links link
  where link.patient_id = p_patient_id
    and link.organization_id = patient_clinic_id::text
    and link.clinic_id = patient_clinic_id::text
    and link.professional_id = p_professional_id::text
    and link.status = 'active'
  order by link.created_at, link.id
  limit 1
  for update;
  has_target_link := found;

  if has_current_primary and current_primary.professional_id = p_professional_id::text then
    update public.patients patient
       set therapist_id = p_professional_id
     where patient.id = p_patient_id
       and patient.clinic_id = patient_clinic_id
       and patient.therapist_id is distinct from p_professional_id;

    return jsonb_build_object(
      'success', true,
      'patientId', p_patient_id,
      'professionalId', p_professional_id,
      'linkId', current_primary.id,
      'idempotent', true
    );
  end if;

  -- If the new primary is not yet part of the case, ensure the relationship
  -- limit before mutating the existing primary. Failure leaves all state intact.
  if not has_target_link then
    select count(*)
      into active_link_count
    from public.patient_professional_links link
    where link.patient_id = p_patient_id
      and link.organization_id = patient_clinic_id::text
      and link.clinic_id = patient_clinic_id::text
      and link.status = 'active';
    if active_link_count >= 5 then
      raise exception using errcode = 'P0001', message = 'PATIENT_PROFESSIONAL_LINK_LIMIT_REACHED';
    end if;
  end if;

  if has_current_primary then
    update public.patient_professional_links link
       set relationship_type = 'collaborator',
           case_role = case
             when link.case_role = 'primary_therapist' then 'therapist'
             else link.case_role
           end,
           updated_at = clock_timestamp()
     where link.id = current_primary.id;
  end if;

  if has_target_link then
    update public.patient_professional_links link
       set relationship_type = 'primary',
           case_role = case
             when link.case_role in ('supervisor', 'case_coordinator', 'consultant') then link.case_role
             else 'primary_therapist'
           end,
           specialty = left(resolved_specialty, 120),
           updated_at = clock_timestamp()
     where link.id = target_link.id
    returning * into persisted_link;
  else
    insert into public.patient_professional_links (
      organization_id,
      clinic_id,
      patient_id,
      professional_id,
      specialty,
      case_role,
      relationship_type,
      starts_at,
      permissions,
      created_by
    ) values (
      patient_clinic_id::text,
      patient_clinic_id::text,
      p_patient_id,
      p_professional_id::text,
      left(resolved_specialty, 120),
      'primary_therapist',
      'primary',
      coalesce(p_starts_at, current_date),
      jsonb_build_object('read', true, 'write', true, 'historicalRead', true),
      p_actor_id::text
    )
    returning * into persisted_link;
  end if;

  update public.patients patient
     set therapist_id = p_professional_id
   where patient.id = p_patient_id
     and patient.clinic_id = patient_clinic_id;

  return jsonb_build_object(
    'success', true,
    'patientId', p_patient_id,
    'professionalId', p_professional_id,
    'linkId', persisted_link.id,
    'idempotent', false
  );
end;
$function$;

revoke all on function public.patient_case_team_actor_can_manage_v1(uuid, uuid, uuid)
  from public, anon, authenticated;

revoke all on function public.end_patient_professional_link_v1(uuid, uuid, uuid, date)
  from public, anon, authenticated;
grant execute on function public.end_patient_professional_link_v1(uuid, uuid, uuid, date)
  to service_role;

revoke all on function public.set_patient_primary_professional_v1(uuid, uuid, uuid, date)
  from public, anon, authenticated;
grant execute on function public.set_patient_primary_professional_v1(uuid, uuid, uuid, date)
  to service_role;

notify pgrst, 'reload schema';

commit;
