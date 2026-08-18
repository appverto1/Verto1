-- Case-team management authority for production smoke testing.
-- Director and clinic coordinator keep unit-level authority. Supervisors gain
-- authority only on cases they actively supervise.
-- All mutations remain atomic, preserve history, and fail closed outside scope.

begin;

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
    and (
      -- Unit managers manage every case in their active clinic.
      exists (
        select 1
        from public.clinic_memberships membership
        where membership.user_id = p_actor_id
          and membership.clinic_id = p_clinic_id
          and membership.status = 'active'
          and membership.role in ('director', 'coordinator')
      )
      or
      -- A supervision-enabled professional manages only a patient where the
      -- explicit case role is Supervisão.
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
          and membership.role in ('therapist', 'supervisor')
          and link.case_role = 'supervisor'
          and (
            membership.role = 'supervisor'
            or membership.can_supervise is true
          )
      )
      or
      -- Explicit supervision also authorizes team management for that supervised case.
      exists (
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
  link_integrity_valid boolean := false;
begin
  if auth.uid() is not null
     and auth.uid() is distinct from p_actor_id then
    raise exception 'PATIENT_PROFESSIONAL_LINK_ACCESS_DENIED';
  end if;

  select patient.clinic_id
  into patient_clinic_id
  from public.patients patient
  where patient.id = p_patient_id;

  if not found or patient_clinic_id is null then
    raise exception 'PATIENT_NOT_FOUND';
  end if;


  perform 1
  from public.patients patient
  where patient.id = p_patient_id
    and patient.clinic_id = patient_clinic_id
  for update;
  if not found then
    raise exception 'PATIENT_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      patient_clinic_id::text || ':' || p_patient_id::text,
      0
    )
  );

  if not public.patient_case_team_actor_can_manage_v1(
    p_actor_id,
    p_patient_id,
    patient_clinic_id
  ) then
    raise exception using errcode = '42501', message = 'PATIENT_PROFESSIONAL_LINK_ACCESS_DENIED';
  end if;

  update public.patient_professional_links link
  set
    status = 'ended',
    ends_at = greatest(
      coalesce(p_ends_at, current_date),
      link.starts_at
    ),
    ended_by = p_actor_id::text,
    updated_at = now()
  where link.id = p_link_id
    and link.patient_id = p_patient_id
    and link.status = 'active'
  returning *
  into ended_row;

  if not found then
    raise exception 'PATIENT_PROFESSIONAL_LINK_NOT_FOUND';
  end if;

  link_integrity_valid :=
    ended_row.organization_id = patient_clinic_id::text
    and ended_row.clinic_id = patient_clinic_id::text;
  if link_integrity_valid then
    perform 1
    from public.users professional
    join public.clinic_memberships professional_membership
      on professional_membership.user_id = professional.id
     and professional_membership.clinic_id = patient_clinic_id
     and professional_membership.role in ('therapist', 'supervisor', 'coordinator', 'director')
     and professional_membership.status = 'active'
    join public.professional_profiles profile
      on profile.user_id = professional.id
     and char_length(nullif(trim(profile.specialty), '')) >= 2
    where professional.id::text = ended_row.professional_id
    for share;
    link_integrity_valid := found;
  end if;

  if ended_row.relationship_type = 'primary' then
    update public.patients
    set therapist_id = null
    where id = ended_row.patient_id
      and clinic_id = patient_clinic_id
      and therapist_id::text = ended_row.professional_id;
  end if;

  if link_integrity_valid
     and ended_row.permissions->'historicalRead' = 'true'::jsonb then
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
        'historicalAccessEndedAt',
        now(),
        'historicalProfessionalId',
        ended_row.professional_id
      ),
      p_actor_id::text,
      array(
        select distinct readers.reader_id
        from unnest(
          array[
            plan.responsible_professional_id,
            ended_row.professional_id
          ]
          || coalesce(
            plan.participant_professional_ids,
            '{}'::text[]
          )
        ) as readers(reader_id)
        where nullif(readers.reader_id, '') is not null
      )
    from public.patient_therapeutic_plans plan
    where plan.organization_id = patient_clinic_id::text
      and plan.patient_id = ended_row.patient_id
      and (
        plan.responsible_professional_id =
          ended_row.professional_id
        or ended_row.professional_id =
          any(plan.participant_professional_ids)
      )
    on conflict (plan_id, version) do nothing;
  end if;

  return ended_row;
