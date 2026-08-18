-- Case-team management authority v2.
-- A supervision-enabled professional who is already an active member of a
-- patient's case may manage that patient's care team, regardless of whether
-- the existing case-role label is therapist, primary_therapist, supervisor,
-- consultant, or another valid clinical role.
--
-- Scope remains fail-closed:
--   * director/coordinator => active clinic only;
--   * supervision-enabled professional => only active cases they belong to;
--   * explicit clinical_supervision_links => only the supervised case(s).
-- Existing mutation RPCs keep using this helper, so no data rewrite is needed.

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
      -- A professional explicitly enabled for supervision may manage the team
      -- only when they are already an active member of this exact patient case.
      -- The authority does not depend on the display/case-role label because a
      -- supervisor may also be the primary therapist or another clinician in
      -- the same case.
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
          and (
            membership.role = 'supervisor'
            or membership.can_supervise is true
          )
      )
      or
      -- Explicit supervision also authorizes management of the corresponding
      -- patient even when the supervisor is not directly listed as a case
      -- professional (for example supervision assigned to another clinician).
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

revoke all on function public.patient_case_team_actor_can_manage_v1(uuid, uuid, uuid)
  from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
