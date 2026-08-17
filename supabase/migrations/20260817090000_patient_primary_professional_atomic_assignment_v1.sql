-- Persist the patient's primary professional through the canonical case-team relation.
-- Keeps patients.therapist_id synchronized for compatibility/read performance.

begin;

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

  perform 1
  from public.clinic_memberships actor_membership
  where actor_membership.user_id = p_actor_id
    and actor_membership.clinic_id = patient_clinic_id
    and actor_membership.role in ('director', 'coordinator')
    and actor_membership.status = 'active'
  for share;

  if not found then
    raise exception using errcode = '42501', message = 'PATIENT_PROFESSIONAL_LINK_ACCESS_DENIED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(patient_clinic_id::text || ':' || p_patient_id::text, 0)
  );

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
    and professional_membership.role = 'therapist'
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

-- Reconcile legacy patients.therapist_id pointers into the canonical case-team
-- relation once. Existing links are preserved and never duplicated.
update public.patient_professional_links link
   set relationship_type = 'primary',
       case_role = case
         when link.case_role = 'supervisor' then 'supervisor'
         else 'primary_therapist'
       end,
       specialty = left(nullif(trim(profile.specialty), ''), 120),
       updated_at = clock_timestamp()
  from public.patients patient
  join public.clinic_memberships membership
    on membership.clinic_id = patient.clinic_id
   and membership.user_id = patient.therapist_id
   and membership.role = 'therapist'
   and membership.status = 'active'
  join public.professional_profiles profile
    on profile.user_id = patient.therapist_id
   and char_length(nullif(trim(profile.specialty), '')) >= 2
 where patient.therapist_id is not null
   and patient.is_active is distinct from false
   and patient.deleted_at is null
   and link.patient_id = patient.id
   and link.professional_id = patient.therapist_id::text
   and link.status = 'active'
   and link.relationship_type <> 'primary'
   and not exists (
     select 1
     from public.patient_professional_links primary_link
     where primary_link.patient_id = patient.id
       and primary_link.status = 'active'
       and primary_link.relationship_type = 'primary'
   );

insert into public.patient_professional_links (
  organization_id, clinic_id, patient_id, professional_id, specialty,
  case_role, relationship_type, starts_at, permissions, created_by
)
select
  patient.clinic_id::text,
  patient.clinic_id::text,
  patient.id,
  patient.therapist_id::text,
  left(nullif(trim(profile.specialty), ''), 120),
  'primary_therapist',
  'primary',
  current_date,
  jsonb_build_object('read', true, 'write', true, 'historicalRead', true),
  patient.therapist_id::text
from public.patients patient
join public.clinic_memberships membership
  on membership.clinic_id = patient.clinic_id
 and membership.user_id = patient.therapist_id
 and membership.role = 'therapist'
 and membership.status = 'active'
join public.professional_profiles profile
  on profile.user_id = patient.therapist_id
 and char_length(nullif(trim(profile.specialty), '')) >= 2
where patient.therapist_id is not null
  and patient.is_active is distinct from false
  and patient.deleted_at is null
  and not exists (
    select 1
    from public.patient_professional_links link
    where link.patient_id = patient.id
      and link.status = 'active'
      and (
        link.relationship_type = 'primary'
        or link.professional_id = patient.therapist_id::text
      )
  )
  and (
    select count(*)
    from public.patient_professional_links active_link
    where active_link.patient_id = patient.id
      and active_link.status = 'active'
  ) < 5
on conflict do nothing;

revoke all on function public.set_patient_primary_professional_v1(uuid, uuid, uuid, date)
  from public, anon, authenticated;
grant execute on function public.set_patient_primary_professional_v1(uuid, uuid, uuid, date)
  to service_role;

notify pgrst, 'reload schema';

commit;
