-- Hotfix: keep clinic-scoped clinical specialty and the legacy/global
-- professional-profile compatibility projection synchronized atomically.
--
-- Why this exists:
--   Team Management writes specialty to clinic_memberships (clinic-scoped
--   authority), while patient case-team persistence still validates the
--   compatibility field professional_profiles.specialty. A role transition
--   such as receptionist -> therapist could therefore display a valid
--   specialty in Team Management and still fail with
--   PATIENT_PROFESSIONAL_SPECIALTY_REQUIRED when creating a case link.
--
-- Scope:
--   * No patient rows are inserted, updated, or deleted.
--   * Existing case links are not rewritten directly by this migration.
--   * Only blank/missing professional-profile specialty compatibility data is
--     repaired from unambiguous active clinic memberships.

begin;

do $guard$
begin
  if to_regclass('public.clinic_memberships') is null
     or to_regclass('public.professional_profiles') is null
     or to_regclass('public.users') is null then
    raise exception 'CASE_TEAM_SPECIALTY_BRIDGE_SCHEMA_PENDING';
  end if;
end;
$guard$;

create or replace function public.set_clinic_member_access_and_specialty_v2(
  p_clinic_id uuid,
  p_member_id uuid,
  p_actor_id uuid,
  p_role text,
  p_specialty text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_actor_role text;
  v_target_role text;
  v_role text := lower(trim(coalesce(p_role, '')));
  v_specialty text := nullif(trim(coalesce(p_specialty, '')), '');
  v_member_name text;
  v_now timestamptz := clock_timestamp();
begin
  if p_clinic_id is null or p_member_id is null or p_actor_id is null then
    raise exception using errcode = 'P0001', message = 'CLINIC_MEMBER_ACCESS_INVALID';
  end if;

  if v_role not in ('director', 'coordinator', 'therapist', 'receptionist', 'biller') then
    raise exception using errcode = 'P0001', message = 'CLINIC_MEMBER_ROLE_INVALID';
  end if;

  if p_member_id = p_actor_id then
    raise exception using errcode = 'P0001', message = 'SELF_ROLE_CHANGE_DENIED';
  end if;

  select lower(trim(membership.role))
    into v_actor_role
  from public.clinic_memberships membership
  where membership.user_id = p_actor_id
    and membership.clinic_id = p_clinic_id
    and membership.status = 'active'
  for share;

  if not found or v_actor_role not in ('director', 'coordinator') then
    raise exception using errcode = '42501', message = 'CLINIC_ROLE_DELEGATION_DENIED';
  end if;

  select lower(trim(membership.role))
    into v_target_role
  from public.clinic_memberships membership
  where membership.user_id = p_member_id
    and membership.clinic_id = p_clinic_id
    and membership.status = 'active'
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'CLINIC_MEMBER_NOT_FOUND';
  end if;

  if v_actor_role = 'coordinator'
     and (v_target_role = 'director' or v_role = 'director') then
    raise exception using errcode = '42501', message = 'CLINIC_ROLE_TARGET_ABOVE_ACTOR';
  end if;

  if v_role = 'therapist' then
    if v_specialty is null
       or char_length(v_specialty) < 2
       or char_length(v_specialty) > 120 then
      raise exception using errcode = 'P0001', message = 'CLINICAL_SPECIALTY_INVALID';
    end if;

    -- professional_profiles.specialty is still consumed by older case-team
    -- persistence functions. Because it is global, do not silently overwrite
    -- it when the same professional has a conflicting active specialty in
    -- another clinic. That conflict requires a broader authority migration,
    -- not a last-writer-wins hotfix.
    if exists (
      select 1
      from public.clinic_memberships other_membership
      where other_membership.user_id = p_member_id
        and other_membership.clinic_id is distinct from p_clinic_id
        and other_membership.status = 'active'
        and other_membership.role in ('therapist', 'supervisor', 'coordinator', 'director')
        and char_length(nullif(trim(other_membership.specialty), '')) >= 2
        and lower(trim(other_membership.specialty)) <> lower(v_specialty)
    ) then
      raise exception using errcode = 'P0001', message = 'CLINICAL_SPECIALTY_CROSS_CLINIC_CONFLICT';
    end if;
  else
    v_specialty := null;
  end if;

  update public.clinic_memberships membership
     set role = v_role,
         specialty = case when v_role = 'therapist' then v_specialty else null end,
         settings_updated_at = v_now,
         settings_updated_by = p_actor_id,
         updated_at = v_now
   where membership.user_id = p_member_id
     and membership.clinic_id = p_clinic_id
     and membership.status = 'active';

  if v_role = 'therapist' then
    select nullif(trim(coalesce(target_user.name, '')), '')
      into v_member_name
    from public.users target_user
    where target_user.id = p_member_id;

    insert into public.professional_profiles (
      user_id,
      full_name,
      specialty,
      created_at,
      updated_at
    )
    values (
      p_member_id,
      v_member_name,
      v_specialty,
      v_now,
      v_now
    )
    on conflict (user_id) do update
      set specialty = excluded.specialty,
          full_name = coalesce(
            nullif(trim(professional_profiles.full_name), ''),
            excluded.full_name
          ),
          updated_at = excluded.updated_at;
  end if;

  return jsonb_build_object(
    'memberId', p_member_id,
    'clinicId', p_clinic_id,
    'role', v_role,
    'specialty', v_specialty
  );
end;
$function$;

revoke all on function public.set_clinic_member_access_and_specialty_v2(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.set_clinic_member_access_and_specialty_v2(uuid, uuid, uuid, text, text)
  to service_role;

comment on function public.set_clinic_member_access_and_specialty_v2(uuid, uuid, uuid, text, text) is
  'Atomically updates clinic member access and clinic specialty while maintaining the professional_profiles specialty compatibility projection required by legacy case-team persistence.';

-- Repair only missing/blank compatibility projections when the active
-- membership specialty is unambiguous across all clinics for that user.
with candidate_specialties as (
  select
    membership.user_id,
    min(trim(membership.specialty)) as specialty
  from public.clinic_memberships membership
  where membership.status = 'active'
    and membership.role in ('therapist', 'supervisor', 'coordinator', 'director')
    and char_length(nullif(trim(membership.specialty), '')) >= 2
  group by membership.user_id
  having count(distinct lower(trim(membership.specialty))) = 1
), missing_profiles as (
  select
    candidate.user_id,
    candidate.specialty,
    nullif(trim(coalesce(target_user.name, '')), '') as full_name
  from candidate_specialties candidate
  join public.users target_user on target_user.id = candidate.user_id
  left join public.professional_profiles profile on profile.user_id = candidate.user_id
  where profile.user_id is null
)
insert into public.professional_profiles (
  user_id,
  full_name,
  specialty,
  created_at,
  updated_at
)
select
  missing.user_id,
  missing.full_name,
  missing.specialty,
  clock_timestamp(),
  clock_timestamp()
from missing_profiles missing
on conflict (user_id) do nothing;

with candidate_specialties as (
  select
    membership.user_id,
    min(trim(membership.specialty)) as specialty
  from public.clinic_memberships membership
  where membership.status = 'active'
    and membership.role in ('therapist', 'supervisor', 'coordinator', 'director')
    and char_length(nullif(trim(membership.specialty), '')) >= 2
  group by membership.user_id
  having count(distinct lower(trim(membership.specialty))) = 1
)
update public.professional_profiles profile
   set specialty = candidate.specialty,
       updated_at = clock_timestamp()
  from candidate_specialties candidate
 where profile.user_id = candidate.user_id
   and coalesce(char_length(nullif(trim(profile.specialty), '')), 0) < 2;

notify pgrst, 'reload schema';

commit;