end;
$function$;

create or replace function public.upsert_patient_professional_link_v1(
  p_actor_id uuid,
  p_patient_id uuid,
  p_professional_id uuid,
  p_specialty text,
  p_case_role text,
  p_relationship_type text,
  p_starts_at date,
  p_permissions jsonb,
  p_replace_primary boolean default false
)
returns public.patient_professional_links
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  patient_clinic_id uuid;
  resolved_specialty text;
  resolved_permissions jsonb;
  active_link_count integer;
  created_row public.patient_professional_links%rowtype;
  primary_link record;
begin
  if auth.uid() is not null
     and auth.uid() is distinct from p_actor_id then
    raise exception 'PATIENT_PROFESSIONAL_LINK_ACCESS_DENIED';
  end if;

  -- p_specialty remains in the signature for compatibility, but the profile
  -- is the only authority for the specialty snapshot.
  if nullif(trim(p_case_role), '') is null
     or trim(p_case_role) not in (
       'case_coordinator',
       'primary_therapist',
       'therapist',
       'supervisor',
       'consultant'
     )
     or p_relationship_type is null
     or p_relationship_type not in ('primary', 'collaborator')
     or jsonb_typeof(
       coalesce(p_permissions, '{}'::jsonb)
     ) <> 'object' then
    raise exception 'PATIENT_PROFESSIONAL_LINK_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(
      coalesce(p_permissions, '{}'::jsonb)
    ) as permission_key(key)
    where permission_key.key not in (
      'read',
      'write',
      'historicalRead'
    )
  )
  or (
    coalesce(p_permissions, '{}'::jsonb) ? 'read'
    and jsonb_typeof(p_permissions->'read') <> 'boolean'
  )
  or (
    coalesce(p_permissions, '{}'::jsonb) ? 'write'
    and jsonb_typeof(p_permissions->'write') <> 'boolean'
  )
  or (
    coalesce(p_permissions, '{}'::jsonb) ? 'historicalRead'
    and jsonb_typeof(
      p_permissions->'historicalRead'
    ) <> 'boolean'
  ) then
    raise exception 'PATIENT_PROFESSIONAL_LINK_INVALID';
  end if;

  resolved_permissions := jsonb_build_object(
    'read', coalesce((p_permissions->>'read')::boolean, true),
    'write', coalesce((p_permissions->>'write')::boolean, true),
    'historicalRead', coalesce(
      (p_permissions->>'historicalRead')::boolean,
      true
    )
  );

  select patient.clinic_id
  into patient_clinic_id
  from public.patients patient
  where patient.id = p_patient_id;

  if not found or patient_clinic_id is null then
    raise exception 'PATIENT_NOT_FOUND';
  end if;


  perform 1
  from public.patients patient
  where patient.id = p_patient_id
    and patient.clinic_id = patient_clinic_id
  for update;
  if not found then
    raise exception 'PATIENT_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      patient_clinic_id::text || ':' || p_patient_id::text,
      0
    )
  );

  if not public.patient_case_team_actor_can_manage_v1(
    p_actor_id,
    p_patient_id,
    patient_clinic_id
  ) then
    raise exception using errcode = '42501', message = 'PATIENT_PROFESSIONAL_LINK_ACCESS_DENIED';
  end if;

  perform 1
  from public.users professional
  where professional.id = p_professional_id
  for share;
  if not found then
    raise exception 'PATIENT_PROFESSIONAL_NOT_FOUND';
  end if;

  perform 1
  from public.clinic_memberships professional_membership
  where professional_membership.user_id = p_professional_id
    and professional_membership.clinic_id = patient_clinic_id
    and professional_membership.role in ('therapist', 'supervisor', 'coordinator', 'director')
    and professional_membership.status = 'active'
  for share;
  if not found then
    raise exception 'PATIENT_PROFESSIONAL_MEMBERSHIP_INACTIVE';
  end if;

  select nullif(trim(profile.specialty), '')
  into resolved_specialty
  from public.professional_profiles profile
  where profile.user_id = p_professional_id
  for share;
  if not found then
    raise exception 'PATIENT_PROFESSIONAL_PROFILE_REQUIRED';
  end if;
  if resolved_specialty is null
     or char_length(resolved_specialty) < 2 then
    raise exception 'PATIENT_PROFESSIONAL_SPECIALTY_REQUIRED';
  end if;

  if exists (
    select 1
    from public.patient_professional_links link
    where link.patient_id = p_patient_id
      and link.professional_id = p_professional_id::text
      and link.status = 'active'
  ) then
    raise exception 'PATIENT_PROFESSIONAL_LINK_DUPLICATE';
  end if;

  if p_relationship_type = 'primary'
     and p_replace_primary is true then
    for primary_link in
      select link.id
      from public.patient_professional_links link
      where link.patient_id = p_patient_id
        and link.relationship_type = 'primary'
        and link.status = 'active'
      order by link.id
      for update
    loop
      perform public.end_patient_professional_link_v1(
        p_actor_id,
        primary_link.id,
        p_patient_id,
        coalesce(p_starts_at, current_date)
      );
    end loop;
  elsif p_relationship_type = 'primary'
     and exists (
       select 1
       from public.patient_professional_links link
       where link.patient_id = p_patient_id
         and link.relationship_type = 'primary'
         and link.status = 'active'
     ) then
    raise exception 'PATIENT_PROFESSIONAL_LINK_PRIMARY_EXISTS';
  end if;

  select count(*)
  into active_link_count
  from public.patient_professional_links link
  where link.patient_id = p_patient_id
    and link.status = 'active';
  if active_link_count >= 5 then
    raise exception 'PATIENT_PROFESSIONAL_LINK_LIMIT_REACHED';
  end if;

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
  )
  values (
    patient_clinic_id::text,
    patient_clinic_id::text,
    p_patient_id,
    p_professional_id::text,
    left(resolved_specialty, 120),
    left(trim(p_case_role), 160),
    p_relationship_type,
    coalesce(p_starts_at, current_date),
    resolved_permissions,
    p_actor_id::text
  )
  returning *
  into created_row;

  if p_relationship_type = 'primary' then
    update public.patients
    set therapist_id = p_professional_id
    where id = p_patient_id
      and clinic_id = patient_clinic_id;
  end if;

  return created_row;
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
    and link.status = 'active'
    and link.relationship_type = 'primary'
  order by link.created_at, link.id
  limit 1
  for update;
  has_current_primary := found;

  -- Clearing the primary assignment must not silently remove the professional
  -- from the case team. Demote the canonical primary link to collaborator and
  -- preserve its access/history; only the primary pointer is cleared.
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
       and patient.clinic_id = patient_clinic_id
       and patient.therapist_id is not null;

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
  from public.clinic_memberships professional_membership
  where professional_membership.user_id = p_professional_id
    and professional_membership.clinic_id = patient_clinic_id
    and professional_membership.role in ('therapist', 'supervisor', 'coordinator', 'director')
    and professional_membership.status = 'active'
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

  -- A professional already on the case can be promoted to primary without
  -- creating a duplicate link or discarding their existing case history.
  if has_current_primary and (not has_target_link or current_primary.id is distinct from target_link.id) then
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
             when link.case_role = 'supervisor' then 'supervisor'
             else 'primary_therapist'
           end,
           specialty = left(resolved_specialty, 120),
           updated_at = clock_timestamp()
     where link.id = target_link.id
     returning * into persisted_link;

    update public.patients patient
       set therapist_id = p_professional_id
     where patient.id = p_patient_id
       and patient.clinic_id = patient_clinic_id;
  else
    select *
      into persisted_link
    from public.upsert_patient_professional_link_v1(
      p_actor_id,
      p_patient_id,
      p_professional_id,
      resolved_specialty,
      'primary_therapist',
      'primary',
      coalesce(p_starts_at, current_date),
      jsonb_build_object('read', true, 'write', true, 'historicalRead', true),
      false
    );
  end if;

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

revoke all on function public.upsert_patient_professional_link_v1(
  uuid, uuid, uuid, text, text, text, date, jsonb, boolean
) from public, anon, authenticated;
grant execute on function public.upsert_patient_professional_link_v1(
  uuid, uuid, uuid, text, text, text, date, jsonb, boolean
) to service_role;

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
